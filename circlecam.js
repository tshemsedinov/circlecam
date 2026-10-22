#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { Result } = require('metautil');

const { fail } = require('./lib/cli.js');
const { loadConfig } = require('./lib/config.js');
const layout = require('./lib/layout.js');
const { calculatePosition, shapeRadius, clampOpacity } = layout;

const CONFIG_PATH = path.join(__dirname, 'config.json');
const RENDERER_PATH = path.join(__dirname, 'renderer.html');

const LINUX_READY_MS = 300; // first frameless window needs an ARGB visual
const REVEAL_MS = 400; // fallback when ready-to-show never fires

const GL_SWITCHES = [
  ['enable-transparent-visuals'],
  ['use-gl', 'angle'],
  ['use-angle', 'swiftshader'],
];

process.on('uncaughtException', (error) => {
  console.error('Uncaught:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

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
  const flags = GL_SWITCHES.map((item) => `--${item.join('=')}`);
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
  const result = spawnSync(electronPath, flags, { stdio: 'inherit', env });
  if (result.error !== undefined) {
    console.error(result.error.message);
    process.exit(1);
  }
  const signalCode = result.signal === null ? 0 : 1;
  process.exit(result.status ?? signalCode);
};

const electronVersion = process.versions.electron ?? '';
const runAsNode = readEnv('ELECTRON_RUN_AS_NODE');
const isGui = electronVersion !== '' && runAsNode === '';
if (isGui === false) spawnElectronGui(config.nativeWayland);

const electron = require('electron');
const { app, BrowserWindow, screen, session } = electron;
const { resolveCameraQuery } = require('./lib/camera.js');

if (shouldForceX11(config.nativeWayland)) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

if (process.platform === 'linux') {
  for (const item of GL_SWITCHES) app.commandLine.appendSwitch(...item);
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const resolved = Result.from(() => resolveCameraQuery(config.camera));
if (!resolved.ok) fail(resolved.error);

const view = {
  camera: resolved.value,
  minFps: config.minFps,
  radius: shapeRadius(config.shape, config.radius),
  opacity: clampOpacity(config.opacity),
  mirror: config.mirror,
};

const orderedDisplays = () => {
  const primary = screen.getPrimaryDisplay();
  const all = screen.getAllDisplays();
  const rest = all.filter((display) => display.id !== primary.id);
  return [primary, ...rest];
};

const pickDisplay = (displays) => {
  const monitor = config.monitor;
  const display = displays[monitor];
  if (display !== undefined) return display;
  const missing = `WARNING: monitor ${monitor} does not exist`;
  console.warn(`${missing}; using monitor 0.`);
  return displays[0];
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
    const label = item.label || item.id;
    const size = `${bounds.width}x${bounds.height}`;
    const at = `(${bounds.x}, ${bounds.y})`;
    console.log(`  ${index}: ${label} ${size} at ${at}`);
  }
};

const buildWindow = (pos) => {
  const { x, y } = pos;
  const { width, height } = config;
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
  return win;
};

const onConsoleMessage = (event) => {
  const message = event.message;
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
      const mediaTypes = details?.mediaTypes ?? [];
      const allow = mediaTypes.length === 0 || mediaTypes.includes('video');
      callback(allow);
    },
  );
};

class Overlay {
  constructor() {
    this.win = null;
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
    const pos = calculatePosition(display, config);
    const { position } = config;
    console.log(`Requested position: ${position} (${pos.x}, ${pos.y})`);
    this.win = buildWindow(pos);
    this.bindWindow();
    const query = { config: JSON.stringify(view) };
    this.win.loadFile(RENDERER_PATH, { query });
    this.scheduleReveal(pos);
  }

  bindWindow() {
    const win = this.win;
    win.webContents.on('before-input-event', (_event, input) => {
      this.onBeforeInput(input);
    });
    win.webContents.on('console-message', onConsoleMessage);
    win.on('closed', () => {
      this.win = null;
      app.quit();
    });
  }

  scheduleReveal(pos) {
    const reveal = () => this.reveal(pos);
    this.win.once('ready-to-show', reveal);
    setTimeout(reveal, REVEAL_MS);
  }

  reveal(pos) {
    const win = this.win;
    if (this.revealed || win === null || win.isDestroyed()) return;
    this.revealed = true;
    win.show();
    // window managers place a window when it is first mapped
    const { x, y } = pos;
    const { width, height } = config;
    win.setBounds({ x, y, width, height });
    win.setAlwaysOnTop(true);
    const bounds = JSON.stringify(win.getBounds());
    console.log(`Window shown: bounds=${bounds}`);
  }

  onBeforeInput(input) {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const altF4 = input.alt === true && key === 'f4';
    if (altF4 === false && key !== 'escape') return;
    if (this.win === null) return;
    this.win.close();
  }
}

const overlay = new Overlay();
overlay.start();
