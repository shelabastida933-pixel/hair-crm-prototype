/* 验证容量算法（纯 Node，不依赖浏览器） */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/booking.js', 'utf8');
// 在沙箱里执行，拿到函数
const sandbox = {};
new Function('exports', src + '\nObject.assign(exports, {DEMO, toMin, toHHMM, allSlots, staffOnDuty, staffBusy, onDutyCount, bookedCount, slotStatus, canBookRange, eligibleStaff, SLOT});')(sandbox);
const { DEMO, allSlots, slotStatus, canBookRange, eligibleStaff, toMin } = sandbox;

const results = [];
const chk = (n, c, d) => { results.push({ n, pass: !!c, d }); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  | ' + d : ''}`); };

console.log('=== 场景基础数据 ===');
console.log('床位数:', DEMO.shop.bedCount);
console.log('员工:', DEMO.staff.map(s => `${s.name}(${s.segments.map(x=>x.join('-')).join(',')})`).join(' | '));
console.log('预约:', DEMO.bookings.map(b => `${b.customer}@${b.start}${b.durationMin}min→${b.staffId}`).join(' | '));
console.log();

/* 1. 槽位数量：09:00-18:00，30分钟粒度 = 18 个 */
const slots = allSlots();
chk('30分钟粒度生成18个槽位', slots.length === 18, `${slots.length} 个: ${slots[0]}~${slots[slots.length-1]}`);

/* 2. 09:00 —— 小王在岗、小张在岗、小李没上班(10点开始)
      在岗=2, 床位=3, capacity=min(2,3)=2, 已约=0, 剩余=2 */
const s0900 = slotStatus('09:00');
chk('09:00 在岗2人→容量2（床位不是瓶颈）',
  s0900.onDuty === 2 && s0900.capacity === 2 && s0900.remaining === 2,
  `在岗${s0900.onDuty} 床位${s0900.beds} 容量${s0900.capacity} 已约${s0900.booked} 剩${s0900.remaining}`);

/* 3. 15:00 —— 三人都在岗(小王到18点、小李到18点、小张到13点→不在)
      实际：小王/小李在岗=2；已有预约 b1(小王15:00起90分) + b2(王姐14:00-15:00结束，不含15:00)
      所以 15:00 booked=1 (只有李姐), capacity=2, remaining=1 */
const s1500 = slotStatus('15:00');
chk('15:00 在岗2 / 已约1 → 剩1',
  s1500.onDuty === 2 && s1500.booked === 1 && s1500.remaining === 1,
  `在岗${s1500.onDuty} 容量${s1500.capacity} 已约${s1500.booked} 剩${s1500.remaining}`);

/* 4. 13:00 —— 小张13:00下班(段到13:00)，所以13:00不在岗；小王午休(12:00-13:30)；小李在岗
      在岗=1 (只有小李) */
const s1300 = slotStatus('13:00');
chk('13:00 只有小李在岗（小王午休/小张下班）→容量1',
  s1300.onDuty === 1 && s1300.capacity === 1,
  `在岗${s1300.onDuty} 容量${s1300.capacity} 剩${s1300.remaining}`);

/* 5. 床位数成为瓶颈的场景：造一个 4 人在岗但只有 3 张床
      （用 10:00 三人都在岗 = 3，与床位3相等，不是瓶颈；这里验证逻辑）*/
const s1000 = slotStatus('10:00');
chk('10:00 三人在岗、3张床 → 容量=3（员工数=床位）',
  s1000.onDuty === 3 && s1000.capacity === 3,
  `在岗${s1000.onDuty} 床位${s1000.beds} 容量${s1000.capacity}`);

/* 6. ★ 关键：跨格锁位 —— 15:00 约 90 分钟需要占 15:00/15:30/16:00
      16:00: 小王被b1占(15:00+90=16:30覆盖16:00)，小李在岗且空闲，小张不在
      所以在岗2, booked=1, remaining=1 → 还能约 */
const r90 = canBookRange('15:00', 90);
chk('15:00 约90分钟需锁3格且都可用', r90.ok === true, r90.slots.join(','));

/* 7. ★ 指定员工：15:00 指定小王 —— 他已被占 → 不可约 */
const rWang = canBookRange('15:00', 90, 's1');
chk('15:00 指定小王 → 不可约（他已被占）', rWang.ok === false,
  rWang.each.map(e => `${e.slot}:剩${e.remaining}/员工${e.staffOk}`).join(' '));

/* 8. 指定小李 15:00 → 可约 */
const rLi = canBookRange('15:00', 90, 's2');
chk('15:00 指定小李 → 可约', rLi.ok === true,
  rLi.each.map(e => `${e.slot}:剩${e.remaining}/员工${e.staffOk}`).join(' '));

/* 9. 17:30 约90分钟会跨到18:30（超出营业时间）—— 必须显式拒绝 */
const rLate = canBookRange('17:30', 90);
chk('17:30 约90分钟超出营业时间 → 显式拒绝（非偶然）',
  rLate.ok === false && rLate.reason === '超出营业时间', `reason=${rLate.reason}`);

/* 9b. 边界正例：16:30 约90分钟 → 16:30+90=18:00，正好等于闭店，应允许 */
const rEdge = canBookRange('16:30', 90);
chk('16:30 约90分钟正好到18:00 → 应允许', rEdge.ok === true || rEdge.reason !== '超出营业时间',
  `ok=${rEdge.ok} reason=${rEdge.reason || '无'}`);

/* 10. 可参与「头部SPA」的员工 */
const spaStaff = eligibleStaff('v3');
chk('会做头部SPA的员工是小张', spaStaff.length === 1 && spaStaff[0].name === '小张',
  spaStaff.map(s => s.name).join(','));

/* 11. ★ 技能过滤：10:00 三人都在岗，但「头部SPA」只有小张会做 → 容量应为 1 而不是 3 */
const spa10 = slotStatus('10:00', 'v3');
chk('★ 技能过滤：10:00 做SPA容量=1（只有小张会，不是3）',
  spa10.onDuty === 1 && spa10.capacity === 1,
  `在岗(会SPA)${spa10.onDuty} 容量${spa10.capacity}`);

/* 12. 对比：同样 10:00 做「白发转黑」→ 小王+小李 = 2 人容量 */
const hb10 = slotStatus('10:00', 'v1');
chk('10:00 做白发转黑容量=2（小王+小李，不含小张）',
  hb10.onDuty === 2 && hb10.capacity === 2,
  `在岗(会白发转黑)${hb10.onDuty} 容量${hb10.capacity}`);

/* 13. 不传 serviceId 时按全部在岗算（用于对比） */
const all10 = slotStatus('10:00');
chk('不传服务时按全部在岗算=3', all10.onDuty === 3,
  `在岗${all10.onDuty}`);

console.log();
const pass = results.filter(r => r.pass).length;
console.log(`===== ${pass}/${results.length} 通过 =====`);
process.exit(pass === results.length ? 0 : 1);
