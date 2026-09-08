#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { Result } = require('metautil');

const { loadConfig } = require('./lib/config.js');
const { applyTemplate, calculatePosition } = require('./lib/layout.js');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const RENDERER_PATH = path.join(__dirname, 'renderer.html');

const LINUX_READY_MS = 300; // first frameless window needs an ARGB visual
const REVEAL_MS = 400;
const PLACE_MS = 150;

const GL_SWITCHES = [
  { name: 'enable-transparent-visuals', value: null },
  { name: 'use-gl', value: 'angle' },
  { name: 'use-angle', value: 'swiftshader' },
];

process.on('uncaughtException', (error) => {
  console.error('Uncaught:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

const fail = (error) => {
  const message = error.message ?? `${error}`;
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

const readEnv = (name) => process.env[name] ?? '';

const shouldForceX11 = (nativeWayland) => {
  const type = readEnv('XDG_SESSION_TYPE').toLowerCase();
  const wayland = type === 'wayland';
  const display = readEnv('DISPLAY') !== '';
  return nativeWayland === false && wayland && display;
};

const loaded = loadConfig(CONFIG_PATH);
if (!loaded.ok) fail(loaded.error);
const config = loaded.value;

const electronFlags = (nativeWayland) => {
  const flags = [];
  for (const item of GL_SWITCHES) {
    if (item.value === null) flags.push(`--${item.name}`);
    else flags.push(`--${item.name}=${item.value}`);
  }
  if (shouldForceX11(nativeWayland)) flags.push('--ozone-platform=x11');
  flags.push(__filename);
  return flags;
};

const spawnElectronGui = (nativeWayland) => {
  const located = Result.from(() => require('electron'));
  if (!located.ok) {
    console.error('Electron is not installed.');
    console.error('Run: npm install electron');
    console.error(located.error.message);
    process.exit(1);
  }
  const electronPath = located.value;
  if (typeof electronPath !== 'string') {
    console.error('Could not locate the Electron binary.');
    process.exit(1);
  }
  const flags = electronFlags(nativeWayland);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const stdio = 'inherit';
  const options = { stdio, env };
  const result = spawnSync(electronPath, flags, options);
  if (result.error !== undefined) {
    console.error(result.error.message);
    process.exit(1);
  }
  const status = result.status;
  if (status !== null && status !== undefined) process.exit(status);
  if (result.signal !== null && result.signal !== undefined) process.exit(1);
  process.exit(0);
};

const electronVersion = process.versions.electron ?? '';
const runAsNode = readEnv('ELECTRON_RUN_AS_NODE');
const isGui = electronVersion !== '' && runAsNode === '';
if (isGui === false) spawnElectronGui(config.nativeWayland);

const electron = require('electron');
const { app, BrowserWindow, screen, session } = electron;
const { resolveCameraDevice, openBestCameraMode } = require('./lib/camera.js');

if (shouldForceX11(config.nativeWayland)) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

if (process.platform === 'linux') {
  for (const item of GL_SWITCHES) {
    if (item.value === null) app.commandLine.appendSwitch(item.name);
    else app.commandLine.appendSwitch(item.name, item.value);
  }
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const rendererLoaded = Result.from(() =>
  fs.readFileSync(RENDERER_PATH, 'utf8'),
);
if (!rendererLoaded.ok) fail(rendererLoaded.error);
const RENDERER_HTML = rendererLoaded.value;

const selected = Result.from(() => {
  const device = resolveCameraDevice(config.camera, config.minFps);
  return openBestCameraMode(device, config.minFps);
});
if (!selected.ok) fail(selected.error);
const selectedMode = selected.value;

const orderedDisplays = () => {
  const primary = screen.getPrimaryDisplay();
  const all = screen.getAllDisplays();
  const rest = all.filter((display) => display.id !== primary.id);
  return [primary, ...rest];
};

const pickDisplay = (displays) => {
  const monitor = config.monitor;
  const display = displays[monitor] ?? displays[0];
  if (displays[monitor] === undefined) {
    const missing = `WARNING: monitor ${monitor} does not exist`;
    console.warn(`${missing}; using monitor 0.`);
  }
  return display;
};

const logSession = (displays) => {
  const sessionName = readEnv('XDG_SESSION_TYPE');
  const sessionLabel = sessionName === '' ? 'unknown' : sessionName;
  const ozone = app.commandLine.getSwitchValue('ozone-platform');
  const backend = ozone === '' ? 'default' : ozone;
  console.log(`\nSession: ${sessionLabel}`);
  console.log(`Electron backend request: ${backend}`);
  console.log('Detected monitors:');
  for (let index = 0; index < displays.length; index += 1) {
    const item = displays[index];
    const bounds = item.bounds;
    let label = item.label;
    if (label === undefined || label === '') label = item.id;
    const size = `${bounds.width}x${bounds.height}`;
    const at = `(${bounds.x}, ${bounds.y})`;
    console.log(`  ${index}: ${label} ${size} at ${at}`);
  }
};

const buildWindow = (pos) => {
  const { x, y } = pos;
  const { size: width } = config;
  const height = width;
  const webPreferences = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false,
  };
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences,
  });
  win.setAlwaysOnTop(true);
  return win;
};

const onConsoleMessage = (...args) => {
  const second = args[1];
  const isRecord = typeof second === 'object' && second !== null;
  const fromObject = isRecord && 'message' in second;
  const message = fromObject ? second.message : args[2];
  if (message === undefined || message === '') return;
  const text = `${message}`;
  if (text.includes('Electron Security Warning')) return;
  console.log(`[camera] ${text}`);
};

const configureMediaPermissions = () => {
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, _origin, details) => {
      if (permission !== 'media') return false;
      const mediaType = details?.mediaType;
      if (mediaType === undefined || mediaType === '') return true;
      return mediaType === 'video';
    },
  );
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission !== 'media') return void callback(false);
      const types = details?.mediaTypes;
      const mediaTypes = types === undefined ? [] : types;
      const allow = mediaTypes.length === 0 || mediaTypes.includes('video');
      callback(allow);
    },
  );
};

