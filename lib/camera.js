'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { Queue, Struct, Result } = require('metautil');

const FORMAT_SCORE = {
  MJPG: 5,
  JPEG: 4,
  YUYV: 3,
  YUY2: 3,
  NV12: 2,
  RGB3: 1,
  BGR3: 1,
};

const GOOD_FORMATS = Object.keys(FORMAT_SCORE);

const FALLBACK_FORMATS = ['MJPG', 'YUYV'];

const FALLBACK_RESOLUTIONS = [
  { width: 3840, height: 2160 },
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1600, height: 1200 },
  { width: 1280, height: 960 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 800, height: 600 },
  { width: 640, height: 480 },
];

const FFMPEG_FOURCC = {
  mjpeg: 'MJPG',
  mjpg: 'MJPG',
  jpeg: 'JPEG',
  yuyv422: 'YUYV',
  yuyv: 'YUYV',
  yuy2: 'YUY2',
  nv12: 'NV12',
  rgb24: 'RGB3',
  bgr24: 'BGR3',
};

const FFMPEG_INPUT_FORMAT = {
  MJPG: 'mjpeg',
  JPEG: 'mjpeg',
  YUYV: 'yuyv422',
  YUY2: 'yuyv422',
  NV12: 'nv12',
};

const VIDEO_NAME_RE = /^video\d+$/;
const DEVICE_INDEX_RE = /^\d+$/;
const DEVICE_NUMBER_RE = /(\d+)$/;
const V4L2_FORMAT_RE = /\[\d+\]:\s+'([^']+)'/;
const V4L2_SIZE_RE = /Size:\s+Discrete\s+(\d+)x(\d+)/;
const V4L2_FPS_RE = /Interval:\s+Discrete.*?\(([\d.]+)\s+fps\)/;
const LINE_SPLIT_RE = /\r?\n/;
const TOOL_TIMEOUT_MS = 5000;
const VERIFY_TIMEOUT_MS = 6000;
const CINEMA_FPS = 24;
const LOW_FPS = 15;
const MISSING_DEVICE_INDEX = 999999;
const DEFAULT_PROBE_FPS = 30;

const CameraMode = Struct.immutable('CameraMode', {
  device: '',
  name: '',
  fourcc: '',
  width: 0,
  height: 0,
  fps: 0,
});

const commandArgs = (command) => command.trim().split(/\s+/);

const runTool = (command, args, timeoutMs = TOOL_TIMEOUT_MS) => {
  const encoding = 'utf8';
  const maxBuffer = 2 * 1024 * 1024;
  const options = { encoding, timeout: timeoutMs, maxBuffer };
  return Result.from(() => spawnSync(command, args, options));
};

const spawned = (command, args, timeoutMs = TOOL_TIMEOUT_MS) => {
  const ran = runTool(command, args, timeoutMs);
  if (!ran.ok) {
    console.error(`Failed to run ${command}: ${ran.error.message}`);
    return null;
  }
  return ran.value;
};

const deviceNumber = (device) => {
  const match = device.match(DEVICE_NUMBER_RE);
  if (match === null) return MISSING_DEVICE_INDEX;
  return parseInt(match[1], 10);
};

const findVideoDevices = () => {
  const listed = Result.from(() => fs.readdirSync('/dev'));
  if (!listed.ok) {
    console.error(`Cannot list /dev: ${listed.error.message}`);
    return [];
  }
  const names = listed.value;
  const video = names.filter((name) => VIDEO_NAME_RE.test(name));
  const devices = video.map((name) => `/dev/${name}`);
  const ranked = [...devices];
  ranked.sort((a, b) => deviceNumber(a) - deviceNumber(b));
  return ranked;
};

const cameraName = (device) => {
  const base = path.basename(device);
  const sys = `/sys/class/video4linux/${base}/name`;
  const named = Result.from(() => fs.readFileSync(sys, 'utf8').trim());
  if (!named.ok) return device;
  return named.value;
};

const normalizeName = (value) => {
  const text = value.toLowerCase();
  const spaced = text.replace(/[_:/]+/g, ' ');
  return spaced.replace(/\s+/g, ' ').trim();
};

const getV4l2CtlOutput = (device) => {
  const command = `--device ${device} --list-formats-ext`;
  const args = commandArgs(command);
  const result = spawned('v4l2-ctl', args);
  if (result === null) return null;
  if (result.error !== undefined) return null;
  if (result.status !== 0) return null;
  const stdout = result.stdout ?? '';
  if (stdout === '') return null;
  return stdout;
};

const getFfmpegFormatsOutput = (device) => {
  const command = `-hide_banner -f v4l2 -list_formats all -i ${device}`;
  const args = commandArgs(command);
  const result = spawned('ffmpeg', args);
  if (result === null) return null;
  if (result.error?.code === 'ENOENT') return null;
  if (result.error !== undefined) return null;
  // ffmpeg prints the format list to stderr and often exits nonzero
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return `${stdout}\n${stderr}`;
};

