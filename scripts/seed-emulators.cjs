'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { db, account } = require('./local-api.cjs');

async function seed() {
  if (await db('', 'GET', undefined, 'owner')) throw new Error('Database is not empty. Seed refused to protect existing local data.');
  const context = { window: {}, location: { hostname: '127.0.0.1', search: '' }, URLSearchParams };
  context.window.GS = {};
  context.GS = context.window.GS;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/config.js'), 'utf8'), context);
  const admin = await account('signUp', 'admin@greenschool.app', 'admin123');
  const student = await account('signUp', 'hs10a1@greenschool.app', '123456');
  const device = await account('signUp', 'bin01@devices.greenschool.app', 'device-demo-123');
  const now = Date.now();
  const root = {
    settings: context.GS.DEFAULTS,
    meta: { hasAdmin: true, seeded: true },
    admins: { [admin.localId]: true },
    devices: { [device.localId]: { binId: 'BIN-01', enabled: true } },
    users: {
      [admin.localId]: { uid: admin.localId, username: 'admin', fullName: 'Quản trị local', role: 'admin', status: 'active', createdAt: now },
      [student.localId]: { uid: student.localId, username: 'hs10a1', fullName: 'Nguyễn Minh An', className: '10A1', classId: '10A1', studentCode: '10A1-DEMO', role: 'student', status: 'active', createdAt: now }
    },
    usernames: {
      admin: { uid: admin.localId, email: admin.email },
      hs10a1: { uid: student.localId, email: student.email, studentCode: '10A1-DEMO' }
    },
    classes: {
      '10A1': { id: '10A1', name: '10A1', grade: 10, points: 0, count: 0 },
      '10A2': { id: '10A2', name: '10A2', grade: 10, points: 0, count: 0 }
    },
    students: {
      '10A1-DEMO': { code: '10A1-DEMO', fullName: 'Nguyễn Minh An', className: '10A1', classId: '10A1', uid: student.localId, username: 'hs10a1', points: 0, count: 0 },
      '10A2-TEST': { code: '10A2-TEST', fullName: 'Trần Bảo Bình', className: '10A2', classId: '10A2' }
    },
    bins: { 'BIN-01': { id: 'BIN-01', name: 'Thùng thử USB', location: 'Máy tính local', count: 0 } }
  };
  await db('', 'PUT', root, 'owner');
  console.log('Seeded demo-green-school locally. admin/admin123; hs10a1/123456.');
  return { admin, student, device };
}
if (require.main === module) seed().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { seed };
