#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RENDERER_PATH = path.join(__dirname, 'renderer.html');
const RENDERER_HTML = fs.readFileSync(RENDERER_PATH, 'utf8');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const CONFIG_TEXT = fs.readFileSync(CONFIG_PATH, 'utf8');
const config = JSON.parse(CONFIG_TEXT);

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

const readEnv = (name) => process.env[name] ?? '';

const applyTemplate = (template, values) =>
  template.replace(/{{(\w+)}}/g, (token, key) => {
    if (Object.hasOwn(values, key) === false) return token;
    return `${values[key]}`;
  });

const shouldForceX11 = (nativeWayland) => {
  const type = readEnv('XDG_SESSION_TYPE').toLowerCase();
  const wayland = type === 'wayland';
  const display = readEnv('DISPLAY') !== '';
  return nativeWayland === false && wayland && display;
};

const commandArgs = (command) => command.trim().split(/\s+/);

const runTool = (command, args, timeoutMs = 5000) => {
  const encoding = 'utf8';
  const maxBuffer = 2 * 1024 * 1024;
  const options = { encoding, timeout: timeoutMs, maxBuffer };
  try {
    return spawnSync(command, args, options);
  } catch {
    return null;
  }
};

const deviceNumber = (device) => {
  const match = device.match(DEVICE_NUMBER_RE);
  if (match === null) return 999999;
  return parseInt(match[1], 10);
};

const findVideoDevices = () => {
  try {
    const names = fs.readdirSync('/dev');
    const video = names.filter((name) => VIDEO_NAME_RE.test(name));
    const devices = video.map((name) => `/dev/${name}`);
    const ranked = [...devices];
    ranked.sort((a, b) => deviceNumber(a) - deviceNumber(b));
    return ranked;
  } catch {
    return [];
  }
};

const cameraName = (device) => {
  const base = path.basename(device);
  const sys = `/sys/class/video4linux/${base}/name`;
  try {
    return fs.readFileSync(sys, 'utf8').trim();
  } catch {
    return device;
  }
};

const normalizeName = (value) => {
  const text = value.toLowerCase();
  const spaced = text.replace(/[_:/]+/g, ' ');
  return spaced.replace(/\s+/g, ' ').trim();
};

const getV4l2CtlOutput = (device) => {
  const command = `--device ${device} --list-formats-ext`;
  const args = commandArgs(command);
  const result = runTool('v4l2-ctl', args);
  if (result === null) return null;
  if (result.error !== undefined) return null;
  if (result.status !== 0) return null;
  return result.stdout;
};

const getFfmpegFormatsOutput = (device) => {
  const command = `-hide_banner -f v4l2 -list_formats all -i ${device}`;
  const args = commandArgs(command);
  const result = runTool('ffmpeg', args);
  if (result === null) return null;
  if (result.error?.code === 'ENOENT') return null;
  const stdout = result.stdout;
  const stderr = result.stderr;
  return `${stdout}\n${stderr}`;
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
    const fps = parseFloat(fpsMatch[1]);
    modes.push({ device, name, fourcc, width, height, fps });
  }
  return modes;
};

const parseFfmpegModes = (device, output) => {
  const modes = [];
  const name = cameraName(device);
  const fps = 30;
  const lineRe = /(?:Compressed|Raw)\s*:\s+(\S+)\s+:\s+[^:]*:\s+([0-9x ]+)/gi;
  let match = lineRe.exec(output);
  while (match !== null) {
    const raw = match[1];
    const mapped = FFMPEG_FOURCC[raw.toLowerCase()];
    const fourcc = mapped === undefined ? raw.toUpperCase() : mapped;
    const sizes = match[2].match(/(\d+)x(\d+)/g);
    const pairs = sizes === null ? [] : sizes;
    for (const size of pairs) {
      const parts = size.split('x');
      const width = parseInt(parts[0], 10);
      const height = parseInt(parts[1], 10);
      if (width === 0 || height === 0) continue;
      if (Number.isFinite(width) === false) continue;
      if (Number.isFinite(height) === false) continue;
      modes.push({ device, name, fourcc, width, height, fps });
    }
    match = lineRe.exec(output);
  }
  return modes;
};

const getCameraModes = (device) => {
  const v4l2 = getV4l2CtlOutput(device);
  if (v4l2 !== null && v4l2 !== '') {
    const modes = parseV4l2CtlModes(device, v4l2);
    if (modes.length > 0) return modes;
  }
  const ffmpeg = getFfmpegFormatsOutput(device);
  if (ffmpeg !== null) return parseFfmpegModes(device, ffmpeg);
  return [];
};

const modeScore = (mode, minFps) => {
  const fps = mode.fps;
  const pixels = mode.width * mode.height;
  let fpsClass = 0;
  if (fps >= minFps) fpsClass = 4;
  else if (fps >= 24) fpsClass = 3;
  else if (fps >= 15) fpsClass = 2;
  else if (fps > 0) fpsClass = 1;
  const format = FORMAT_SCORE[mode.fourcc];
  const formatScore = format === undefined ? 0 : format;
  return [fpsClass, pixels, fps, formatScore];
};

