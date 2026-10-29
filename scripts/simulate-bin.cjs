'use strict';
const { randomUUID } = require('node:crypto');
const { db, account } = require('./local-api.cjs');
const binId = process.argv[2] || 'BIN-01';
const type = process.argv[3] || 'plastic';
if (!/^[A-Z0-9_-]+$/.test(binId) || !/^[a-z0-9_-]+$/.test(type)) throw new Error('Invalid bin/type');
const txId = 'USB-' + randomUUID();
account('signInWithPassword', 'bin01@devices.greenschool.app', 'device-demo-123')
  .then(device => db(`events/${txId}`, 'PUT', { txId, binId, type, deviceUid: device.localId, source: 'esp32', status: 'pending', ts: { '.sv': 'timestamp' } }, device.idToken))
  .then(() => console.log(`Sent ${txId}. Check events/${txId} in Emulator UI.`))
  .catch((e) => { console.error(e.message); process.exitCode = 1; });