const isUsableSize = (width, height) => {
  if (width === 0 || height === 0) return false;
  if (Number.isFinite(width) === false) return false;
  if (Number.isFinite(height) === false) return false;
  return true;
};

const parseV4l2CtlModes = (device, output) => {
  const modes = [];
  const name = cameraName(device);
  let fourcc = null;
  let width = null;
  let height = null;
  const lines = output.split(LINE_SPLIT_RE);
  for (const line of lines) {
    const formatMatch = V4L2_FORMAT_RE.exec(line);
    if (formatMatch !== null) {
      fourcc = formatMatch[1];
      width = null;
      height = null;
      continue;
    }
    const sizeMatch = V4L2_SIZE_RE.exec(line);
    if (sizeMatch !== null) {
      width = parseInt(sizeMatch[1], 10);
      height = parseInt(sizeMatch[2], 10);
      continue;
    }
    const fpsMatch = V4L2_FPS_RE.exec(line);
    if (fpsMatch === null) continue;
    if (fourcc === null || width === null || height === null) continue;
    if (isUsableSize(width, height) === false) continue;
    const fps = parseFloat(fpsMatch[1]);
    if (Number.isFinite(fps) === false) continue;
    const mode = CameraMode.create({
      device,
      name,
      fourcc,
      width,
      height,
      fps,
    });
    modes.push(mode);
  }
  return modes;
};

const mapFourcc = (raw) => {
  const mapped = FFMPEG_FOURCC[raw.toLowerCase()];
  if (mapped === undefined) return raw.toUpperCase();
  return mapped;
};

const parseFfmpegModes = (device, output) => {
  const modes = [];
  const name = cameraName(device);
  const fps = DEFAULT_PROBE_FPS;
  const lineRe = /(?:Compressed|Raw)\s*:\s+(\S+)\s+:\s+(.*)/gi;
  let match = lineRe.exec(output);
  while (match !== null) {
    const fourcc = mapFourcc(match[1]);
    const sizes = match[2].match(/(\d+)x(\d+)/g);
    const pairs = sizes === null ? [] : sizes;
    for (const size of pairs) {
      const parts = size.split('x');
      const width = parseInt(parts[0], 10);
      const height = parseInt(parts[1], 10);
      if (isUsableSize(width, height) === false) continue;
      const mode = CameraMode.create({
        device,
        name,
        fourcc,
        width,
        height,
        fps,
      });
      modes.push(mode);
    }
    match = lineRe.exec(output);
  }
  return modes;
};

const getCameraModes = (device) => {
  const v4l2 = getV4l2CtlOutput(device);
  if (v4l2 !== null) {
    const modes = parseV4l2CtlModes(device, v4l2);
    if (modes.length > 0) return modes;
  }
  const ffmpeg = getFfmpegFormatsOutput(device);
  if (ffmpeg !== null) return parseFfmpegModes(device, ffmpeg);
  return [];
};

const fpsClassOf = (fps, minFps) => {
  if (fps >= minFps) return 4;
  if (fps >= CINEMA_FPS) return 3;
  if (fps >= LOW_FPS) return 2;
  if (fps > 0) return 1;
  return 0;
};

const modeScore = (mode, minFps) => {
  const fps = mode.fps;
  const pixels = mode.width * mode.height;
  const fpsClass = fpsClassOf(fps, minFps);
  const format = FORMAT_SCORE[mode.fourcc];
  const formatScore = format === undefined ? 0 : format;
  return [fpsClass, pixels, fps, formatScore];
};

const compareDesc = (high, low) => {
  const n = high.length;
  for (let i = 0; i < n; i += 1) {
    if (high[i] > low[i]) return 1;
    if (high[i] < low[i]) return -1;
  }
  return 0;
};

const rankModes = (modes, minFps) => {
  const ranked = [...modes];
  ranked.sort((a, b) => {
    const high = modeScore(b, minFps);
    const low = modeScore(a, minFps);
    return compareDesc(high, low);
  });
  return ranked;
};

const usableModes = (device, minFps) => {
  const modes = getCameraModes(device);
  const good = modes.filter((mode) => GOOD_FORMATS.includes(mode.fourcc));
  const list = good.length > 0 ? good : modes;
  return rankModes(list, minFps);
};

const fallbackModes = (device) => {
  const result = [];
  const name = cameraName(device);
  const fps = DEFAULT_PROBE_FPS;
  for (const fourcc of FALLBACK_FORMATS) {
    for (const resolution of FALLBACK_RESOLUTIONS) {
      const { width, height } = resolution;
      const mode = CameraMode.create({
        device,
        name,
        fourcc,
        width,
        height,
        fps,
      });
      result.push(mode);
    }
  }
  return result;
};