const rankModes = (modes, minFps) => {
  const ranked = [...modes];
  ranked.sort((a, b) => {
    const high = modeScore(b, minFps);
    const low = modeScore(a, minFps);
    for (let i = 0; i < high.length; i += 1) {
      if (high[i] > low[i]) return 1;
      if (high[i] < low[i]) return -1;
    }
    return 0;
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
  const fps = 30;
  for (const fourcc of FALLBACK_FORMATS) {
    for (const resolution of FALLBACK_RESOLUTIONS) {
      const width = resolution.width;
      const height = resolution.height;
      result.push({ device, name, fourcc, width, height, fps });
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
  const result = runTool('ffmpeg', args, 6000);
  if (result === null) return true;
  if (result.error?.code === 'ENOENT') return true;
  return result.status === 0;
};

const openBestCameraMode = (device, minFps) => {
  let modes = usableModes(device, minFps);
  if (modes.length === 0) {
    console.log('WARNING: Could not obtain V4L2 modes. Probing common modes.');
    modes = fallbackModes(device);
  }
  console.log('\nTrying camera modes:');
  for (const mode of modes) {
    const label = `${mode.fourcc.padEnd(4)} ${mode.width}x${mode.height}`;
    const fps = mode.fps.toFixed(1);
    process.stdout.write(`  ${label} @ ${fps} FPS`);
    if (verifyMode(mode)) {
      console.log('  OK');
      const fpsText = mode.fps.toFixed(1);
      console.log('\nSelected camera mode:');
      console.log(`  Device:     ${mode.device}`);
      console.log(`  Name:       ${mode.name}`);
      console.log(`  Format:     ${mode.fourcc}`);
      console.log(`  Resolution: ${mode.width}x${mode.height}`);
      console.log(`  FPS:        ${fpsText}`);
      return mode;
    }
    console.log('  failed');
  }
  throw new Error(`No working camera mode found for ${device}`);
};

const selectBestCamera = (minFps) => {
  const candidates = [];
  console.log('Searching for cameras...');
  for (const device of findVideoDevices()) {
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

const resolveCameraDevice = (selector, minFps) => {
  const devices = findVideoDevices();
  if (selector === 'auto') return selectBestCamera(minFps);
  if (selector.startsWith('/dev/video')) return existingDevice(selector);
  if (VIDEO_NAME_RE.test(selector)) {
    return existingDevice(`/dev/${selector}`);
  }
  if (DEVICE_INDEX_RE.test(selector)) {
    const device = `/dev/video${selector}`;
    if (fs.existsSync(device)) return device;
    const indexed = devices[parseInt(selector, 10)];
    if (indexed !== undefined) return indexed;
    throw new Error(`Camera index ${selector} does not exist`);
  }
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

const spawnElectronGui = (nativeWayland) => {
  let electronPath;
  try {
    electronPath = require('electron');
  } catch {
    console.error('Electron is not installed.');
    console.error('Run: npm install electron');
    process.exit(1);
  }
  if (typeof electronPath !== 'string') {
    console.error('Could not locate the Electron binary.');
    process.exit(1);
  }
  const flags = `
    --enable-transparent-visuals
    --use-gl=angle
    --use-angle=swiftshader
  `;
  const electronArgs = commandArgs(flags);
  if (shouldForceX11(nativeWayland)) {
    electronArgs.push('--ozone-platform=x11');
  }
  const childArgs = [...electronArgs, __filename];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electronPath, childArgs, {
    stdio: 'inherit',
    env,
  });
  if (result.error !== undefined) {
    console.error(result.error.message);
    process.exit(1);
  }
  const status = result.status;
  if (status !== null && status !== undefined) process.exit(status);
  if (result.signal !== null && result.signal !== undefined) process.exit(1);
  process.exit(0);
};

const electronVersion = process.versions.electron ?? '';
const runAsNode = readEnv('ELECTRON_RUN_AS_NODE');
const isGui = electronVersion !== '' && runAsNode === '';
if (isGui === false) spawnElectronGui(config.nativeWayland);

const { app, BrowserWindow, screen, session } = require('electron');

if (shouldForceX11(config.nativeWayland)) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let selectedMode = null;

try {
  const device = resolveCameraDevice(config.camera, config.minFps);
  selectedMode = openBestCameraMode(device, config.minFps);
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

let win = null;
let rendererFile = null;

const calculatePosition = (display, size, margin, position) => {
  const bounds = display.bounds;
  const left = bounds.x + margin;
  const right = bounds.x + bounds.width - size - margin;
  const top = bounds.y + margin;
  const bottom = bounds.y + bounds.height - size - margin;
  const centerX = bounds.x + Math.round((bounds.width - size) / 2);
  const centerY = bounds.y + Math.round((bounds.height - size) / 2);
  if (position === 'top-left') return { x: left, y: top };
  if (position === 'bottom-right') return { x: right, y: bottom };
  if (position === 'bottom-left') return { x: left, y: bottom };
  if (position === 'center') return { x: centerX, y: centerY };
  return { x: right, y: top };
};

const configureMediaPermissions = () => {
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, _origin, details) => {
      if (permission !== 'media') return false;
      const mediaType = details?.mediaType;
      if (mediaType === undefined || mediaType === '') return true;
      return mediaType === 'video';
    },
  );
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission !== 'media') {
        callback(false);
        return;
      }
      const types = details?.mediaTypes;
      const mediaTypes = types === undefined ? [] : types;
      const allow = mediaTypes.length === 0 || mediaTypes.includes('video');
      callback(allow);
    },
  );
};

const placeWindow = (target, pos) => {
  if (target === null || target === undefined) return;
  if (target.isDestroyed()) return;
  const { x, y } = pos;
  const { size: width } = config;
  const height = width;
  target.setBounds({ x, y, width, height });
  target.setAlwaysOnTop(true);
};

const onBeforeInput = (_event, input) => {
  if (input.type !== 'keyDown') return;
  const key = input.key.toLowerCase();
  const altF4 = input.alt === true && key === 'f4';
  if (altF4 === false && key !== 'escape') return;
  if (win === null) return;
  win.close();
};

const onConsoleMessage = (...args) => {
  const second = args[1];
  const isRecord = typeof second === 'object' && second !== null;
  const fromObject = isRecord && 'message' in second;
  const message = fromObject ? second.message : args[2];
  if (message === undefined || message === '') return;
  const text = `${message}`;
  if (text.includes('Electron Security Warning')) return;
  console.log(`[camera] ${text}`);
};

const createWindow = () => {
  const primary = screen.getPrimaryDisplay();
  const all = screen.getAllDisplays();
  const rest = all.filter((display) => display.id !== primary.id);
  const displays = [primary, ...rest];
  const monitor = config.monitor;
  const display = displays[monitor] || displays[0];
  if (displays[monitor] === undefined) {
    const missing = `WARNING: monitor ${monitor} does not exist`;
    console.warn(`${missing}; using monitor 0.`);
  }
  const sessionName = readEnv('XDG_SESSION_TYPE');
  const sessionLabel = sessionName === '' ? 'unknown' : sessionName;
  const ozone = app.commandLine.getSwitchValue('ozone-platform');
  const backend = ozone === '' ? 'default' : ozone;
  console.log(`\nSession: ${sessionLabel}`);
  console.log(`Electron backend request: ${backend}`);
  console.log('Detected monitors:');
  for (let index = 0; index < displays.length; index += 1) {
    const item = displays[index];
    const bounds = item.bounds;
    let label = item.label;
    if (label === undefined || label === '') label = item.id;
    const size = `${bounds.width}x${bounds.height}`;
    const at = `(${bounds.x}, ${bounds.y})`;
    console.log(`  ${index}: ${label} ${size} at ${at}`);
  }
  const pos = calculatePosition(
    display,
    config.size,
    config.margin,
    config.position,
  );
  console.log(`Requested position: ${config.position} (${pos.x}, ${pos.y})`);
  const { x, y } = pos;
  const { size: width } = config;
  const height = width;
  const webPreferences = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false,
  };
  win = new BrowserWindow({
    x,
    y,
    width,
    height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences,
  });
  win.setAlwaysOnTop(true);
  win.webContents.on('before-input-event', onBeforeInput);
  win.webContents.on('console-message', onConsoleMessage);
  const userData = app.getPath('userData');
  rendererFile = path.join(userData, 'circlecam-renderer.html');
  const payload = { ...config, preferred: selectedMode };
  const json = JSON.stringify(payload).replaceAll('<', '\\u003c');
  const mirrored = config.mirror === true;
  const mirrorCss = mirrored ? 'transform: scaleX(-1);' : '';
  const html = applyTemplate(RENDERER_HTML, { json, mirrorCss });
  fs.writeFileSync(rendererFile, html, 'utf8');
  win.loadFile(rendererFile);
  let revealed = false;
  const reveal = () => {
    if (win === null || win.isDestroyed()) return;
    placeWindow(win, pos);
    if (win.isVisible() === false) win.show();
    win.setAlwaysOnTop(true);
    if (revealed) return;
    revealed = true;
    const visible = win.isVisible();
    const bounds = JSON.stringify(win.getBounds());
    console.log(`Window shown: visible=${visible} bounds=${bounds}`);
  };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', reveal);
  setTimeout(reveal, 400);
  setTimeout(() => placeWindow(win, pos), 150);
  win.on('closed', () => {
    win = null;
    app.quit();
  });
};

app.whenReady().then(() => {
  app.setName('CircleCam');
  configureMediaPermissions();
  const delay = process.platform === 'linux' ? 300 : 0;
  setTimeout(createWindow, delay);
});

app.on('window-all-closed', () => {
  app.quit();
});
