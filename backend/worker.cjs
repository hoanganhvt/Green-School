'use strict';
const { setTimeout: delay } = require('node:timers/promises');
const { scoreEvent } = require('./scoring.cjs');

async function processEvent(database, id) {
  const result = await database.ref().transaction(
    // A cold SDK cache can initially supply null; let the server retry with its data.
    root => root === null ? null : scoreEvent(root, id, Date.now()), undefined, false
  );
  if (!result.committed) return null;
  return result.snapshot.child(`events/${id}`).val();
}

async function processPending(database, { signal, log = console.log } = {}) {
  const snapshot = await database.ref('events').orderByChild('status').equalTo('pending').limitToFirst(100).get();
  const events = [];
  snapshot.forEach(child => { events.push({ id: child.key, ts: Number(child.val().ts) || 0 }); });
  events.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  for (const { id } of events) {
    if (signal?.aborted) break;
    const event = await processEvent(database, id);
    if (event) log(`${event.status.toUpperCase()} ${id}${event.status === 'processed' ? `: +${event.points} points` : `: ${event.reason}`}`);
  }
}

async function runWorker(database, { signal, log = console.log, onError = console.error } = {}) {
  // shortcut: poll up to 100 pending events per pass; use a dedicated queue for larger schools.
  while (!signal?.aborted) {
    try { await processPending(database, { signal, log }); }
    catch (error) {
      onError(`Backend retry: ${error.code || error.name}. Check Internet and Firebase permissions.`);
    }
    try { await delay(1000, undefined, { signal }); }
    catch (error) { if (error.name !== 'AbortError') throw error; }
  }
}

module.exports = { processEvent, processPending, runWorker };