const ffmpegVerifyArgs = (mode, inputFormat) => {
  const size = `${mode.width}x${mode.height}`;
  const global = '-hide_banner -loglevel error';
  const input = `-f v4l2 -input_format ${inputFormat}`;
  const source = `-video_size ${size} -i ${mode.device}`;
  const output = '-frames:v 1 -f null -';
  const command = `${global} ${input} ${source} ${output}`;
  return commandArgs(command);
};

const verifyMode = (mode) => {
  const inputFormat = FFMPEG_INPUT_FORMAT[mode.fourcc] ?? null;
  if (inputFormat === null) return true;
  const args = ffmpegVerifyArgs(mode, inputFormat);
  const result = spawned('ffmpeg', args, VERIFY_TIMEOUT_MS);
  if (result === null) return true;
  if (result.error?.code === 'ENOENT') return true;
  if (result.error !== undefined) return false;
  return result.status === 0;
};

const logSelectedMode = (mode) => {
  const fpsText = mode.fps.toFixed(1);
  console.log('\nSelected camera mode:');
  console.log(`  Device:     ${mode.device}`);
  console.log(`  Name:       ${mode.name}`);
  console.log(`  Format:     ${mode.fourcc}`);
  console.log(`  Resolution: ${mode.width}x${mode.height}`);
  console.log(`  FPS:        ${fpsText}`);
};

const probeModes = (modes) => {
  const pending = Queue.fromArray(modes);
  while (pending.size > 0) {
    const mode = pending.dequeue();
    const label = `${mode.fourcc.padEnd(4)} ${mode.width}x${mode.height}`;
    const fps = mode.fps.toFixed(1);
    process.stdout.write(`  ${label} @ ${fps} FPS`);
    if (verifyMode(mode)) {
      console.log('  OK');
      logSelectedMode(mode);
      return mode;
    }
    console.log('  failed');
  }
  return null;
};

const openBestCameraMode = (device, minFps) => {
  let modes = usableModes(device, minFps);
  if (modes.length === 0) {
    console.log('WARNING: Could not obtain V4L2 modes. Probing common modes.');
    modes = fallbackModes(device);
  }
  console.log('\nTrying camera modes:');
  const selected = probeModes(modes);
  if (selected !== null) return selected;
  throw new Error(`No working camera mode found for ${device}`);
};

const selectBestCamera = (minFps) => {
  const pending = Queue.fromArray(findVideoDevices());
  const candidates = [];
  console.log('Searching for cameras...');
  while (pending.size > 0) {
    const device = pending.dequeue();
    const modes = usableModes(device, minFps);
    if (modes.length === 0) continue;
    const best = modes[0];
    candidates.push(best);
    const fps = best.fps.toFixed(1);
    const summary = `${best.fourcc} ${best.width}x${best.height} @ ${fps}`;
    console.log(`  ${device}: ${summary} FPS  (${best.name})`);
  }
  if (candidates.length === 0) throw new Error('No usable V4L2 camera found.');
  const ranked = rankModes(candidates, minFps);
  const best = ranked[0];
  console.log(`\nAuto-selected camera: ${best.device}`);
  return best.device;
};

const existingDevice = (device) => {
  if (fs.existsSync(device)) return device;
  throw new Error(`Camera device ${device} does not exist`);
};

const resolveIndex = (selector, devices) => {
  const device = `/dev/video${selector}`;
  if (fs.existsSync(device)) return device;
  const indexed = devices[parseInt(selector, 10)];
  if (indexed !== undefined) return indexed;
  throw new Error(`Camera index ${selector} does not exist`);
};

const resolveByName = (selector, devices) => {
  const needle = normalizeName(selector);
  const matches = devices.filter((device) => {
    const name = normalizeName(cameraName(device));
    return name.includes(needle);
  });
  if (matches.length === 0) {
    throw new Error(`No camera name matches "${selector}"`);
  }
  return matches[0];
};

const resolveCameraDevice = (selector, minFps) => {
  const devices = findVideoDevices();
  if (selector === 'auto') return selectBestCamera(minFps);
  if (selector.startsWith('/dev/video')) return existingDevice(selector);
  if (VIDEO_NAME_RE.test(selector)) {
    return existingDevice(`/dev/${selector}`);
  }
  if (DEVICE_INDEX_RE.test(selector)) return resolveIndex(selector, devices);
  return resolveByName(selector, devices);
};

module.exports = {
  normalizeName,
  parseV4l2CtlModes,
  parseFfmpegModes,
  modeScore,
  rankModes,
  fallbackModes,
  resolveCameraDevice,
  openBestCameraMode,
  CameraMode,
};
