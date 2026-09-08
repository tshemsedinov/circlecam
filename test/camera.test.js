'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  CameraMode,
  normalizeName,
  parseV4l2CtlModes,
  parseFfmpegModes,
  modeScore,
  rankModes,
  fallbackModes,
} = require('../lib/camera.js');

const DEVICE = '/dev/video99';

const V4L2_SAMPLE = `
ioctl: VIDIOC_ENUM_FMT
	Type: Video Capture

	[0]: 'MJPG' (Motion-JPEG, compressed)
		Size: Discrete 1920x1080
			Interval: Discrete 0.033s (30.000 fps)
		Size: Discrete 1280x720
			Interval: Discrete 0.033s (30.000 fps)
	[1]: 'YUYV' (YUYV 4:2:2)
		Size: Discrete 640x480
			Interval: Discrete 0.066s (15.000 fps)
`;

const FFMPEG_SAMPLE = `
[video4linux2,v4l2 @ 0x1] Compressed: mjpeg : Motion JPEG : 1920x1080 1280x720
[video4linux2,v4l2 @ 0x1] Raw       : yuyv422 : YUYV 4:2:2 : 640x480
[video4linux2,v4l2 @ 0x1] Compressed: h264 : H.264 : 1280x720
`;

test('normalizeName collapses separators', () => {
  const name = normalizeName('Logitech_C920:USB');
  assert.equal(name, 'logitech c920 usb');
});

test('parseV4l2CtlModes reads format, size, and fps', () => {
  const modes = parseV4l2CtlModes(DEVICE, V4L2_SAMPLE);
  assert.equal(modes.length, 3);
  assert.equal(modes[0].constructor.name, 'CameraMode');
  assert.equal(modes[0].fourcc, 'MJPG');
  assert.equal(modes[0].width, 1920);
  assert.equal(modes[0].height, 1080);
  assert.equal(modes[0].fps, 30);
  assert.equal(modes[2].fourcc, 'YUYV');
  assert.equal(modes[2].width, 640);
  assert.equal(modes[2].fps, 15);
  assert.equal(Object.isFrozen(modes[0]), true);
});

test('parseFfmpegModes maps fourcc aliases', () => {
  const modes = parseFfmpegModes(DEVICE, FFMPEG_SAMPLE);
  assert.equal(modes.length, 4);
  assert.equal(modes[0].fourcc, 'MJPG');
  assert.equal(modes[0].width, 1920);
  assert.equal(modes[1].fourcc, 'MJPG');
  assert.equal(modes[1].width, 1280);
  assert.equal(modes[2].fourcc, 'YUYV');
  assert.equal(modes[3].fourcc, 'H264');
  assert.equal(modes[3].fps, 30);
});

test('rankModes prefers minFps then resolution', () => {
  const slow = CameraMode.create({
    device: DEVICE,
    name: DEVICE,
    fourcc: 'MJPG',
    width: 3840,
    height: 2160,
    fps: 15,
  });
  const fast = CameraMode.create({
    device: DEVICE,
    name: DEVICE,
    fourcc: 'YUYV',
    width: 1280,
    height: 720,
    fps: 30,
  });
  const ranked = rankModes([slow, fast], 30);
  assert.equal(ranked[0], fast);
  assert.equal(ranked[1], slow);
});

test('modeScore tuples order fps class before pixels', () => {
  const mode = CameraMode.create({
    device: DEVICE,
    name: DEVICE,
    fourcc: 'MJPG',
    width: 1920,
    height: 1080,
    fps: 30,
  });
  const score = modeScore(mode, 30);
  assert.deepEqual(score, [4, 1920 * 1080, 30, 5]);
});

test('fallbackModes enumerates common format and size pairs', () => {
  const modes = fallbackModes(DEVICE);
  assert.equal(modes.length, 18);
  assert.equal(modes[0].fourcc, 'MJPG');
  assert.equal(modes[0].width, 3840);
  assert.equal(modes.at(-1).fourcc, 'YUYV');
  assert.equal(modes.at(-1).width, 640);
});
