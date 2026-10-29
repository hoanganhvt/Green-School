'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load(hostname, search) {
  const GS = {};
  const context = { GS, window: { GS }, location: { hostname, search }, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/config.js'), 'utf8'), context);
  return GS;
}
test('emulator opt-in is restricted to loopback and demo project', () => {
  assert.equal(load('localhost', '?firebase=emulator').USE_EMULATORS, true);
  assert.equal(load('127.0.0.1', '?firebase=emulator').EMULATOR_CONFIG.projectId, 'demo-green-school');
  assert.equal(load('localhost', '').USE_EMULATORS, false);
  assert.equal(load('example.com', '?firebase=emulator').USE_EMULATORS, false);
});
test('production uses SMARTTRASHBIN even when demo settings were saved', () => {
  const GS = load('smarttrashbin-98428.web.app', '');
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/core/services.js'), 'utf8'), {
    window: { GS }, location: { hostname: 'smarttrashbin-98428.web.app' },
    localStorage: { getItem() { throw new Error('Production must use configured project'); } }
  });
  assert.equal(GS.svc.firebaseConfig().projectId, 'smarttrashbin-98428');
});
test('emulator config wins over saved production settings and forced demo', () => {
  const GS = load('localhost', '?firebase=emulator');
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/core/services.js'), 'utf8'), {
    window: { GS }, localStorage: { getItem() { throw new Error('Must not read saved production config'); } }
  });
  assert.equal(GS.svc.firebaseConfig().projectId, 'demo-green-school');
  assert.equal(GS.svc.configSource(), 'emulator');
  GS.db = { mode: 'firebase', onQuery() { throw new Error('Browser must not process Firebase events'); } };
  assert.equal(typeof GS.svc.startProcessor(), 'function');
});
