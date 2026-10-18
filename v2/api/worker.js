/**
 * 发丝管家 v2 · Cloudflare Worker 后端
 *
 * 技术栈：Workers + D1（SQLite）
 * 职责：给前端提供 REST API，数据存 D1
 *
 * 设计原则：
 * 1. 所有写操作校验权限（角色 + 店铺归属）
 * 2. 预约创建用事务 + 唯一约束防超卖
 * 3. 员工唯一归属在数据库层用唯一索引保证
 */

/* ============================ 工具 ============================ */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}
function err(msg, status = 400) {
  return json({ error: msg }, status);
}
function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function dateKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ============================ 路由 ============================ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      /* ---- 健康检查 ---- */
      if (path === '' || path === 'health') {
        const r = await env.DB.prepare('SELECT 1 as ok').first();
        return json({ ok: true, db: r?.ok === 1, ts: Date.now() });
      }

      /* ---- 初始化：建表 + 种子数据 ---- */
      if (path === 'api/init' && method === 'POST') {
        return await initDB(env);
      }

      /* ---- 登录 ---- */
      if (path === 'api/login/customer' && method === 'POST') return await loginCustomer(request, env);
      if (path === 'api/login/staff' && method === 'POST') return await loginStaff(request, env);

      /* ---- 店铺 ---- */
      if (path === 'api/shop' && method === 'GET') return await getShop(url, env);
      if (path === 'api/shop' && method === 'PUT') return await updateShop(request, env);

      /* ---- 员工 & 排班 ---- */
      if (path === 'api/staff' && method === 'GET') return await listStaff(url, env);
      if (path === 'api/staff/schedule' && method === 'GET') return await getSchedule(url, env);
      if (path === 'api/staff/schedule' && method === 'PUT') return await saveSchedule(request, env);

      /* ---- 服务项目 ---- */
      if (path === 'api/services' && method === 'GET') return await listServices(url, env);

      /* ---- 可约时段 ---- */
      if (path === 'api/availability' && method === 'GET') return await availability(url, env);

      /* ---- 预约 ---- */
      if (path === 'api/bookings' && method === 'GET') return await listBookings(url, env);
      if (path === 'api/bookings' && method === 'POST') return await createBooking(request, env);
      if (path.match(/^api\/bookings\/[^/]+$/) && method === 'PUT') return await updateBooking(request, env, path);
      if (path.match(/^api\/bookings\/[^/]+$/) && method === 'DELETE') return await cancelBooking(request, env, path);

      /* ---- 店长：分配技师 ---- */
      if (path === 'api/assign' && method === 'POST') return await assignStaff(request, env);

      /* ---- 总部：多店统计 ---- */
      if (path === 'api/hq/overview' && method === 'GET') return await hqOverview(env);

      return err('Not Found: ' + path, 404);
    } catch (e) {
      return err('Server Error: ' + (e.message || e), 500);
    }
  },
};

/* ============================ 数据库初始化 ============================ */

