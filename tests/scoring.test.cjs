'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreEvent, weekKey } = require('../functions/scoring');
const now = Date.parse('2026-10-29T06:00:00Z');
function fixture(patch = {}) {
  return {
    settings: { rules: { plastic: { label: 'Nhựa', points: 2 }, metal: { label: 'Kim loại', points: 3 } }, cooldownSeconds: 3, sessionMinutes: 3 },
    bins: { 'BIN-01': { id: 'BIN-01', activeSession: { uid: 'u1', studentCode: 'S1', username: 'student', startedAt: now - 1000, expiresAt: now + 1000 } } },
    classes: { '10A1': { name: '10A1' } },
    students: { S1: { uid: 'u1', classId: '10A1', className: '10A1', fullName: 'An', username: 'student' } },
    users: { u1: { status: 'active', studentCode: 'S1' }, admin: { status: 'active' } },
    admins: { admin: true },
    devices: { device: { binId: 'BIN-01', enabled: true } },
    events: { TX1: { txId: 'TX1', binId: 'BIN-01', type: 'plastic', ts: now, deviceUid: 'device', source: 'esp32', status: 'pending', ...patch } }
  };
}
test('scores all aggregates and extends session atomically; redelivery is a no-op', () => {
  const root = fixture();
  assert.equal(scoreEvent(root, 'TX1', now), root);
  assert.equal(root.events.TX1.status, 'processed');
  assert.equal(root.students.S1.points, 2);
  assert.equal(root.classes['10A1'].points, 2);
  assert.equal(root.weekly[weekKey(now)]['10A1'].byType.plastic, 1);
  assert.equal(root.bins['BIN-01'].count, 1);
  assert.equal(root.bins['BIN-01'].activeSession.expiresAt, now + 180000);
  assert.equal(scoreEvent(root, 'TX1', now), undefined);
  root.events.TX1.status = 'pending';
  scoreEvent(root, 'TX1', now);
  assert.equal(root.events.TX1.status, 'rejected');
  assert.equal(root.students.S1.points, 2);
});
for (const [name, mutate] of [
  ['unknown type', r => { r.events.TX1.type = 'paper'; }],
  ['disabled type', r => { r.settings.rules.plastic.enabled = false; }],
  ['missing bin', r => { delete r.bins['BIN-01']; }],
  ['missing session', r => { delete r.bins['BIN-01'].activeSession; }],
  ['expired session', r => { r.bins['BIN-01'].activeSession.expiresAt = now - 1; }],
  ['wrong student', r => { r.events.TX1.studentCode = 'S2'; }],
  ['wrong session uid', r => { r.bins['BIN-01'].activeSession.uid = 'other'; }],
  ['locked user', r => { r.users.u1.status = 'locked'; }],
  ['disabled device', r => { r.devices.device.enabled = false; }],
  ['wrong device bin', r => { r.devices.device.binId = 'BIN-02'; }],
  ['missing device uid', r => { delete r.events.TX1.deviceUid; }],
  ['cooldown', r => { r.students.S1.lastTs = now - 2000; }],
  ['out of order', r => { r.students.S1.lastTs = now + 1; }],
  ['stale timestamp', r => { r.events.TX1.ts = now - 61000; }],
  ['future timestamp', r => { r.events.TX1.ts = now + 16000; }],
  ['drop predates session', r => { r.bins['BIN-01'].activeSession.startedAt = now + 1; }],
  ['spoofed simulation', r => { r.events.TX1.source = 'sim'; r.events.TX1.createdBy = 'u1'; }],
  ['unsafe type', r => { r.events.TX1.type = '__proto__'; }]
]) test(`rejects ${name} without changing points`, () => {
  const root = fixture(); mutate(root); scoreEvent(root, 'TX1', now);
  assert.equal(root.events.TX1.status, 'rejected');
  assert.equal(root.classes['10A1'].points, undefined);
  assert.equal(root.transactions, undefined);
});
test('only admin simulation can omit session', () => {
  const root = fixture({ source: 'sim', createdBy: 'admin', studentCode: 'S1', type: 'metal' });
  delete root.bins['BIN-01'].activeSession;
  scoreEvent(root, 'TX1', now);
  assert.equal(root.students.S1.points, 3);
});
test('different event IDs still obey cooldown', () => {
  const root = fixture();
  root.events.TX2 = { ...root.events.TX1, txId: 'TX2' };
  scoreEvent(root, 'TX1', now); scoreEvent(root, 'TX2', now);
  assert.equal(root.events.TX2.status, 'rejected');
  assert.equal(root.students.S1.points, 2);
});
test('week changes at Monday midnight in Vietnam, including year boundary', () => {
  assert.equal(weekKey(Date.parse('2026-10-25T16:59:59Z')), '2026-W43');
  assert.equal(weekKey(Date.parse('2026-10-25T17:00:00Z')), '2026-W44');
  assert.equal(weekKey(Date.parse('2027-01-01T00:00:00Z')), '2026-W53');
});
