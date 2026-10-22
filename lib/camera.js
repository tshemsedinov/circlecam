'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Result } = require('metautil');

const VIDEO_NAME_RE = /^video\d+$/;
const DEVICE_INDEX_RE = /^\d+$/;
const DEVICE_NUMBER_RE = /(\d+)$/;
const MISSING_DEVICE_INDEX = 999999;

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
  return devices.sort((a, b) => deviceNumber(a) - deviceNumber(b));
};

const cameraName = (device) => {
  const base = path.basename(device);
  const sys = `/sys/class/video4linux/${base}/name`;
  const named = Result.from(() => fs.readFileSync(sys, 'utf8').trim());
  return named.ok ? named.value : device;
};

const existingDevice = (device) => {
  if (fs.existsSync(device)) return device;
  throw new Error(`Camera device ${device} does not exist`);
};

const resolveIndex = (selector) => {
  const device = `/dev/video${selector}`;
  if (fs.existsSync(device)) return device;
  const indexed = findVideoDevices()[parseInt(selector, 10)];
  if (indexed !== undefined) return indexed;
  throw new Error(`Camera index ${selector} does not exist`);
};

// Chromium labels V4L2 cameras by their driver name, so device paths and
// indexes are translated to that name; the renderer matches it to a label
const resolveCameraQuery = (selector) => {
  if (selector === 'auto') return null;
  if (selector.startsWith('/dev/video')) {
    return cameraName(existingDevice(selector));
  }
  if (VIDEO_NAME_RE.test(selector)) {
    return cameraName(existingDevice(`/dev/${selector}`));
  }
  if (DEVICE_INDEX_RE.test(selector)) return cameraName(resolveIndex(selector));
  return selector;
};

module.exports = { resolveCameraQuery };
