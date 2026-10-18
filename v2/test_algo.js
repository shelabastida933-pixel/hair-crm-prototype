/* v2 算法验证（Node 直接跑，不依赖浏览器） */
const fs = require('fs');
const path = require('path');

// 把两个 js 拼起来在沙箱里执行
const code = fs.readFileSync(path.join(__dirname, 'js/db.js'), 'utf8')
            + '\n' + fs.readFileSync(path.join(__dirname, 'js/booking.js'), 'utf8')
            + '\nexports.__api = { genSlots, staffOnDuty, staffBusy, slotCapacity, canBookRange, dayAvailability, eligibleStaffFor, toMin, toHHMM, dateKey, SLOT_MIN };';

const Module = { exports: {} };
new Function('exports', 'module', code)(Module.exports, Module);
const A = Module.exports.__api;

const results = [];
const chk = (n, c, d) => { results.push({ n, pass: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  | ' + d : ''}`); };

/* ---------- 造数据 ---------- */
const shop = {
  id: 'shop1', name: '示范店', bedCount: 3,
  businessHours: { open: '09:00', close: '18:00' },
  allowCustomerPickStaff: false, slotMinutes: 30,
};
const staff = [
  { id: 's1', name: '小王', status: 'active', skills: ['白发转黑', '头皮护理'] },
  { id: 's2', name: '小李', status: 'active', skills: ['白发转黑'] },
  { id: 's3', name: '小张', status: 'active', skills: ['头皮护理', '头部SPA'] },
];
const schedules = [
  { id: 'u1', staffId: 's1', weekdays: [0,1,2,3,4,5,6], segments: [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '18:00' }] },
  { id: 'u2', staffId: 's2', weekdays: [0,1,2,3,4,5,6], segments: [{ start: '10:00', end: '18:00' }] },
  { id: 'u3', staffId: 's3', weekdays: [0,1,2,3,4,5,6], segments: [{ start: '09:00', end: '13:00' }] },
];
const services = [
  { id: 'v1', name: '白发转黑 · 单次护理', durationMin: 90, skill: '白发转黑' },
  { id: 'v2', name: '头皮护理', durationMin: 60, skill: '头皮护理' },
  { id: 'v3', name: '头部SPA', durationMin: 30, skill: '头部SPA' },
];
// 用固定日期：2026-10-20（周二）
const dateTs = new Date('2026-10-20T10:00:00').getTime();

let bookings = [
  // 李姐 15:00 约小王 90 分钟（锁 15:00/15:30/16:00）
  { id: 'b1', shopId: 'shop1', staffId: 's1', startTime: '15:00', durationMin: 90, dateKey: '2026-10-20', status: 'confirmed' },
  // 王姐 14:00 约小李 60 分钟
  { id: 'b2', shopId: 'shop1', staffId: 's2', startTime: '14:00', durationMin: 60, dateKey: '2026-10-20', status: 'confirmed' },
];

const base = { shop, staff, schedules, bookings, services };
const slotOf = (time) => A.genSlots(shop, dateTs).find(s => s.time === time);

console.log('=== 基础数据 ===');
console.log('床位:', shop.bedCount, '| 员工:', staff.map(s => s.name).join('/'));
console.log('预约:', bookings.map(b => `${b.staffId}@${b.startTime}+${b.durationMin}`).join(', '));
console.log();

/* 1. 槽位数量 */
const slots = A.genSlots(shop, dateTs);
chk('09:00-18:00 生成18个30分钟槽位', slots.length === 18, `${slots.length}`);

/* 2. 09:00 做白发转黑：小王在岗(会)、小李10点才来(不算)、小张不会 → 1人
      床位3 → capacity=min(1,3)=1 */
const s0900 = A.slotCapacity({ ...base, service: services[0], slot: slotOf('09:00') });
chk('09:00 白发转黑 → 在岗1人(仅小王)→容量1',
  s0900.onDuty === 1 && s0900.capacity === 1, `在岗${s0900.onDuty} 容量${s0900.capacity}`);

/* 3. ★ 技能过滤：10:00 做「头部SPA」→ 只有小张会 → 容量1（不是3） */
const spa10 = A.slotCapacity({ ...base, service: services[2], slot: slotOf('10:00') });
chk('★ 技能过滤：10:00 SPA→容量1（只有小张会，不是3）',
  spa10.onDuty === 1 && spa10.capacity === 1, `在岗${spa10.onDuty} 容量${spa10.capacity}`);

/* 4. 10:00 做白头转黑 → 小王+小李 = 2 → 容量2 */
const hb10 = A.slotCapacity({ ...base, service: services[0], slot: slotOf('10:00') });
chk('10:00 白发转黑→容量2（小王+小李，不含小张）',
  hb10.onDuty === 2 && hb10.capacity === 2, `在岗${hb10.onDuty} 容量${hb10.capacity}`);

/* 5. 13:00 → 小张在岗(到13:00边界不算)、小王午休、小李在岗 → 白头转黑容量1 */
const hb13 = A.slotCapacity({ ...base, service: services[0], slot: slotOf('13:00') });
chk('13:00 白发转黑→容量1（只有小李）', hb13.onDuty === 1, `在岗${hb13.onDuty}: ${hb13.availableStaff.map(s=>s.name)}`);

/* 6. 15:00 白头转黑 → 小王在岗但被占、小李在岗空闲 → 在岗2 已约1 剩1 */
const hb15 = A.slotCapacity({ ...base, service: services[0], slot: slotOf('15:00') });
chk('15:00 白发转黑→在岗2 已约1 剩1',
  hb15.onDuty === 2 && hb15.booked === 1 && hb15.remaining === 1,
  `在岗${hb15.onDuty} 已约${hb15.booked} 剩${hb15.remaining}`);

/* 7. 跨格锁位：15:00 约 90 分钟 → 15:00/15:30/16:00 三格 */
const r15 = A.canBookRange({ ...base, service: services[0], startSlot: '15:00', dateTs });
chk('15:00 约90分钟锁3格', r15.slots.join(',') === '15:00,15:30,16:00', r15.slots.join(','));
chk('15:00 约90分钟可约（小李空闲）', r15.ok === true, r15.reason);

/* 8. 指定小王 15:00 → 他已被占 → 拒绝 */
const rWang = A.canBookRange({ ...base, service: services[0], startSlot: '15:00', dateTs, staffId: 's1' });
chk('15:00 指定小王→拒绝（已被占）', rWang.ok === false && rWang.reason.includes('技师'),
  `${rWang.reason}`);

/* 9. 指定小李 15:00 → 通过 */
const rLi = A.canBookRange({ ...base, service: services[0], startSlot: '15:00', dateTs, staffId: 's2' });
chk('15:00 指定小李→通过', rLi.ok === true, rLi.reason || 'ok');

/* 10. 17:30 约90分钟 → 超出营业时间 */
const rLate = A.canBookRange({ ...base, service: services[0], startSlot: '17:30', dateTs });
chk('17:30 约90分钟→拒绝(超出营业时间)', rLate.ok === false && rLate.reason === '超出营业时间', rLate.reason);

/* 11. 16:30 约90分钟 → 正好到18:00，应允许 */
const rEdge = A.canBookRange({ ...base, service: services[0], startSlot: '16:30', dateTs });
chk('16:30 约90分钟→允许(正好18:00)', rEdge.ok === true, rEdge.reason || 'ok');

/* 12. ★ 床位成为瓶颈：把床位改成1，10:00 做白头转黑（在岗2）→ 容量1 */
const shop1bed = { ...shop, bedCount: 1 };
const bed1 = A.slotCapacity({ ...base, shop: shop1bed, service: services[0], slot: slotOf('10:00') });
chk('★ 床位=1时 10:00 容量变1（床位成为瓶颈）',
  bed1.onDuty === 2 && bed1.capacity === 1, `在岗${bed1.onDuty} 床位${bed1.beds} 容量${bed1.capacity}`);

/* 13. 已约满的时段应无法再约：把 09:00 三人全约满 */
bookings = [
  ...bookings,
  { id: 'b3', shopId: 'shop1', staffId: 's1', startTime: '09:00', durationMin: 30, dateKey: '2026-10-20', status: 'confirmed' },
];
const b9 = A.slotCapacity({ ...base, bookings, service: services[0], slot: slotOf('09:00') });
chk('09:00 已约1且容量1→剩0',
  b9.booked === 1 && b9.remaining === 0, `已约${b9.booked} 剩${b9.remaining}`);

/* 14. 取消的预约不占位 */
const cancelBookings = bookings.map(b => b.id === 'b3' ? { ...b, status: 'cancelled' } : b);
const b9c = A.slotCapacity({ ...base, bookings: cancelBookings, service: services[0], slot: slotOf('09:00') });
chk('已取消的预约不占用容量', b9c.booked === 0 && b9c.remaining === 1,
  `已约${b9c.booked} 剩${b9c.remaining}`);

/* 15. 可约技师列表 */
const elig = A.eligibleStaffFor({ staff, schedules, bookings: base.bookings, service: services[0], slot: slotOf('15:00') });
chk('15:00 可选技师只有小李（小王被占）',
  elig.length === 1 && elig[0].name === '小李', elig.map(s => s.name).join(',') || '无');

console.log();
const pass = results.filter(r => r.pass).length;
console.log(`===== ${pass}/${results.length} 通过 =====`);
process.exit(pass === results.length ? 0 : 1);
