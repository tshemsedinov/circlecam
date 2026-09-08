'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Config, loadConfig } = require('../lib/config.js');

const writeConfig = (data) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circlecam-'));
  const filePath = path.join(dir, 'config.json');
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
  return { dir, filePath };
};

const removeDir = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
};

test('loadConfig fills documented defaults', () => {
  const { dir, filePath } = writeConfig({});
  try {
    const loaded = loadConfig(filePath);
    assert.equal(loaded.ok, true);
    const config = loaded.value;
    assert.equal(config.constructor.name, 'Config');
    assert.equal(config.camera, 'auto');
    assert.equal(config.position, 'top-right');
    assert.equal(config.size, 430);
    assert.equal(config.margin, 15);
    assert.equal(config.monitor, 0);
    assert.equal(config.minFps, 30);
    assert.equal(config.mirror, false);
    assert.equal(config.nativeWayland, false);
    assert.equal(Object.isFrozen(config), true);
  } finally {
    removeDir(dir);
  }
});

test('loadConfig keeps known fields and drops extras', () => {
  const { dir, filePath } = writeConfig({
    camera: 'Logitech',
    size: 800,
    comments: '240, 480',
  });
  try {
    const loaded = loadConfig(filePath);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.value.camera, 'Logitech');
    assert.equal(loaded.value.size, 800);
    assert.equal(Object.hasOwn(loaded.value, 'comments'), false);
    assert.equal(Config.fields.includes('comments'), false);
  } finally {
    removeDir(dir);
  }
});

test('loadConfig fails on invalid JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circlecam-'));
  const filePath = path.join(dir, 'config.json');
  fs.writeFileSync(filePath, '{', 'utf8');
  try {
    const loaded = loadConfig(filePath);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.error instanceof SyntaxError, true);
  } finally {
    removeDir(dir);
  }
});

test('loadConfig fails on a wrong field type', () => {
  const { dir, filePath } = writeConfig({ size: '800' });
  try {
    const loaded = loadConfig(filePath);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.error instanceof TypeError, true);
  } finally {
    removeDir(dir);
  }
});

test('loadConfig fails when the file is missing', () => {
  const loaded = loadConfig('/tmp/circlecam-missing-config.json');
  assert.equal(loaded.ok, false);
});
