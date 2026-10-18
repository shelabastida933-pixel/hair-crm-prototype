/* ==========================================================================
   发丝管家 v2 · 预约算法
   
   核心规则（来自需求）：
   - 最小粒度 30 分钟
   - 可约 = min(在岗员工数, 床位数) - 已约数 > 0
   - ★ 在岗员工必须「会做这个项目」（技能过滤）
   - 指定员工受店铺开关控制，默认关闭
   - 服务时长决定锁几个格子
   - 全程必须落在营业时间内
   ========================================================================== */

const SLOT_MIN = 30;

/** 生成某天营业时间内的所有槽位 */
function genSlots(shop, dateTs) {
  const open = toMin(shop.businessHours.open);
  const close = toMin(shop.businessHours.close);
  const out = [];
  for (let t = open; t + SLOT_MIN <= close; t += SLOT_MIN) {
    out.push({ key: dateKey(dateTs) + 'T' + toHHMM(t), time: toHHMM(t), min: t });
  }
  return out;
}

/** 某员工在某槽位是否在岗（依据 schedules + 服务技能） */
function staffOnDuty(staff, schedules, slot, service) {
  const t = slot.min;
  // 技能匹配
  if (service && service.skill) {
    if (!(staff.skills || []).includes(service.skill)) return false;
  }
  // 排班匹配
  const sch = schedules.filter(s => s.staffId === staff.id);
  if (!sch.length) return false;
  const wd = new Date(slot.key.slice(0, 10) + 'T00:00:00').getDay();
  return sch.some(s => {
    const days = s.weekdays || [];
    if (days.length && !days.includes(wd)) return false;
    return (s.segments || []).some(g => t >= toMin(g.start) && t + SLOT_MIN <= toMin(g.end));
  });
}

/** 某员工是否已被预约占用（考虑跨格） */
function staffBusy(staffId, bookings, slot) {
  const t = slot.min;
  const dk = slot.key.slice(0, 10);
  return bookings.some(b => {
    if (b.staffId !== staffId) return false;
    if (b.status === 'cancelled') return false;
    if (b.dateKey !== dk) return false;
    const bs = toMin(b.startTime);
    return t >= bs && t < bs + b.durationMin;
  });
}

/**
 * ★ 核心：算某槽位的容量
 * @param {Object} opt { shop, staff, schedules, bookings, services, service, slot }
 */
function slotCapacity(opt) {
  const { shop, staff, schedules, bookings, service, slot } = opt;

  // ① 会做这个项目 + 在岗的员工
  const available = staff.filter(s =>
    s.status === 'active' && staffOnDuty(s, schedules, slot, service)
  );

  // ② 容量 = min(可用员工数, 床位数)
  const onDuty = available.length;
  const beds = shop.bedCount || 1;
  const capacity = Math.min(onDuty, beds);

  // ③ 已约数（该槽位被占的人次）
  const dk = slot.key.slice(0, 10);
  const booked = bookings.filter(b => {
    if (b.status === 'cancelled') return false;
    if (b.dateKey !== dk) return false;
    const bs = toMin(b.startTime);
    return slot.min >= bs && slot.min < bs + b.durationMin;
  }).length;

  return {
    slot, onDuty, beds, capacity, booked,
    remaining: Math.max(0, capacity - booked),
    availableStaff: available,
  };
}

/**
 * 检查能否预约一个「连续 N 格」的服务
 * @returns { ok, reason, slots, each }
 */
function canBookRange(opt) {
  const { shop, staff, schedules, bookings, service, startSlot, dateTs, staffId } = opt;
  const need = Math.ceil(service.durationMin / SLOT_MIN);
  const all = genSlots(shop, dateTs);
  const idx = all.findIndex(s => s.time === startSlot);
  if (idx < 0) return { ok: false, reason: '不在营业时段', slots: [], each: [] };
  if (idx + need > all.length) {
    return { ok: false, reason: '超出营业时间', slots: [], each: [] };
  }
  const slots = all.slice(idx, idx + need);

  const each = slots.map(slot => {
    const cap = slotCapacity({ shop, staff, schedules, bookings, service, slot });
    let staffOk = true;
    if (staffId) {
      const st = staff.find(x => x.id === staffId);
      staffOk = !!st && staffOnDuty(st, schedules, slot, service) && !staffBusy(staffId, bookings, slot);
    }
    return { ...cap, staffOk };
  });

  // 每个格子都要：有余量 && （若指定员工）员工可用
  const bad = each.find(e => e.remaining <= 0 || (staffId && !e.staffOk));
  if (bad) {
    return {
      ok: false,
      reason: staffId && !bad.staffOk ? '该技师此时段不可用' : '该时段已约满',
      slots: slots.map(s => s.time),
      each,
    };
  }
  return { ok: true, reason: '', slots: slots.map(s => s.time), each };
}

/**
 * ★ 生成某天的可约表（客户看到的）
 */
function dayAvailability(opt) {
  const { shop, staff, schedules, bookings, services, service, dateTs, staffId } = opt;
  const slots = genSlots(shop, dateTs);
  return slots.map(slot => {
    const r = canBookRange({
      shop, staff, schedules, bookings, service,
      startSlot: slot.time, dateTs, staffId,
    });
    return {
      time: slot.time,
      ok: r.ok,
      reason: r.reason,
      remaining: r.each.length ? Math.min(...r.each.map(e => e.remaining)) : 0,
      capacity: r.each.length ? Math.min(...r.each.map(e => e.capacity)) : 0,
    };
  });
}

/** 某服务可选的技师（在岗 + 会做 + 该时段空闲） */
function eligibleStaffFor(opt) {
  const { staff, schedules, bookings, service, slot } = opt;
  return staff.filter(s =>
    s.status === 'active' &&
    staffOnDuty(s, schedules, slot, service) &&
    !staffBusy(s.id, bookings, slot)
  );
}
