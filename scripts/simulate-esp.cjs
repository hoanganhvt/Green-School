'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const python = process.env.GS_PYTHON || (process.platform === 'win32'
  ? path.join(root, '.venv/Scripts/python.exe') : 'python3');
const result = spawnSync(python, ['hardware/simulate_esp.py', '--self-test'], {
  cwd: root, stdio: 'inherit', timeout: 60000
});
if (result.error) console.error('Cannot run simulator:', result.error.message);
process.exitCode = result.status ?? 1;
