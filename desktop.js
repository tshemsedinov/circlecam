#!/usr/bin/env node
'use strict';

const path = require('node:path');

const desktop = require('./lib/desktop.js');
const { installDesktop, resolveDataHome, refreshDesktop } = desktop;

const ROOT = __dirname;
const ICON_SOURCE = path.join(ROOT, 'assets', 'circlecam.svg');

const fail = (error) => {
  const message = error.message ?? `${error}`;
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

const dataHome = resolveDataHome(process.env);
if (!dataHome.ok) fail(dataHome.error);

const installed = installDesktop({
  dataHome: dataHome.value,
  root: ROOT,
  nodePath: process.execPath,
  iconSource: ICON_SOURCE,
});
if (!installed.ok) fail(installed.error);

const { desktopPath, iconPath } = installed.value;
const applicationsDir = path.dirname(desktopPath);
refreshDesktop(applicationsDir);

console.log(`Desktop launcher: ${desktopPath}`);
console.log(`Icon: ${iconPath}`);
console.log('Open the Apps grid and search for CircleCam.');