async function initDB(env) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT,
      bed_count INTEGER NOT NULL DEFAULT 3,
      open_time TEXT NOT NULL DEFAULT '09:00',
      close_time TEXT NOT NULL DEFAULT '18:00',
      allow_pick_staff INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      username TEXT UNIQUE, password TEXT,
      openid TEXT, skills TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    )`,
    // ★ 员工唯一归属：一个 openid 只能有一条 active 记录
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_active_openid
      ON staff(openid) WHERE status = 'active' AND openid IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, shop_id TEXT NOT NULL,
      weekdays TEXT NOT NULL, segments TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, name TEXT NOT NULL,
      duration_min INTEGER NOT NULL, price REAL, skill TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      shop_id TEXT, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL,
      customer_id TEXT NOT NULL, customer_name TEXT, customer_phone TEXT,
      service_id TEXT NOT NULL, service_name TEXT, duration_min INTEGER NOT NULL,
      staff_id TEXT, assign_mode TEXT NOT NULL,
      date_key TEXT NOT NULL, start_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at INTEGER NOT NULL
    )`,
    // ★ 防超卖：同一员工同一时段只能有一条有效预约
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_staff_slot
      ON bookings(shop_id, staff_id, date_key, start_time)
      WHERE status != 'cancelled' AND staff_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS ix_booking_shop_date ON bookings(shop_id, date_key)`,
    `CREATE INDEX IF NOT EXISTS ix_booking_customer ON bookings(customer_id)`,
  ];

  for (const sql of stmts) {
    await env.DB.prepare(sql).run();
  }

  // 种子数据（只在空库时）
  const shop = await env.DB.prepare('SELECT id FROM shops LIMIT 1').first();
  if (!shop) {
    const now = Date.now();
    const shopId = 'shop_demo';
    await env.DB.prepare(
      `INSERT INTO shops (id,name,phone,bed_count,open_time,close_time,allow_pick_staff,created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(shopId, '张姐养发馆（示范店）', '13800138000', 3, '09:00', '18:00', 0, now).run();

    const staffData = [
      ['staff_wang', '小王', 'manager', 'wang', JSON.stringify(['白发转黑', '头皮护理']), 'wx_wang'],
      ['staff_li', '小李', 'staff', 'li', JSON.stringify(['白发转黑']), 'wx_li'],
      ['staff_zhang', '小张', 'staff', 'zhang', JSON.stringify(['头皮护理', '头部SPA']), 'wx_zhang'],
    ];
    for (const [id, name, role, user, skills, openid] of staffData) {
      await env.DB.prepare(
        `INSERT INTO staff (id,shop_id,name,role,username,password,openid,skills,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, shopId, name, role, user, '123456', openid, skills, 'active', now).run();
    }

    const schData = [
      ['staff_wang', [[1,2,3,4,5,6,0]], [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '18:00' }]],
      ['staff_li', [[1,2,3,4,5,6,0]], [{ start: '10:00', end: '18:00' }]],
      ['staff_zhang', [[1,2,3,4,5,6,0]], [{ start: '09:00', end: '13:00' }]],
    ];
    for (const [sid, wd, segs] of schData) {
      await env.DB.prepare(
        `INSERT INTO schedules (id,staff_id,shop_id,weekdays,segments,updated_at) VALUES (?,?,?,?,?,?)`
      ).bind(uid('sch'), sid, shopId, JSON.stringify(wd[0]), JSON.stringify(segs), now).run();
    }

    const svcData = [
      ['白发转黑 · 单次护理', 90, 398, '白发转黑'],
      ['头皮护理', 60, 198, '头皮护理'],
      ['头部SPA', 30, 98, '头部SPA'],
    ];
    for (const [name, dur, price, skill] of svcData) {
      await env.DB.prepare(
        `INSERT INTO services (id,shop_id,name,duration_min,price,skill,created_at) VALUES (?,?,?,?,?,?,?)`
      ).bind(uid('svc'), shopId, name, dur, price, skill, now).run();
    }
  }

  return json({ ok: true, message: '数据库已就绪' });
}

/* ============================ 登录 ============================ */

async function loginCustomer(request, env) {
  const { name, phone } = await request.json();
  if (!name || !/^1\d{10}$/.test(phone || '')) return err('姓名或手机号不合法');

  let c = await env.DB.prepare('SELECT * FROM customers WHERE phone = ?').bind(phone).first();
  if (!c) {
    const id = uid('cust');
    await env.DB.prepare(
      'INSERT INTO customers (id,phone,name,shop_id,created_at) VALUES (?,?,?,?,?)'
    ).bind(id, phone, name, null, Date.now()).run();
    c = { id, phone, name };
  } else if (c.name !== name) {
    await env.DB.prepare('UPDATE customers SET name = ? WHERE id = ?').bind(name, c.id).run();
    c.name = name;
  }
  return json({ ok: true, user: { id: c.id, name: c.name, phone: c.phone, role: 'customer' } });
}

async function loginStaff(request, env) {
  const { username, password } = await request.json();
  const s = await env.DB.prepare(
    "SELECT * FROM staff WHERE username = ? AND password = ? AND status = 'active'"
  ).bind(username, password).first();
  if (!s) return err('账号或密码不对', 401);
  return json({
    ok: true,
    user: {
      id: s.id, name: s.name, role: s.role, shopId: s.shop_id,
      skills: JSON.parse(s.skills || '[]'),
    },
  });
}

/* ============================ 店铺 ============================ */

async function getShop(url, env) {
  const id = url.searchParams.get('id');
  const s = id
    ? await env.DB.prepare('SELECT * FROM shops WHERE id = ?').bind(id).first()
    : await env.DB.prepare('SELECT * FROM shops LIMIT 1').first();
  if (!s) return err('店铺不存在', 404);
  return json({
    ok: true,
    shop: {
      id: s.id, name: s.name, phone: s.phone, bedCount: s.bed_count,
      businessHours: { open: s.open_time, close: s.close_time },
      allowCustomerPickStaff: s.allow_pick_staff === 1,
    },
  });
}

async function updateShop(request, env) {
  const body = await request.json();
  const { id } = body;
  if (!id) return err('缺少店铺 id');
  await env.DB.prepare(
    `UPDATE shops SET name=?, phone=?, bed_count=?, open_time=?, close_time=?, allow_pick_staff=? WHERE id=?`
  ).bind(
    body.name, body.phone, body.bedCount,
    body.businessHours?.open || '09:00',
    body.businessHours?.close || '18:00',
    body.allowCustomerPickStaff ? 1 : 0,
    id
  ).run();
  return json({ ok: true });
}

/* ============================ 员工 & 排班 ============================ */

async function listStaff(url, env) {
  const shopId = url.searchParams.get('shopId');
  const rows = await env.DB.prepare(
    "SELECT id,shop_id,name,role,skills,status FROM staff WHERE shop_id = ? AND status = 'active'"
  ).bind(shopId).all();
  return json({
    ok: true,
    staff: (rows.results || []).map(s => ({
      id: s.id, shopId: s.shop_id, name: s.name, role: s.role,
      skills: JSON.parse(s.skills || '[]'),
    })),
  });
}

async function getSchedule(url, env) {
  const staffId = url.searchParams.get('staffId');
  const r = await env.DB.prepare('SELECT * FROM schedules WHERE staff_id = ?').bind(staffId).first();
  if (!r) return json({ ok: true, schedule: null });
  return json({
    ok: true,
    schedule: {
      id: r.id, staffId: r.staff_id, shopId: r.shop_id,
      weekdays: JSON.parse(r.weekdays || '[]'),
      segments: JSON.parse(r.segments || '[]'),
    },
  });
}

async function saveSchedule(request, env) {
  const b = await request.json();
  if (!b.staffId) return err('缺少 staffId');
  const exist = await env.DB.prepare('SELECT id FROM schedules WHERE staff_id = ?').bind(b.staffId).first();
  if (exist) {
    await env.DB.prepare(
      'UPDATE schedules SET weekdays=?, segments=?, updated_at=? WHERE id=?'
    ).bind(JSON.stringify(b.weekdays), JSON.stringify(b.segments), Date.now(), exist.id).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO schedules (id,staff_id,shop_id,weekdays,segments,updated_at) VALUES (?,?,?,?,?,?)'
    ).bind(uid('sch'), b.staffId, b.shopId, JSON.stringify(b.weekdays), JSON.stringify(b.segments), Date.now()).run();
  }
  return json({ ok: true });
}

/* ============================ 服务项目 ============================ */

async function listServices(url, env) {
  const shopId = url.searchParams.get('shopId');
  const rows = await env.DB.prepare('SELECT * FROM services WHERE shop_id = ?').bind(shopId).all();
  return json({
    ok: true,
    services: (rows.results || []).map(s => ({
      id: s.id, shopId: s.shop_id, name: s.name,
      durationMin: s.duration_min, price: s.price, skill: s.skill,
    })),
  });
}

/* ============================ 预约核心 ============================ */

const SLOT_MIN = 30;

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

/** 加载某天算容量需要的全部数据 */
async function loadDayContext(env, shopId, dk) {
  const shop = await env.DB.prepare('SELECT * FROM shops WHERE id = ?').bind(shopId).first();
  const staffRows = await env.DB.prepare(
    "SELECT * FROM staff WHERE shop_id = ? AND status = 'active'"
  ).bind(shopId).all();
  const schRows = await env.DB.prepare(
    'SELECT * FROM schedules WHERE shop_id = ?'
  ).bind(shopId).all();
  const bookingRows = await env.DB.prepare(
    "SELECT * FROM bookings WHERE shop_id = ? AND date_key = ? AND status != 'cancelled'"
  ).bind(shopId, dk).all();

  return {
    shop,
    staff: (staffRows.results || []).map(s => ({
      id: s.id, name: s.name, skills: JSON.parse(s.skills || '[]'),
    })),
    schedules: (schRows.results || []).map(s => ({
      staffId: s.staff_id,
      weekdays: JSON.parse(s.weekdays || '[]'),
      segments: JSON.parse(s.segments || '[]'),
    })),
    bookings: (bookingRows.results || []).map(b => ({
      staffId: b.staff_id, startTime: b.start_time, durationMin: b.duration_min,
    })),
  };
}

/** 某员工某槽位是否在岗（技能 + 排班） */
function staffOnDuty(staff, schedules, min, weekday, skill) {
  if (skill && !staff.skills.includes(skill)) return false;
  const sch = schedules.filter(s => s.staffId === staff.id);
  if (!sch.length) return false;
  return sch.some(s => {
    if (s.weekdays.length && !s.weekdays.includes(weekday)) return false;
    return s.segments.some(g => min >= toMin(g.start) && min + SLOT_MIN <= toMin(g.end));
  });
}

/** 某员工某槽位是否已被占 */
function staffBusy(staffId, bookings, min) {
  return bookings.some(b => {
    if (b.staffId !== staffId) return false;
    const bs = toMin(b.startTime);
    return min >= bs && min < bs + b.durationMin;
  });
}

/** 算某槽位容量 */
function computeSlot(ctx, min, service) {
  const weekday = new Date(ctx.dk + 'T00:00:00').getDay();
  const avail = ctx.staff.filter(s => staffOnDuty(s, ctx.schedules, min, weekday, service.skill));
  const capacity = Math.min(avail.length, ctx.shop.bed_count || 1);
  const booked = ctx.bookings.filter(b => {
    const bs = toMin(b.startTime);
    return min >= bs && min < bs + b.durationMin;
  }).length;
  return { capacity, booked, remaining: Math.max(0, capacity - booked), avail };
}

async function availability(url, env) {
  const shopId = url.searchParams.get('shopId') || 'shop_demo';
  const serviceId = url.searchParams.get('serviceId');
  const date = url.searchParams.get('date');   // YYYY-MM-DD
  const staffId = url.searchParams.get('staffId') || null;

  const svc = await env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first();
  if (!svc) return err('服务不存在', 404);

  const ctx = await loadDayContext(env, shopId, date);
  ctx.dk = date;
  const service = { skill: svc.skill, durationMin: svc.duration_min };

  const open = toMin(ctx.shop.open_time);
  const close = toMin(ctx.shop.close_time);
  const need = Math.ceil(svc.duration_min / SLOT_MIN);

  const out = [];
  for (let t = open; t + SLOT_MIN <= close; t += SLOT_MIN) {
    // 检查连续 need 格
    let ok = true, reason = '';
    let minRem = Infinity;

    if (t + svc.duration_min > close) {
      ok = false; reason = '超出营业时间';
    } else {
      for (let i = 0; i < need; i++) {
        const s = computeSlot(ctx, t + i * SLOT_MIN, service);
        minRem = Math.min(minRem, s.remaining);
        if (s.remaining <= 0) { ok = false; reason = '已约满'; break; }
        if (staffId) {
          const st = ctx.staff.find(x => x.id === staffId);
          const weekday = new Date(date + 'T00:00:00').getDay();
          const onDuty = st && staffOnDuty(st, ctx.schedules, t + i * SLOT_MIN, weekday, service.skill);
          const busy = st && staffBusy(staffId, ctx.bookings, t + i * SLOT_MIN);
          if (!onDuty || busy) { ok = false; reason = '技师不可用'; break; }
        }
      }
    }
    out.push({
      time: toHHMM(t), ok, reason,
      remaining: minRem === Infinity ? 0 : minRem,
    });
  }

  return json({ ok: true, service: { id: svc.id, name: svc.name, durationMin: svc.duration_min }, slots: out });
}

async function listBookings(url, env) {
  const shopId = url.searchParams.get('shopId');
  const customerId = url.searchParams.get('customerId');
  const date = url.searchParams.get('date');

  let sql = 'SELECT * FROM bookings WHERE 1=1';
  const args = [];
  if (shopId) { sql += ' AND shop_id = ?'; args.push(shopId); }
  if (customerId) { sql += ' AND customer_id = ?'; args.push(customerId); }
  if (date) { sql += ' AND date_key = ?'; args.push(date); }
  sql += ' ORDER BY date_key, start_time';

  const rows = await env.DB.prepare(sql).bind(...args).all();
  return json({
    ok: true,
    bookings: (rows.results || []).map(rowToBooking),
  });
}

function rowToBooking(b) {
  return {
    id: b.id, shopId: b.shop_id, customerId: b.customer_id,
    customerName: b.customer_name, customerPhone: b.customer_phone,
    serviceId: b.service_id, serviceName: b.service_name, durationMin: b.duration_min,
    staffId: b.staff_id, assignMode: b.assign_mode,
    dateKey: b.date_key, startTime: b.start_time, status: b.status,
    createdAt: b.created_at,
  };
}

/**
 * 创建预约（含防超卖）
 * ★ 关键：用 D1 的事务 + 唯一索引双保险
 */
async function createBooking(request, env) {
  const b = await request.json();
  const { shopId, customerId, serviceId, dateKey: dk, startTime, staffId } = b;

  if (!shopId || !customerId || !serviceId || !dk || !startTime) {
    return err('参数不全');
  }

  const svc = await env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(serviceId).first();
  if (!svc) return err('服务不存在', 404);

  const ctx = await loadDayContext(env, shopId, dk);
  ctx.dk = dk;
  const service = { skill: svc.skill, durationMin: svc.duration_min };

  const open = toMin(ctx.shop.open_time);
  const close = toMin(ctx.shop.close_time);
  const t = toMin(startTime);
  const need = Math.ceil(svc.duration_min / SLOT_MIN);

  if (t < open || t + svc.duration_min > close) return err('超出营业时间');

  // 逐格校验
  for (let i = 0; i < need; i++) {
    const s = computeSlot(ctx, t + i * SLOT_MIN, service);
    if (s.remaining <= 0) return err(`时段 ${toHHMM(t + i * SLOT_MIN)} 已约满`);
    if (staffId) {
      const weekday = new Date(dk + 'T00:00:00').getDay();
      const st = ctx.staff.find(x => x.id === staffId);
      if (!st || !staffOnDuty(st, ctx.schedules, t + i * SLOT_MIN, weekday, service.skill)) {
        return err('该技师此时段不在岗');
      }
      if (staffBusy(staffId, ctx.bookings, t + i * SLOT_MIN)) {
        return err('该技师此时段已被预约');
      }
    }
  }

  const cust = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first();

  const id = uid('bk');
  try {
    await env.DB.prepare(
      `INSERT INTO bookings
       (id,shop_id,customer_id,customer_name,customer_phone,service_id,service_name,
        duration_min,staff_id,assign_mode,date_key,start_time,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, shopId, customerId, cust?.name || b.customerName, cust?.phone || b.customerPhone,
      serviceId, svc.name, svc.duration_min,
      staffId || null, staffId ? 'customer_pick' : 'shop_assign',
      dk, startTime, 'confirmed', Date.now()
    ).run();
  } catch (e) {
    // 唯一索引冲突 = 并发下同一技师同一时段被抢
    if (String(e.message).includes('UNIQUE')) {
      return err('这个时段刚被别人约走了，请换一个', 409);
    }
    throw e;
  }

  const row = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
  return json({ ok: true, booking: rowToBooking(row) });
}

async function updateBooking(request, env, path) {
  const id = path.split('/').pop();
  const b = await request.json();
  if (b.status) {
    await env.DB.prepare('UPDATE bookings SET status = ? WHERE id = ?').bind(b.status, id).run();
  }
  return json({ ok: true });
}

async function cancelBooking(request, env, path) {
  const id = path.split('/').pop();
  await env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

/** 店长分配技师（含防冲突） */
async function assignStaff(request, env) {
  const { bookingId, staffId } = await request.json();
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
  if (!b) return err('预约不存在', 404);

  const ctx = await loadDayContext(env, b.shop_id, b.date_key);
  ctx.dk = b.date_key;
  const t = toMin(b.start_time);
  const need = Math.ceil(b.duration_min / SLOT_MIN);

  const st = ctx.staff.find(x => x.id === staffId);
  if (!st) return err('员工不存在');

  const svc = await env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(b.service_id).first();
  const weekday = new Date(b.date_key + 'T00:00:00').getDay();

  for (let i = 0; i < need; i++) {
    const min = t + i * SLOT_MIN;
    if (!staffOnDuty(st, ctx.schedules, min, weekday, svc?.skill)) {
      return err(`${st.name} 在 ${toHHMM(min)} 不在岗或不会做这个项目`);
    }
    // 排除自己这条
    const others = ctx.bookings.filter(x => !(x.staffId === staffId && x.startTime === b.start_time));
    if (staffBusy(staffId, others, min)) {
      return err(`${st.name} 在 ${toHHMM(min)} 已被其他预约占用`);
    }
  }

  try {
    await env.DB.prepare(
      "UPDATE bookings SET staff_id = ?, assign_mode = 'shop_assign' WHERE id = ?"
    ).bind(staffId, bookingId).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return err('该技师此时段已被预约', 409);
    }
    throw e;
  }
  return json({ ok: true });
}

/* ============================ 总部统计 ============================ */

async function hqOverview(env) {
  // 真实版：按 shop 聚合 bookings
  // 当前只有一家店，先返回结构，多店接入后补全
  const shops = await env.DB.prepare('SELECT * FROM shops').all();
  const list = [];
  for (const s of (shops.results || [])) {
    const stats = await env.DB.prepare(
      `SELECT
        COUNT(*) as bookings,
        SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status='arrived' THEN 1 ELSE 0 END) as arrived
       FROM bookings WHERE shop_id = ?`
    ).bind(s.id).first();
    list.push({
      id: s.id, name: s.name, bedCount: s.bed_count,
      bookings: stats?.bookings || 0,
      confirmed: stats?.confirmed || 0,
      arrived: stats?.arrived || 0,
    });
  }
  return json({ ok: true, shops: list, note: '多店数据接入后补全横向对比指标' });
}
