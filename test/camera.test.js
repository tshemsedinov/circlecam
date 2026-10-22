'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveCameraQuery } = require('../lib/camera.js');

test('resolveCameraQuery leaves auto to the renderer', () => {
  assert.equal(resolveCameraQuery('auto'), null);
});

test('resolveCameraQuery passes name substrings through', () => {
  assert.equal(resolveCameraQuery('Logitech C920'), 'Logitech C920');
});

test('resolveCameraQuery rejects missing devices', () => {
  assert.throws(() => resolveCameraQuery('/dev/video9999'), /does not exist/);
  assert.throws(() => resolveCameraQuery('video9999'), /does not exist/);
  assert.throws(() => resolveCameraQuery('9999'), /does not exist/);
});