class Overlay {
  constructor(mode) {
    this.mode = mode;
    this.win = null;
    this.rendererFile = null;
    this.revealed = false;
  }

  start() {
    const onReady = () => {
      app.setName('CircleCam');
      configureMediaPermissions();
      const delay = process.platform === 'linux' ? LINUX_READY_MS : 0;
      setTimeout(() => this.createWindow(), delay);
    };
    app.whenReady().then(onReady).catch(fail);
    app.on('window-all-closed', () => app.quit());
  }

  createWindow() {
    const displays = orderedDisplays();
    const display = pickDisplay(displays);
    logSession(displays);
    const { size, margin, position } = config;
    const pos = calculatePosition(display, size, margin, position);
    console.log(`Requested position: ${position} (${pos.x}, ${pos.y})`);
    this.win = buildWindow(pos);
    this.bindWindow();
    this.loadRenderer();
    this.scheduleReveal(pos);
  }

  bindWindow() {
    const win = this.win;
    win.webContents.on('before-input-event', (event, input) => {
      this.onBeforeInput(event, input);
    });
    win.webContents.on('console-message', onConsoleMessage);
    win.on('closed', () => {
      this.win = null;
      this.unlinkRenderer();
      app.quit();
    });
  }

  loadRenderer() {
    const userData = app.getPath('userData');
    const rendererFile = path.join(userData, 'circlecam-renderer.html');
    this.rendererFile = rendererFile;
    const payload = { ...config, preferred: this.mode };
    const json = JSON.stringify(payload).replaceAll('<', '\\u003c');
    const mirrored = config.mirror === true;
    const mirrorCss = mirrored ? 'transform: scaleX(-1);' : '';
    const html = applyTemplate(RENDERER_HTML, { json, mirrorCss });
    const written = Result.from(() => {
      fs.writeFileSync(rendererFile, html, 'utf8');
    });
    if (!written.ok) fail(written.error);
    this.win.loadFile(rendererFile);
  }

  unlinkRenderer() {
    const rendererFile = this.rendererFile;
    if (rendererFile === null) return;
    this.rendererFile = null;
    const removed = Result.from(() => fs.unlinkSync(rendererFile));
    if (removed.ok) return;
    if (removed.error.code === 'ENOENT') return;
    console.error(removed.error.message);
  }

  scheduleReveal(pos) {
    const reveal = () => this.reveal(pos);
    const win = this.win;
    win.once('ready-to-show', reveal);
    win.webContents.once('did-finish-load', reveal);
    setTimeout(reveal, REVEAL_MS);
    setTimeout(() => this.placeWindow(pos), PLACE_MS);
  }

  reveal(pos) {
    const win = this.win;
    if (win === null || win.isDestroyed()) return;
    this.placeWindow(pos);
    if (win.isVisible() === false) win.show();
    win.setAlwaysOnTop(true);
    if (this.revealed) return;
    this.revealed = true;
    const visible = win.isVisible();
    const bounds = JSON.stringify(win.getBounds());
    console.log(`Window shown: visible=${visible} bounds=${bounds}`);
  }

  placeWindow(pos) {
    const target = this.win;
    if (target === null || target === undefined) return;
    if (target.isDestroyed()) return;
    const { x, y } = pos;
    const { size: width } = config;
    const height = width;
    target.setBounds({ x, y, width, height });
    target.setAlwaysOnTop(true);
  }

  onBeforeInput(_event, input) {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const altF4 = input.alt === true && key === 'f4';
    if (altF4 === false && key !== 'escape') return;
    if (this.win === null) return;
    this.win.close();
  }
}

const overlay = new Overlay(selectedMode);
overlay.start();
