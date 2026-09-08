'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { Result } = require('metautil');

const APP_ID = 'circlecam';
const APP_NAME = 'CircleCam';
const APP_COMMENT = 'Circular webcam overlay';
const DESKTOP_FILE = `${APP_ID}.desktop`;
const ICON_FILE = `${APP_ID}.svg`;

const SAFE_ARG = /^[A-Za-z0-9_./:=+-]+$/;

const quoteArg = (value) => {
  if (SAFE_ARG.test(value)) return value;
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `"${escaped}"`;
};

const resolveDataHome = (env) => {
  const xdg = env.XDG_DATA_HOME ?? '';
  if (xdg !== '') return Result.ok(xdg);
  const home = env.HOME ?? '';
  if (home === '') {
    const error = new Error('HOME is not set');
    return Result.fail(error);
  }
  const dataHome = path.join(home, '.local', 'share');
  return Result.ok(dataHome);
};

const buildDesktopEntry = (fields) => {
  const { exec, cwd, icon } = fields;
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${APP_NAME}`,
    `Comment=${APP_COMMENT}`,
    `Exec=${exec}`,
    `Path=${cwd}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Video;AudioVideo;',
    'StartupNotify=false',
    'StartupWMClass=CircleCam',
    'Keywords=webcam;camera;overlay;',
  ];
  return `${lines.join('\n')}\n`;
};

const installDesktop = (options) => {
  const { dataHome, root, nodePath, iconSource } = options;
  return Result.from(() => {
    const scriptPath = path.join(root, 'circlecam.js');
    const applicationsDir = path.join(dataHome, 'applications');
    const iconDir = path.join(dataHome, 'icons', 'hicolor', 'scalable', 'apps');
    fs.mkdirSync(applicationsDir, { recursive: true });
    fs.mkdirSync(iconDir, { recursive: true });
    const iconDest = path.join(iconDir, ICON_FILE);
    fs.copyFileSync(iconSource, iconDest);
    const nodeArg = quoteArg(nodePath);
    const scriptArg = quoteArg(scriptPath);
    const exec = `${nodeArg} ${scriptArg}`;
    const text = buildDesktopEntry({ exec, cwd: root, icon: iconDest });
    const desktopPath = path.join(applicationsDir, DESKTOP_FILE);
    fs.writeFileSync(desktopPath, text, 'utf8');
    return { desktopPath, iconPath: iconDest };
  });
};

const refreshDesktop = (applicationsDir) => {
  const args = [applicationsDir];
  const result = spawnSync('update-desktop-database', args, {
    encoding: 'utf8',
  });
  if (result.error !== undefined) return false;
  return result.status === 0;
};

module.exports = {
  APP_ID,
  APP_NAME,
  APP_COMMENT,
  DESKTOP_FILE,
  ICON_FILE,
  quoteArg,
  resolveDataHome,
  buildDesktopEntry,
  installDesktop,
  refreshDesktop,
};
