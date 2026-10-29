'use strict';
const { initializeApp } = require('firebase-admin/app');
const { onValueCreated } = require('firebase-functions/v2/database');
const { scoreEvent } = require('./scoring');

initializeApp();
exports.processBinEvent = onValueCreated({
  ref: '/events/{txId}',
  region: process.env.FUNCTIONS_EMULATOR === 'true' ? 'us-central1' : 'asia-southeast1',
  retry: true
}, async (event) => {
  // Use the triggering instance, rather than silently writing to another database.
  await event.data.ref.root.transaction((root) => root === null ? null : scoreEvent(root, event.params.txId, Date.now()), undefined, false);
});
