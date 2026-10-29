'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require('./prepare-hosting.cjs');
const env = { ...process.env, FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true', CI: 'true' };
// Isolate CLI preferences from the user's Google account and avoid PowerShell .ps1 policies.
env.XDG_CONFIG_HOME = path.join(root, '.cache', 'firebase-config');
fs.mkdirSync(env.XDG_CONFIG_HOME, { recursive: true });
if (process.platform === 'win32') {
  const javaRoot = 'C:/Program Files/Eclipse Adoptium';
  if (!env.JAVA_HOME && fs.existsSync(javaRoot)) {
    const dir = fs.readdirSync(javaRoot).find((name) => name.startsWith('jdk-21') && fs.existsSync(path.join(javaRoot, name, 'bin/java.exe')));
    if (dir) env.JAVA_HOME = path.join(javaRoot, dir);
  }
}
if (env.JAVA_HOME) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = path.join(env.JAVA_HOME, 'bin') + path.delimiter + (env[pathKey] || '');
}
if (spawnSync('java', ['-version'], { env }).status !== 0) {
  console.error('Java not found. Install JDK 21 and set JAVA_HOME to its installation directory.');
  process.exit(1);
}
let cli;
try { cli = require.resolve('firebase-tools/lib/bin/firebase.js'); }
catch {
  const globalCli = path.join(env.APPDATA || '', 'npm/node_modules/firebase-tools/lib/bin/firebase.js');
  if (process.platform === 'win32' && fs.existsSync(globalCli)) cli = globalCli;
  else { console.error('Firebase CLI not found. Run npm.cmd install first.'); process.exit(1); }
}
const test = process.argv[2] === 'test';
if (process.argv.length > (test ? 3 : 2) || (process.argv[2] && !test)) throw new Error('Only local emulator commands are supported.');
if (test) env.GS_EMULATOR_TEST = '1';
const args = [cli, test ? 'emulators:exec' : 'emulators:start', '--project', 'demo-green-school', '--only', 'auth,database,functions,hosting'];
if (test) args.push('node --test tests/emulator.integration.cjs');
else {
  if (fs.existsSync(path.join(root, '.emulator-data/firebase-export-metadata.json'))) args.push('--import', '.emulator-data');
  args.push('--export-on-exit', '.emulator-data');
  console.log('Web: http://127.0.0.1:5000/?firebase=emulator | UI: http://127.0.0.1:4000');
}
const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
