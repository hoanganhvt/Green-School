'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readServiceAccount } = require('../backend/index.cjs');
const { processPending, runWorker } = require('../backend/worker.cjs');

test('backend requires a service account for the intended project and does not print its contents', t => {
  assert.throws(() => readServiceAccount(), /GOOGLE_APPLICATION_CREDENTIALS/);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'green-school-backend-'));
  const file = path.join(folder, 'key.json');
  t.after(() => { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(folder); });
  fs.writeFileSync(file, 'secret-not-json');
  assert.throws(() => readServiceAccount(file), error => !error.message.includes('secret-not-json'));
  fs.writeFileSync(file, JSON.stringify({ type: 'service_account', project_id: 'other-project', private_key: 'secret' }));
  assert.throws(() => readServiceAccount(file), /smarttrashbin-98428/);
  fs.writeFileSync(file, JSON.stringify({ type: 'service_account', project_id: 'smarttrashbin-98428' }));
  assert.throws(() => readServiceAccount(file), /missing private_key or client_email/);
});

test('worker processes pending drops in timestamp order, without logging duplicate deliveries', async () => {
  const processed = [], logs = [];
  const snapshot = { forEach(fn) {
    for (const [key, ts] of [['late', 20], ['early', 10]]) fn({ key, val: () => ({ ts }) });
  } };
  const query = {
    orderByChild(field) { assert.equal(field, 'status'); return this; },
    equalTo(value) { assert.equal(value, 'pending'); return this; },
    limitToFirst(value) { assert.equal(value, 100); return this; },
    async get() { return snapshot; }
  };
  const database = { ref(location) {
    if (location === 'events') return query;
    return { async transaction(update) {
      assert.equal(update(null), null, 'cold cache must not abort transaction');
      const id = processed.length ? 'late' : 'early';
      processed.push(id);
      return { committed: id === 'early', snapshot: { child: () => ({ val: () => ({ status: 'processed', points: 2 }) }) } };
    } };
  } };
  await processPending(database, { log: value => logs.push(value) });
  assert.deepEqual(processed, ['early', 'late']);
  assert.deepEqual(logs, ['PROCESSED early: +2 points']);
});

test('worker retries a network failure, hides error details and stops cleanly', async () => {
  const controller = new AbortController();
  const errors = [];
  const database = { ref() { throw new Error('secret credential or URL'); } };
  await runWorker(database, { signal: controller.signal, onError(message) {
    errors.push(message);
    controller.abort();
  } });
  assert.equal(errors.length, 1);
  assert.doesNotMatch(errors[0], /secret credential/);
});
