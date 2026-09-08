'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  APP_NAME,
  DESKTOP_FILE,
  ICON_FILE,
  quoteArg,
  resolveDataHome,
  buildDesktopEntry,
  installDesktop,
} = require('../lib/desktop.js');

const writeTempRoot = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circlecam-desktop-'));
  const root = path.join(dir, 'app');
  const dataHome = path.join(dir, 'share');
  const iconSource = path.join(root, 'icon.svg');
  fs.mkdirSync(root);
  fs.writeFileSync(iconSource, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return { dir, root, dataHome, iconSource };
};

const removeDir = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
};

test('quoteArg leaves safe paths unquoted', () => {
  assert.equal(quoteArg('/usr/bin/node'), '/usr/bin/node');
});

test('quoteArg quotes paths with spaces', () => {
  const quoted = quoteArg('/home/me/My Apps/node');
  assert.equal(quoted, '"/home/me/My Apps/node"');
});

test('resolveDataHome prefers XDG_DATA_HOME', () => {
  const resolved = resolveDataHome({
    XDG_DATA_HOME: '/custom/data',
    HOME: '/home/u',
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.value, '/custom/data');
});

test('resolveDataHome falls back to ~/.local/share', () => {
  const resolved = resolveDataHome({ HOME: '/home/u' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.value, '/home/u/.local/share');
});

test('resolveDataHome fails when HOME is missing', () => {
  const resolved = resolveDataHome({});
  assert.equal(resolved.ok, false);
});

test('buildDesktopEntry writes required keys', () => {
  const text = buildDesktopEntry({
    exec: '/n /s',
    cwd: '/proj',
    icon: '/i.svg',
  });
  assert.equal(text.includes('[Desktop Entry]'), true);
  assert.equal(text.includes(`Name=${APP_NAME}`), true);
  assert.equal(text.includes('Type=Application'), true);
  assert.equal(text.includes('Terminal=false'), true);
  assert.equal(text.includes('Exec=/n /s'), true);
  assert.equal(text.includes('Path=/proj'), true);
  assert.equal(text.includes('Icon=/i.svg'), true);
  assert.equal(text.endsWith('\n'), true);
});

test('installDesktop writes launcher and copies icon', () => {
  const { dir, root, dataHome, iconSource } = writeTempRoot();
  try {
    const installed = installDesktop({
      dataHome,
      root,
      nodePath: '/opt/node/bin/node',
      iconSource,
    });
    assert.equal(installed.ok, true);
    const { desktopPath, iconPath } = installed.value;
    const expectedDesktop = path.join(dataHome, 'applications', DESKTOP_FILE);
    const expectedIcon = path.join(
      dataHome,
      'icons',
      'hicolor',
      'scalable',
      'apps',
      ICON_FILE,
    );
    assert.equal(desktopPath, expectedDesktop);
    assert.equal(iconPath, expectedIcon);
    const text = fs.readFileSync(desktopPath, 'utf8');
    assert.equal(text.includes('Exec=/opt/node/bin/node '), true);
    assert.equal(text.includes(path.join(root, 'circlecam.js')), true);
    assert.equal(text.includes(`Path=${root}`), true);
    assert.equal(text.includes(`Icon=${iconPath}`), true);
    assert.equal(fs.existsSync(iconPath), true);
  } finally {
    removeDir(dir);
  }
});

test('installDesktop fails when the icon is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circlecam-desktop-'));
  try {
    const installed = installDesktop({
      dataHome: path.join(dir, 'share'),
      root: dir,
      nodePath: '/opt/node/bin/node',
      iconSource: path.join(dir, 'missing.svg'),
    });
    assert.equal(installed.ok, false);
  } finally {
    removeDir(dir);
  }
});
