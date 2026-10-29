'use strict';

// Same ISO week convention as the browser, with a fixed Vietnam timezone (UTC+7).
function weekKey(ts) {
  const d = new Date(ts + 7 * 3600000);
  const day = (d.getUTCDay() + 6) % 7;
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const year = thu.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

const safeKey = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128
  && !/[.#$\[\]/]/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);

// The laptop backend uses a root transaction for deduplication and atomic cooldown checks.
// shortcut: whole-school transaction, partition by season/bin when contention grows.
function scoreEvent(root, id, now) {
  if (!root || !safeKey(id)) return;
  const ev = root.events?.[id];
  if (!ev || ev.status !== 'pending') return;
  const fail = (reason) => {
    Object.assign(ev, { status: 'rejected', reason, processedAt: now });
    return root;
  };
  if (root.transactions?.[id]) return fail('Mã giao dịch đã được tính trước đó');
  if (!safeKey(ev.binId) || !root.bins?.[ev.binId]) return fail('Thùng rác không tồn tại');
  if (!safeKey(ev.type)) return fail('Loại rác không hợp lệ');
  const rule = root.settings?.rules?.[ev.type];
  if (!rule || rule.enabled === false || !Number.isFinite(Number(rule.points))) return fail('Loại rác chưa có hoặc đang tạm dừng tính điểm');
  const bin = root.bins[ev.binId];
  const session = bin.activeSession;
  // Only authenticated admins may bypass sessions for their test events.
  const simulation = ev.source === 'sim' && safeKey(ev.createdBy) && root.admins?.[ev.createdBy] === true
    && root.users?.[ev.createdBy]?.status === 'active';
  if (ev.source === 'sim' && !simulation) return fail('Chỉ quản trị viên được gửi lượt thử');
  // Bin IDs identify the sender; they do not authenticate physical hardware.
  if (!simulation && ev.source !== 'esp32') {
    return fail('Nguồn sự kiện không hợp lệ');
  }
  const ts = Number(ev.ts);
  if (!Number.isFinite(ts) || ts > now + 15000 || ts < now - 60000) return fail('Thời gian sự kiện không hợp lệ hoặc quá cũ');
  const code = simulation && ev.studentCode ? ev.studentCode : session?.studentCode;
  if (!safeKey(code)) return fail('Không có học sinh đang dùng thùng');
  if (!simulation && (!session || !Number.isFinite(session.startedAt) || !Number.isFinite(session.expiresAt)
    || session.startedAt > ts || session.expiresAt < ts || session.expiresAt < now
    || (ev.studentCode && ev.studentCode !== code) || (ev.username && ev.username !== session.username))) {
    return fail('Phiên không khớp hoặc đã hết hạn, hãy quét lại QR');
  }
  const student = root.students?.[code];
  const user = student?.uid && root.users?.[student.uid];
  if (!student || !safeKey(student.classId) || !root.classes?.[student.classId]
    || !user || user.status !== 'active' || user.studentCode !== code
    || (!simulation && session.uid !== student.uid)) return fail('Tài khoản học sinh không hợp lệ hoặc bị khoá');
  const cooldown = Math.max(0, Number(root.settings?.cooldownSeconds) || 0) * 1000;
  if (student.lastTs && ts - student.lastTs < cooldown) return fail('Bỏ rác quá nhanh hoặc sự kiện sai thứ tự');
  const tx = {
    id, type: ev.type, typeLabel: rule.label || ev.type, points: Number(rule.points), countable: true,
    binId: ev.binId, classId: student.classId, className: student.className,
    studentCode: code, fullName: student.fullName, username: student.username || null,
    ts, weekKey: weekKey(ts), source: ev.source || 'esp32'
  };
  root.weekly ||= {};
  root.weekly[tx.weekKey] ||= {};
  root.weekly[tx.weekKey][student.classId] ||= {};
  for (const target of [student, root.classes[student.classId], root.weekly[tx.weekKey][student.classId]]) {
    target.points = (Number(target.points) || 0) + tx.points;
    target.count = (Number(target.count) || 0) + 1;
    target.byType ||= {};
    target.byType[ev.type] = (Number(target.byType[ev.type]) || 0) + 1;
  }
  student.lastTs = ts;
  bin.count = (Number(bin.count) || 0) + 1;
  bin.lastEventAt = now;
  if (session?.studentCode === code) session.expiresAt = now + Math.max(1, Number(root.settings?.sessionMinutes) || 3) * 60000;
  root.transactions ||= {};
  root.transactions[id] = tx;
  Object.assign(ev, { status: 'processed', studentCode: code, classId: student.classId, points: tx.points, processedAt: now });
  return root;
}

module.exports = { scoreEvent, weekKey };
