'use strict';
const fs = require('node:fs');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { runWorker } = require('./worker.cjs');

const PROJECT_ID = 'smarttrashbin-98428';
const DATABASE_URL = 'https://smarttrashbin-98428-default-rtdb.asia-southeast1.firebasedatabase.app';

function readServiceAccount(file) {
  if (!file) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS in .env to your service account JSON path. See README.md.');
  let key;
  try { key = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('Cannot read service account JSON. Check its path and format; do not paste the key into source code.'); }
  if (key?.type !== 'service_account' || key.project_id !== PROJECT_ID) {
    throw new Error(`Use a service account key for project ${PROJECT_ID}.`);
  }
  if (typeof key.private_key !== 'string' || typeof key.client_email !== 'string') {
    throw new Error('Service account JSON is missing private_key or client_email.');
  }
  return key;
}

async function main() {
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    throw new Error('Remove FIREBASE_DATABASE_EMULATOR_HOST to run the cloud laptop backend.');
  }
  const credential = cert(readServiceAccount(process.env.GOOGLE_APPLICATION_CREDENTIALS));
  const app = initializeApp({ credential, projectId: PROJECT_ID, databaseURL: DATABASE_URL });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await credential.getAccessToken();
    const database = getDatabase(app);
    await database.ref('events').orderByChild('status').equalTo('pending').limitToFirst(1).get();
    console.log(`Backend ready: ${PROJECT_ID}. Keep this window open; Ctrl+C to stop.`);
    await Promise.race([
      runWorker(database, { signal: controller.signal }),
      new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }))
    ]);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await deleteApp(app);
  }
}

if (require.main === module) {
  main().catch(error => {
    // Credential/HTTP errors can contain secrets; only our configuration errors have safe messages.
    console.error(error.constructor === Error ? error.message : `Backend failed: ${error.code || error.name}. Check service account permissions and Internet.`);
    process.exitCode = 1;
  });
}

module.exports = { readServiceAccount };
