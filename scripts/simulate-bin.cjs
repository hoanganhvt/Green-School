'use strict';
const { randomUUID } = require('node:crypto');
const { db } = require('./local-api.cjs');
const binId = process.argv[2] || 'BIN-01';
const type = process.argv[3] || 'plastic';
if (!/^[A-Z0-9_-]+$/.test(binId) || !/^[a-z0-9_-]+$/.test(type)) throw new Error('Invalid bin/type');
const txId = 'USB-' + randomUUID();
db(`bins/${binId}/activeSession`)
  .then(session => {
    if (!session) throw new Error('Scan the bin QR to open a student session first.');
    return db(`events/${txId}`, 'PUT', { txId, binId, type, studentCode: session.studentCode, username: session.username, source: 'esp32', status: 'pending', ts: { '.sv': 'timestamp' } });
  })
  .then(() => console.log(`Sent ${txId}. Check events/${txId} in Emulator UI.`))
  .catch((e) => { console.error(e.message); process.exitCode = 1; });
