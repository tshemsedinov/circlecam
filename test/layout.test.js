'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyTemplate, calculatePosition } = require('../lib/layout.js');

const display = {
  bounds: { x: 100, y: 200, width: 1920, height: 1080 },
};

test('calculatePosition maps named corners and center', () => {
  const size = 400;
  const margin = 15;
  const topLeft = calculatePosition(display, size, margin, 'top-left');
  assert.deepEqual(topLeft, { x: 115, y: 215 });
  const topRight = calculatePosition(display, size, margin, 'top-right');
  assert.deepEqual(topRight, { x: 1605, y: 215 });
  const bottomRight = calculatePosition(display, size, margin, 'bottom-right');
  assert.deepEqual(bottomRight, { x: 1605, y: 865 });
  const bottomLeft = calculatePosition(display, size, margin, 'bottom-left');
  assert.deepEqual(bottomLeft, { x: 115, y: 865 });
  const center = calculatePosition(display, size, margin, 'center');
  assert.deepEqual(center, { x: 860, y: 540 });
});

test('calculatePosition falls back to top-right', () => {
  const pos = calculatePosition(display, 400, 15, 'unknown');
  assert.deepEqual(pos, { x: 1605, y: 215 });
});

test('applyTemplate replaces known keys only', () => {
  const html = applyTemplate('a {{json}} {{missing}}', { json: '{"ok":1}' });
  assert.equal(html, 'a {"ok":1} {{missing}}');
});
