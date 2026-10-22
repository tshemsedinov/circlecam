'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Config, loadConfig } = require('../lib/config.js');

const writeConfig = (t, data) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circlecam-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'config.json');
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
};

test('loadConfig fills documented defaults', (t) => {
  const filePath = writeConfig(t, {});
  const loaded = loadConfig(filePath);
  assert.equal(loaded.ok, true);
  const config = loaded.value;
  assert.equal(config.constructor.name, 'Config');
  assert.equal(config.camera, 'auto');
  assert.equal(config.position, 'top-right');
  assert.equal(config.shape, 'circle');
  assert.equal(config.width, 430);
  assert.equal(config.height, 430);
  assert.equal(config.radius, 0);
  assert.equal(config.opacity, 1);
  assert.equal(config.margin, 15);
  assert.equal(config.monitor, 0);
  assert.equal(config.minFps, 30);
  assert.equal(config.mirror, false);
  assert.equal(config.nativeWayland, false);
  assert.equal(Object.isFrozen(config), true);
});

test('loadConfig keeps known fields and drops extras', (t) => {
  const filePath = writeConfig(t, {
    camera: 'Logitech',
    width: 800,
    shape: 'rectangle',
    radius: 24,
    opacity: 0.7,
    comments: '240, 480',
  });
  const loaded = loadConfig(filePath);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.value.camera, 'Logitech');
  assert.equal(loaded.value.width, 800);
  assert.equal(loaded.value.shape, 'rectangle');
  assert.equal(loaded.value.radius, 24);
  assert.equal(loaded.value.opacity, 0.7);
  assert.equal(Object.hasOwn(loaded.value, 'comments'), false);
  assert.equal(Config.fields.includes('comments'), false);
});

test('loadConfig fails on invalid JSON', (t) => {
  const filePath = writeConfig(t, '{');
  const loaded = loadConfig(filePath);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.error instanceof SyntaxError, true);
});

test('loadConfig fails on a wrong field type', (t) => {
  const filePath = writeConfig(t, { width: '800' });
  const loaded = loadConfig(filePath);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.error instanceof TypeError, true);
});

test('loadConfig fails when the file is missing', () => {
  const loaded = loadConfig('/tmp/circlecam-missing-config.json');
  assert.equal(loaded.ok, false);
});
