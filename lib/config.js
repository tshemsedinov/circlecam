'use strict';

const fs = require('node:fs');

const { Struct, Result, isHashObject, projection } = require('metautil');

const Config = Struct.immutable('Config', {
  camera: 'auto',
  position: 'top-right',
  shape: 'circle',
  width: 430,
  height: 430,
  radius: 0,
  opacity: 1,
  margin: 15,
  monitor: 0,
  minFps: 30,
  mirror: false,
  nativeWayland: false,
});

const loadConfig = (filePath) => {
  const parsed = Result.from(() => {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  });
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  if (!isHashObject(data)) {
    const error = new Error(`Invalid config ${filePath}: expected object`);
    return Result.fail(error);
  }
  const picked = projection(data, Config.fields);
  return Result.from(() => Config.create(picked));
};

module.exports = { loadConfig, Config };
