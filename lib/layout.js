'use strict';

const POSITIONS = {
  'top-left': ({ left, top }) => ({ x: left, y: top }),
  'top-right': ({ right, top }) => ({ x: right, y: top }),
  'bottom-right': ({ right, bottom }) => ({ x: right, y: bottom }),
  'bottom-left': ({ left, bottom }) => ({ x: left, y: bottom }),
  center: ({ centerX, centerY }) => ({ x: centerX, y: centerY }),
};

const SHAPE_RADIUS = {
  circle: () => '50%',
  rectangle: (radius) => {
    const px = radius < 0 ? 0 : radius;
    return `${px}px`;
  },
};

const applyTemplate = (template, values) =>
  template.replace(/{{(\w+)}}/g, (token, key) => {
    if (Object.hasOwn(values, key) === false) return token;
    return `${values[key]}`;
  });

const shapeRadius = (shape, radius) => {
  const toCss = SHAPE_RADIUS[shape] ?? SHAPE_RADIUS.circle;
  return toCss(radius);
};

const clampOpacity = (opacity) => {
  if (opacity < 0) return 0;
  if (opacity > 1) return 1;
  return opacity;
};

const calculatePosition = (display, options) => {
  const { width, height, margin, position } = options;
  const bounds = display.bounds;
  const left = bounds.x + margin;
  const right = bounds.x + bounds.width - width - margin;
  const top = bounds.y + margin;
  const bottom = bounds.y + bounds.height - height - margin;
  const centerX = bounds.x + Math.round((bounds.width - width) / 2);
  const centerY = bounds.y + Math.round((bounds.height - height) / 2);
  const edges = { left, right, top, bottom, centerX, centerY };
  const locate = POSITIONS[position] ?? POSITIONS['top-right'];
  return locate(edges);
};

module.exports = {
  applyTemplate,
  shapeRadius,
  clampOpacity,
  calculatePosition,
};
