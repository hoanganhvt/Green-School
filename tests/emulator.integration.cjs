'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { db, account } = require('../scripts/local-api.cjs');
const { seed } = require('../scripts/seed-emulators.cjs');

test('local Auth + RTDB Rules + Functions end-to-end', { timeout: 60000 }, async () => {
  assert.equal(process.env.GS_EMULATOR_TEST, '1', 'Run through npm.cmd run test:emulators in a fresh emulator process.');
  const { admin, student, device } = await seed();
  const sid = student.localId;
  const aid = admin.localId;
  await assert.rejects(db('events/ANONYMOUS', 'PUT', { txId: 'ANONYMOUS', binId: 'BIN-01', type: 'plastic', status: 'pending', source: 'esp32', ts: Date.now() }), /401|403/);
  await assert.rejects(db(`devices/${sid}`, 'PUT', { binId: 'BIN-01', enabled: true }, student.idToken), /401|403/);
  await assert.rejects(db('classes/10A1/points', 'PUT', 9999, student.idToken), /401|403/);
  await assert.rejects(db(`users/${sid}/role`, 'PUT', 'admin', student.idToken), /401|403/);
  await assert.rejects(db(`users/${sid}/studentCode`, 'PUT', '10A2-TEST', student.idToken), /401|403/);
  await assert.rejects(db(`admins/${sid}`, 'PUT', true, student.idToken), /401|403/);
  await assert.rejects(db('transactions/FAKE', 'PUT', { points: 9999 }, student.idToken), /401|403/);
  const user2 = await account('signUp', 'newstudent@greenschool.app', '123456');
  // Same multi-path registration used by the UI.
  await db('', 'PATCH', {
    [`users/${user2.localId}`]: { uid: user2.localId, username: 'newstudent', fullName: 'Trần Bảo Bình', className: '10A2', classId: '10A2', studentCode: '10A2-TEST', role: 'student', status: 'active' },
    'usernames/newstudent': { uid: user2.localId, email: user2.email, studentCode: '10A2-TEST' },
    'students/10A2-TEST/uid': user2.localId,
    'students/10A2-TEST/username': 'newstudent',
    'students/10A2-TEST/registeredAt': Date.now()
  }, user2.idToken);
  const now = Date.now();
  const session = { uid: sid, studentCode: '10A1-DEMO', username: 'hs10a1', fullName: 'Nguyễn Minh An', classId: '10A1', className: '10A1', startedAt: now - 1000, expiresAt: now + 180000 };
  await db('bins/BIN-01/activeSession', 'PUT', session, student.idToken);
  await assert.rejects(db('bins/BIN-01/activeSession', 'DELETE', undefined, user2.idToken), /401|403/);
  await assert.rejects(db('bins/BIN-01/activeSession', 'PUT', { ...session, uid: user2.localId, studentCode: '10A2-TEST', classId: '10A2', username: 'newstudent' }, user2.idToken), /401|403/);
  async function send(id, overrides = {}, token = device.idToken) {
    await db(`events/${id}`, 'PUT', { txId: id, binId: 'BIN-01', type: 'plastic', status: 'pending', source: 'esp32', deviceUid: device.localId, ts: { '.sv': 'timestamp' }, ...overrides }, token);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const event = await db(`events/${id}`, 'GET', undefined, admin.idToken);
      if (event.status !== 'pending') return event;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Function did not process ${id}`);
  }
  assert.equal((await send('INTEGRATION-OK')).status, 'processed');
  assert.equal((await db('classes/10A1')).points, 2);
  await assert.rejects(db('events/INTEGRATION-OK', 'PUT', { status: 'pending' }), /401|403/);
  assert.equal((await send('INTEGRATION-FAST')).status, 'rejected');
  assert.equal((await send('INTEGRATION-PAPER', { type: 'paper' })).status, 'rejected');
  await assert.rejects(send('INTEGRATION-SPOOF', { source: 'sim', createdBy: aid, studentCode: '10A2-TEST' }, student.idToken), /401|403/);
  // Rejected events do not increase aggregates; processing needs no browser at all.
  assert.equal((await db('classes/10A1')).points, 2);
  assert.equal((await db('classes/10A2')).points, 0);
  await db('bins/BIN-01/activeSession', 'DELETE', undefined, student.idToken);
  assert.equal((await send('INTEGRATION-NO-SESSION')).status, 'rejected');
  const sim = await send('INTEGRATION-ADMIN', { source: 'sim', createdBy: aid, studentCode: '10A2-TEST', type: 'metal' }, admin.idToken);
  assert.equal(sim.status, 'processed');
  assert.equal((await db('classes/10A2')).points, 3);
});
