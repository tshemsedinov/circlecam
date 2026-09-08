'use strict';

const POSITIONS = {
  'top-left': ({ left, top }) => ({ x: left, y: top }),
  'top-right': ({ right, top }) => ({ x: right, y: top }),
  'bottom-right': ({ right, bottom }) => ({ x: right, y: bottom }),
  'bottom-left': ({ left, bottom }) => ({ x: left, y: bottom }),
  center: ({ centerX, centerY }) => ({ x: centerX, y: centerY }),
};

const applyTemplate = (template, values) =>
  template.replace(/{{(\w+)}}/g, (token, key) => {
    if (Object.hasOwn(values, key) === false) return token;
    return `${values[key]}`;
  });

const calculatePosition = (display, size, margin, position) => {
  const bounds = display.bounds;
  const left = bounds.x + margin;
  const right = bounds.x + bounds.width - size - margin;
  const top = bounds.y + margin;
  const bottom = bounds.y + bounds.height - size - margin;
  const centerX = bounds.x + Math.round((bounds.width - size) / 2);
  const centerY = bounds.y + Math.round((bounds.height - size) / 2);
  const edges = { left, right, top, bottom, centerX, centerY };
  const locate = POSITIONS[position] ?? POSITIONS['top-right'];
  return locate(edges);
};

module.exports = { applyTemplate, calculatePosition };
