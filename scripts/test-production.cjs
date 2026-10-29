'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: { GS: {} }, location: { hostname: 'smarttrashbin-98428.web.app', search: '' }, URLSearchParams };
context.GS = context.window.GS;
vm.runInNewContext(fs.readFileSync('assets/js/config.js', 'utf8'), context);
const cfg = context.GS.FIREBASE_CONFIG;
const origin = `https://${cfg.projectId}.web.app`;
async function main() {
  assert.ok(process.env.GS_ADMIN_PASSWORD, 'Set GS_ADMIN_PASSWORD for the cloud smoke test');
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  const html = await page.text();
  for (const [, src] of html.matchAll(/(?:src|href)="((?:assets\/)[^"]+)"/g)) {
    assert.equal((await fetch(`${origin}/${src}`)).status, 200, src);
  }
  for (const file of ['firebase.json', 'backend/index.cjs', 'backend/scoring.cjs', '.env', '.secrets/firebase-service-account.json', 'package.json']) {
    assert.equal((await fetch(`${origin}/${file}`)).status, 404, `${file} must not be public`);
  }
  const mapping = await (await fetch(`${cfg.databaseURL}/usernames/admin.json`)).json();
  assert.ok(mapping.email);
  async function login(password) {
    return fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: mapping.email, password, returnSecureToken: true })
    });
  }
  assert.equal((await login('deliberately-wrong-password')).status, 400);
  const response = await login(process.env.GS_ADMIN_PASSWORD);
  assert.equal(response.status, 200);
  const auth = await response.json();
  const db = (path, method = 'GET', value) => fetch(`${cfg.databaseURL}/${path}.json?auth=${encodeURIComponent(auth.idToken)}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) })
  });
  assert.equal(await (await db(`admins/${auth.localId}`)).json(), true);
  assert.equal((await (await db(`users/${auth.localId}`)).json()).status, 'active');
  assert.equal((await fetch(`${cfg.databaseURL}/users.json`)).status, 401);
  assert.equal((await fetch(`${cfg.databaseURL}/classes/UNAUTHORIZED.json`, { method: 'PUT', body: '123' })).status, 401);
  const testBin = `SMOKE-${Date.now()}`;
  try {
    assert.equal((await db(`bins/${testBin}`, 'PUT', { id: testBin, name: 'Temporary smoke test' })).status, 200);
    assert.equal((await (await db(`bins/${testBin}`)).json()).id, testBin);
  } finally {
    assert.equal((await db(`bins/${testBin}`, 'DELETE')).status, 200);
  }
  console.log('PASS: live HTML/assets, private source files, admin login, wrong password, admin role, protected profiles, anonymous write denied, admin CRUD and cleanup.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
