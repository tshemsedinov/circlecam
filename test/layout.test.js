'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const layout = require('../lib/layout.js');
const { applyTemplate, calculatePosition, shapeRadius } = layout;
const { clampOpacity } = layout;

const display = {
  bounds: { x: 100, y: 200, width: 1920, height: 1080 },
};

const square = { width: 400, height: 400, margin: 15 };

const at = (position) => calculatePosition(display, { ...square, position });

test('calculatePosition maps named corners and center', () => {
  assert.deepEqual(at('top-left'), { x: 115, y: 215 });
  assert.deepEqual(at('top-right'), { x: 1605, y: 215 });
  assert.deepEqual(at('bottom-right'), { x: 1605, y: 865 });
  assert.deepEqual(at('bottom-left'), { x: 115, y: 865 });
  assert.deepEqual(at('center'), { x: 860, y: 540 });
});

test('calculatePosition falls back to top-right', () => {
  assert.deepEqual(at('unknown'), { x: 1605, y: 215 });
});

test('calculatePosition uses width and height independently', () => {
  const pos = calculatePosition(display, {
    width: 400,
    height: 200,
    margin: 15,
    position: 'bottom-right',
  });
  assert.deepEqual(pos, { x: 1605, y: 1065 });
});

test('clampOpacity keeps values in the unit interval', () => {
  assert.equal(clampOpacity(0.7), 0.7);
  assert.equal(clampOpacity(0), 0);
  assert.equal(clampOpacity(1), 1);
  assert.equal(clampOpacity(-0.2), 0);
  assert.equal(clampOpacity(1.4), 1);
});

test('shapeRadius maps circle and rectangle', () => {
  assert.equal(shapeRadius('circle', 12), '50%');
  assert.equal(shapeRadius('rectangle', 0), '0px');
  assert.equal(shapeRadius('rectangle', 24), '24px');
  assert.equal(shapeRadius('rectangle', -4), '0px');
  assert.equal(shapeRadius('unknown', 8), '50%');
});

test('applyTemplate replaces known keys only', () => {
  const html = applyTemplate('a {{json}} {{missing}}', { json: '{"ok":1}' });
  assert.equal(html, 'a {"ok":1} {{missing}}');
});
