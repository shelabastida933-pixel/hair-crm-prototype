/* ==========================================================================
   发丝管家 SaaS · 预约演示原型
   核心目的：把「容量算法」真的跑起来，让人点着看
   
   规则：
   - 时段粒度 30 分钟
   - 可约 = min(在岗员工数, 床位数) - 已约数 > 0
   - 指定员工：受店铺开关控制，默认关闭
   - 服务时长决定锁几个格子
   ========================================================================== */

const DEMO = {
  shop: {
    name: '张姐养发馆（示范店）',
    bedCount: 3,
    allowCustomerPickStaff: false,   // ★ 默认关闭
    businessHours: { open: '09:00', close: '18:00' },
  },

  // 员工与工作时间
  staff: [
    { id: 's1', name: '小王', skills: ['白发转黑', '头皮护理'], segments: [['09:00', '12:00'], ['13:30', '18:00']] },
    { id: 's2', name: '小李', skills: ['白发转黑'], segments: [['10:00', '18:00']] },
    { id: 's3', name: '小张', skills: ['头皮护理', '头部SPA'], segments: [['09:00', '13:00']] },
  ],

  services: [
    { id: 'v1', name: '白发转黑 · 单次护理', durationMin: 90 },
    { id: 'v2', name: '头皮护理', durationMin: 60 },
    { id: 'v3', name: '头部SPA', durationMin: 30 },
  ],

  // 预约（已存在的）
  bookings: [
    // 15:00 小王已被约（90分钟 → 占 15:00/15:30/16:00）
    { id: 'b1', staffId: 's1', serviceId: 'v1', start: '15:00', durationMin: 90, customer: '李姐' },
    { id: 'b2', staffId: 's2', serviceId: 'v2', start: '14:00', durationMin: 60, customer: '王姐' },
  ],
};

/* ---------- 工具 ---------- */
function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
const SLOT = 30;   // ★ 最小粒度

/** 生成营业时间内的所有 30 分钟槽位 */
function allSlots() {
  const s = toMin(DEMO.shop.businessHours.open);
  const e = toMin(DEMO.shop.businessHours.close);
  const out = [];
  for (let t = s; t + SLOT <= e; t += SLOT) out.push(toHHMM(t));
  return out;
}

/** 某员工在某槽位是否在岗 */
function staffOnDuty(staff, slot) {
  const t = toMin(slot);
  return staff.segments.some(([a, b]) => t >= toMin(a) && t + SLOT <= toMin(b));
}

/** 某员工在某槽位是否已被占用（考虑跨格） */
function staffBusy(staffId, slot) {
  const t = toMin(slot);
  return DEMO.bookings.some(b => {
    if (b.staffId !== staffId) return false;
    const bs = toMin(b.start);
    return t >= bs && t < bs + b.durationMin;
  });
}

/** 某槽位的在岗员工数（可按服务技能过滤） */
function onDutyCount(slot, serviceId) {
  let pool = DEMO.staff.filter(s => staffOnDuty(s, slot));
  if (serviceId) {
    // ★ 只统计「会做这个项目」的员工 —— 否则客户会约到不会做的技师
    const svc = DEMO.services.find(s => s.id === serviceId);
    if (svc) {
      const key = svc.name.split(' · ')[0];
      pool = pool.filter(s => s.skills.includes(key));
    }
  }
  return pool.length;
}

/** 某槽位已被占用数（按床位/人次算，一个预约占 1 个位） */
function bookedCount(slot) {
  const t = toMin(slot);
  return DEMO.bookings.filter(b => {
    const bs = toMin(b.start);
    return t >= bs && t < bs + b.durationMin;
  }).length;
}

/**
 * ★ 核心：算某槽位的可约情况
 * capacity = min(在岗员工数, 床位数)
 * remaining = capacity - 已约数
 * @param serviceId 传入时只统计「会做这个项目」的员工
 */
function slotStatus(slot, serviceId) {
  const onDuty = onDutyCount(slot, serviceId);
  const beds = DEMO.shop.bedCount;
  const capacity = Math.min(onDuty, beds);
  const booked = bookedCount(slot);
  return {
    slot, onDuty, beds, capacity, booked,
    remaining: Math.max(0, capacity - booked),
  };
}

/** 某服务在某个起始时间能否约（需连续 N 格都有余量） */
function canBookRange(startSlot, durationMin, staffId, serviceId) {
  const need = Math.ceil(durationMin / SLOT);
  const slots = [];
  let t = toMin(startSlot);
  for (let i = 0; i < need; i++) slots.push(toHHMM(t + i * SLOT));

  /* ⭐ 显式校验：整个服务必须落在营业时间内。
     否则 17:30 约 90 分钟会因为"18:00 没槽位"而偶然被拒，
     换个场景（如营业到 20:00、服务 150 分钟）就会放行越界。 */
  const closeMin = toMin(DEMO.shop.businessHours.close);
  const openMin = toMin(DEMO.shop.businessHours.open);
  if (t < openMin || t + durationMin > closeMin) {
    return { ok: false, slots, each: [], reason: '超出营业时间' };
  }

  // 每个格子都要有余量
  const each = slots.map(s => {
    const st = slotStatus(s, serviceId);
    if (staffId) {
      const staff = DEMO.staff.find(x => x.id === staffId);
      const ok = staff && staffOnDuty(staff, s) && !staffBusy(staffId, s);
      return { ...st, staffOk: !!ok };
    }
    return st;
  });

  const ok = each.every(e => e.remaining > 0 && (staffId ? e.staffOk : true));
  return { ok, slots, each, reason: ok ? '' : '时段不可约' };
}

/** 可参与某服务的员工（在岗 + 会做） */
function eligibleStaff(serviceId) {
  const svc = DEMO.services.find(s => s.id === serviceId);
  return DEMO.staff.filter(s => s.skills.includes(svc.name.split(' · ')[0]));
}
