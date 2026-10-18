var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
  });
}
__name(json, "json");
function err(msg, status = 400) {
  return json({ error: msg }, status);
}
__name(err, "err");
function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
__name(uid, "uid");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");
    const method = request.method;
    if (method === "OPTIONS") return new Response(null, { headers: CORS });
    try {
      if (path === "" || path === "health") {
        const r = await env.DB.prepare("SELECT 1 as ok").first();
        return json({ ok: true, db: r?.ok === 1, ts: Date.now() });
      }
      if (path === "api/init" && method === "POST") {
        return await initDB(env);
      }
      if (path === "api/login/customer" && method === "POST") return await loginCustomer(request, env);
      if (path === "api/login/staff" && method === "POST") return await loginStaff(request, env);
      if (path === "api/shop" && method === "GET") return await getShop(url, env);
      if (path === "api/shop" && method === "PUT") return await updateShop(request, env);
      if (path === "api/staff" && method === "GET") return await listStaff(url, env);
      if (path === "api/staff/schedule" && method === "GET") return await getSchedule(url, env);
      if (path === "api/staff/schedule" && method === "PUT") return await saveSchedule(request, env);
      if (path === "api/services" && method === "GET") return await listServices(url, env);
      if (path === "api/availability" && method === "GET") return await availability(url, env);
      if (path === "api/bookings" && method === "GET") return await listBookings(url, env);
      if (path === "api/bookings" && method === "POST") return await createBooking(request, env);
      if (path.match(/^api\/bookings\/[^/]+$/) && method === "PUT") return await updateBooking(request, env, path);
      if (path.match(/^api\/bookings\/[^/]+$/) && method === "DELETE") return await cancelBooking(request, env, path);
      if (path === "api/assign" && method === "POST") return await assignStaff(request, env);
      if (path === "api/hq/overview" && method === "GET") return await hqOverview(env);
      return err("Not Found: " + path, 404);
    } catch (e) {
      return err("Server Error: " + (e.message || e), 500);
    }
  }
};
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
    `CREATE INDEX IF NOT EXISTS ix_booking_customer ON bookings(customer_id)`
  ];
  for (const sql of stmts) {
    await env.DB.prepare(sql).run();
  }
  const shop = await env.DB.prepare("SELECT id FROM shops LIMIT 1").first();
  if (!shop) {
    const now = Date.now();
    const shopId = "shop_demo";
    await env.DB.prepare(
      `INSERT INTO shops (id,name,phone,bed_count,open_time,close_time,allow_pick_staff,created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(shopId, "\u5F20\u59D0\u517B\u53D1\u9986\uFF08\u793A\u8303\u5E97\uFF09", "13800138000", 3, "09:00", "18:00", 0, now).run();
    const staffData = [
      ["staff_wang", "\u5C0F\u738B", "manager", "wang", JSON.stringify(["\u767D\u53D1\u8F6C\u9ED1", "\u5934\u76AE\u62A4\u7406"]), "wx_wang"],
      ["staff_li", "\u5C0F\u674E", "staff", "li", JSON.stringify(["\u767D\u53D1\u8F6C\u9ED1"]), "wx_li"],
      ["staff_zhang", "\u5C0F\u5F20", "staff", "zhang", JSON.stringify(["\u5934\u76AE\u62A4\u7406", "\u5934\u90E8SPA"]), "wx_zhang"]
    ];
    for (const [id, name, role, user, skills, openid] of staffData) {
      await env.DB.prepare(
        `INSERT INTO staff (id,shop_id,name,role,username,password,openid,skills,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, shopId, name, role, user, "123456", openid, skills, "active", now).run();
    }
    const schData = [
      ["staff_wang", [[1, 2, 3, 4, 5, 6, 0]], [{ start: "09:00", end: "12:00" }, { start: "13:30", end: "18:00" }]],
      ["staff_li", [[1, 2, 3, 4, 5, 6, 0]], [{ start: "10:00", end: "18:00" }]],
      ["staff_zhang", [[1, 2, 3, 4, 5, 6, 0]], [{ start: "09:00", end: "13:00" }]]
    ];
    for (const [sid, wd, segs] of schData) {
      await env.DB.prepare(
        `INSERT INTO schedules (id,staff_id,shop_id,weekdays,segments,updated_at) VALUES (?,?,?,?,?,?)`
      ).bind(uid("sch"), sid, shopId, JSON.stringify(wd[0]), JSON.stringify(segs), now).run();
    }
    const svcData = [
      ["\u767D\u53D1\u8F6C\u9ED1 \xB7 \u5355\u6B21\u62A4\u7406", 90, 398, "\u767D\u53D1\u8F6C\u9ED1"],
      ["\u5934\u76AE\u62A4\u7406", 60, 198, "\u5934\u76AE\u62A4\u7406"],
      ["\u5934\u90E8SPA", 30, 98, "\u5934\u90E8SPA"]
    ];
    for (const [name, dur, price, skill] of svcData) {
      await env.DB.prepare(
        `INSERT INTO services (id,shop_id,name,duration_min,price,skill,created_at) VALUES (?,?,?,?,?,?,?)`
      ).bind(uid("svc"), shopId, name, dur, price, skill, now).run();
    }
  }
  return json({ ok: true, message: "\u6570\u636E\u5E93\u5DF2\u5C31\u7EEA" });
}
__name(initDB, "initDB");
async function loginCustomer(request, env) {
  const { name, phone } = await request.json();
  if (!name || !/^1\d{10}$/.test(phone || "")) return err("\u59D3\u540D\u6216\u624B\u673A\u53F7\u4E0D\u5408\u6CD5");
  let c = await env.DB.prepare("SELECT * FROM customers WHERE phone = ?").bind(phone).first();
  if (!c) {
    const id = uid("cust");
    await env.DB.prepare(
      "INSERT INTO customers (id,phone,name,shop_id,created_at) VALUES (?,?,?,?,?)"
    ).bind(id, phone, name, null, Date.now()).run();
    c = { id, phone, name };
  } else if (c.name !== name) {
    await env.DB.prepare("UPDATE customers SET name = ? WHERE id = ?").bind(name, c.id).run();
    c.name = name;
  }
  return json({ ok: true, user: { id: c.id, name: c.name, phone: c.phone, role: "customer" } });
}
__name(loginCustomer, "loginCustomer");
async function loginStaff(request, env) {
  const { username, password } = await request.json();
  const s = await env.DB.prepare(
    "SELECT * FROM staff WHERE username = ? AND password = ? AND status = 'active'"
  ).bind(username, password).first();
  if (!s) return err("\u8D26\u53F7\u6216\u5BC6\u7801\u4E0D\u5BF9", 401);
  return json({
    ok: true,
    user: {
      id: s.id,
      name: s.name,
      role: s.role,
      shopId: s.shop_id,
      skills: JSON.parse(s.skills || "[]")
    }
  });
}
__name(loginStaff, "loginStaff");
async function getShop(url, env) {
  const id = url.searchParams.get("id");
  const s = id ? await env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(id).first() : await env.DB.prepare("SELECT * FROM shops LIMIT 1").first();
  if (!s) return err("\u5E97\u94FA\u4E0D\u5B58\u5728", 404);
  return json({
    ok: true,
    shop: {
      id: s.id,
      name: s.name,
      phone: s.phone,
      bedCount: s.bed_count,
      businessHours: { open: s.open_time, close: s.close_time },
      allowCustomerPickStaff: s.allow_pick_staff === 1
    }
  });
}
__name(getShop, "getShop");
async function updateShop(request, env) {
  const body = await request.json();
  const { id } = body;
  if (!id) return err("\u7F3A\u5C11\u5E97\u94FA id");
  await env.DB.prepare(
    `UPDATE shops SET name=?, phone=?, bed_count=?, open_time=?, close_time=?, allow_pick_staff=? WHERE id=?`
  ).bind(
    body.name,
    body.phone,
    body.bedCount,
    body.businessHours?.open || "09:00",
    body.businessHours?.close || "18:00",
    body.allowCustomerPickStaff ? 1 : 0,
    id
  ).run();
  return json({ ok: true });
}
__name(updateShop, "updateShop");
async function listStaff(url, env) {
  const shopId = url.searchParams.get("shopId");
  const rows = await env.DB.prepare(
    "SELECT id,shop_id,name,role,skills,status FROM staff WHERE shop_id = ? AND status = 'active'"
  ).bind(shopId).all();
  return json({
    ok: true,
    staff: (rows.results || []).map((s) => ({
      id: s.id,
      shopId: s.shop_id,
      name: s.name,
      role: s.role,
      skills: JSON.parse(s.skills || "[]")
    }))
  });
}
__name(listStaff, "listStaff");
async function getSchedule(url, env) {
  const staffId = url.searchParams.get("staffId");
  const r = await env.DB.prepare("SELECT * FROM schedules WHERE staff_id = ?").bind(staffId).first();
  if (!r) return json({ ok: true, schedule: null });
  return json({
    ok: true,
    schedule: {
      id: r.id,
      staffId: r.staff_id,
      shopId: r.shop_id,
      weekdays: JSON.parse(r.weekdays || "[]"),
      segments: JSON.parse(r.segments || "[]")
    }
  });
}
__name(getSchedule, "getSchedule");
async function saveSchedule(request, env) {
  const b = await request.json();
  if (!b.staffId) return err("\u7F3A\u5C11 staffId");
  const exist = await env.DB.prepare("SELECT id FROM schedules WHERE staff_id = ?").bind(b.staffId).first();
  if (exist) {
    await env.DB.prepare(
      "UPDATE schedules SET weekdays=?, segments=?, updated_at=? WHERE id=?"
    ).bind(JSON.stringify(b.weekdays), JSON.stringify(b.segments), Date.now(), exist.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO schedules (id,staff_id,shop_id,weekdays,segments,updated_at) VALUES (?,?,?,?,?,?)"
    ).bind(uid("sch"), b.staffId, b.shopId, JSON.stringify(b.weekdays), JSON.stringify(b.segments), Date.now()).run();
  }
  return json({ ok: true });
}
__name(saveSchedule, "saveSchedule");
async function listServices(url, env) {
  const shopId = url.searchParams.get("shopId");
  const rows = await env.DB.prepare("SELECT * FROM services WHERE shop_id = ?").bind(shopId).all();
  return json({
    ok: true,
    services: (rows.results || []).map((s) => ({
      id: s.id,
      shopId: s.shop_id,
      name: s.name,
      durationMin: s.duration_min,
      price: s.price,
      skill: s.skill
    }))
  });
}
__name(listServices, "listServices");
var SLOT_MIN = 30;
function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
__name(toMin, "toMin");
function toHHMM(min) {
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}
__name(toHHMM, "toHHMM");
async function loadDayContext(env, shopId, dk) {
  const shop = await env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(shopId).first();
  const staffRows = await env.DB.prepare(
    "SELECT * FROM staff WHERE shop_id = ? AND status = 'active'"
  ).bind(shopId).all();
  const schRows = await env.DB.prepare(
    "SELECT * FROM schedules WHERE shop_id = ?"
  ).bind(shopId).all();
  const bookingRows = await env.DB.prepare(
    "SELECT * FROM bookings WHERE shop_id = ? AND date_key = ? AND status != 'cancelled'"
  ).bind(shopId, dk).all();
  return {
    shop,
    staff: (staffRows.results || []).map((s) => ({
      id: s.id,
      name: s.name,
      skills: JSON.parse(s.skills || "[]")
    })),
    schedules: (schRows.results || []).map((s) => ({
      staffId: s.staff_id,
      weekdays: JSON.parse(s.weekdays || "[]"),
      segments: JSON.parse(s.segments || "[]")
    })),
    bookings: (bookingRows.results || []).map((b) => ({
      staffId: b.staff_id,
      startTime: b.start_time,
      durationMin: b.duration_min
    }))
  };
}
__name(loadDayContext, "loadDayContext");
function staffOnDuty(staff, schedules, min, weekday, skill) {
  if (skill && !staff.skills.includes(skill)) return false;
  const sch = schedules.filter((s) => s.staffId === staff.id);
  if (!sch.length) return false;
  return sch.some((s) => {
    if (s.weekdays.length && !s.weekdays.includes(weekday)) return false;
    return s.segments.some((g) => min >= toMin(g.start) && min + SLOT_MIN <= toMin(g.end));
  });
}
__name(staffOnDuty, "staffOnDuty");
function staffBusy(staffId, bookings, min) {
  return bookings.some((b) => {
    if (b.staffId !== staffId) return false;
    const bs = toMin(b.startTime);
    return min >= bs && min < bs + b.durationMin;
  });
}
__name(staffBusy, "staffBusy");
function computeSlot(ctx, min, service) {
  const weekday = (/* @__PURE__ */ new Date(ctx.dk + "T00:00:00")).getDay();
  const avail = ctx.staff.filter((s) => staffOnDuty(s, ctx.schedules, min, weekday, service.skill));
  const capacity = Math.min(avail.length, ctx.shop.bed_count || 1);
  const booked = ctx.bookings.filter((b) => {
    const bs = toMin(b.startTime);
    return min >= bs && min < bs + b.durationMin;
  }).length;
  return { capacity, booked, remaining: Math.max(0, capacity - booked), avail };
}
__name(computeSlot, "computeSlot");
async function availability(url, env) {
  const shopId = url.searchParams.get("shopId") || "shop_demo";
  const serviceId = url.searchParams.get("serviceId");
  const date = url.searchParams.get("date");
  const staffId = url.searchParams.get("staffId") || null;
  const svc = await env.DB.prepare("SELECT * FROM services WHERE id = ?").bind(serviceId).first();
  if (!svc) return err("\u670D\u52A1\u4E0D\u5B58\u5728", 404);
  const ctx = await loadDayContext(env, shopId, date);
  ctx.dk = date;
  const service = { skill: svc.skill, durationMin: svc.duration_min };
  const open = toMin(ctx.shop.open_time);
  const close = toMin(ctx.shop.close_time);
  const need = Math.ceil(svc.duration_min / SLOT_MIN);
  const out = [];
  for (let t = open; t + SLOT_MIN <= close; t += SLOT_MIN) {
    let ok = true, reason = "";
    let minRem = Infinity;
    if (t + svc.duration_min > close) {
      ok = false;
      reason = "\u8D85\u51FA\u8425\u4E1A\u65F6\u95F4";
    } else {
      for (let i = 0; i < need; i++) {
        const s = computeSlot(ctx, t + i * SLOT_MIN, service);
        minRem = Math.min(minRem, s.remaining);
        if (s.remaining <= 0) {
          ok = false;
          reason = "\u5DF2\u7EA6\u6EE1";
          break;
        }
        if (staffId) {
          const st = ctx.staff.find((x) => x.id === staffId);
          const weekday = (/* @__PURE__ */ new Date(date + "T00:00:00")).getDay();
          const onDuty = st && staffOnDuty(st, ctx.schedules, t + i * SLOT_MIN, weekday, service.skill);
          const busy = st && staffBusy(staffId, ctx.bookings, t + i * SLOT_MIN);
          if (!onDuty || busy) {
            ok = false;
            reason = "\u6280\u5E08\u4E0D\u53EF\u7528";
            break;
          }
        }
      }
    }
    out.push({
      time: toHHMM(t),
      ok,
      reason,
      remaining: minRem === Infinity ? 0 : minRem
    });
  }
  return json({ ok: true, service: { id: svc.id, name: svc.name, durationMin: svc.duration_min }, slots: out });
}
__name(availability, "availability");
async function listBookings(url, env) {
  const shopId = url.searchParams.get("shopId");
  const customerId = url.searchParams.get("customerId");
  const date = url.searchParams.get("date");
  let sql = "SELECT * FROM bookings WHERE 1=1";
  const args = [];
  if (shopId) {
    sql += " AND shop_id = ?";
    args.push(shopId);
  }
  if (customerId) {
    sql += " AND customer_id = ?";
    args.push(customerId);
  }
  if (date) {
    sql += " AND date_key = ?";
    args.push(date);
  }
  sql += " ORDER BY date_key, start_time";
  const rows = await env.DB.prepare(sql).bind(...args).all();
  return json({
    ok: true,
    bookings: (rows.results || []).map(rowToBooking)
  });
}
__name(listBookings, "listBookings");
function rowToBooking(b) {
  return {
    id: b.id,
    shopId: b.shop_id,
    customerId: b.customer_id,
    customerName: b.customer_name,
    customerPhone: b.customer_phone,
    serviceId: b.service_id,
    serviceName: b.service_name,
    durationMin: b.duration_min,
    staffId: b.staff_id,
    assignMode: b.assign_mode,
    dateKey: b.date_key,
    startTime: b.start_time,
    status: b.status,
    createdAt: b.created_at
  };
}
__name(rowToBooking, "rowToBooking");
async function createBooking(request, env) {
  const b = await request.json();
  const { shopId, customerId, serviceId, dateKey: dk, startTime, staffId } = b;
  if (!shopId || !customerId || !serviceId || !dk || !startTime) {
    return err("\u53C2\u6570\u4E0D\u5168");
  }
  const svc = await env.DB.prepare("SELECT * FROM services WHERE id = ?").bind(serviceId).first();
  if (!svc) return err("\u670D\u52A1\u4E0D\u5B58\u5728", 404);
  const ctx = await loadDayContext(env, shopId, dk);
  ctx.dk = dk;
  const service = { skill: svc.skill, durationMin: svc.duration_min };
  const open = toMin(ctx.shop.open_time);
  const close = toMin(ctx.shop.close_time);
  const t = toMin(startTime);
  const need = Math.ceil(svc.duration_min / SLOT_MIN);
  if (t < open || t + svc.duration_min > close) return err("\u8D85\u51FA\u8425\u4E1A\u65F6\u95F4");
  for (let i = 0; i < need; i++) {
    const s = computeSlot(ctx, t + i * SLOT_MIN, service);
    if (s.remaining <= 0) return err(`\u65F6\u6BB5 ${toHHMM(t + i * SLOT_MIN)} \u5DF2\u7EA6\u6EE1`);
    if (staffId) {
      const weekday = (/* @__PURE__ */ new Date(dk + "T00:00:00")).getDay();
      const st = ctx.staff.find((x) => x.id === staffId);
      if (!st || !staffOnDuty(st, ctx.schedules, t + i * SLOT_MIN, weekday, service.skill)) {
        return err("\u8BE5\u6280\u5E08\u6B64\u65F6\u6BB5\u4E0D\u5728\u5C97");
      }
      if (staffBusy(staffId, ctx.bookings, t + i * SLOT_MIN)) {
        return err("\u8BE5\u6280\u5E08\u6B64\u65F6\u6BB5\u5DF2\u88AB\u9884\u7EA6");
      }
    }
  }
  const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first();
  const id = uid("bk");
  try {
    await env.DB.prepare(
      `INSERT INTO bookings
       (id,shop_id,customer_id,customer_name,customer_phone,service_id,service_name,
        duration_min,staff_id,assign_mode,date_key,start_time,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,
      shopId,
      customerId,
      cust?.name || b.customerName,
      cust?.phone || b.customerPhone,
      serviceId,
      svc.name,
      svc.duration_min,
      staffId || null,
      staffId ? "customer_pick" : "shop_assign",
      dk,
      startTime,
      "confirmed",
      Date.now()
    ).run();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return err("\u8FD9\u4E2A\u65F6\u6BB5\u521A\u88AB\u522B\u4EBA\u7EA6\u8D70\u4E86\uFF0C\u8BF7\u6362\u4E00\u4E2A", 409);
    }
    throw e;
  }
  const row = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
  return json({ ok: true, booking: rowToBooking(row) });
}
__name(createBooking, "createBooking");
async function updateBooking(request, env, path) {
  const id = path.split("/").pop();
  const b = await request.json();
  if (b.status) {
    await env.DB.prepare("UPDATE bookings SET status = ? WHERE id = ?").bind(b.status, id).run();
  }
  return json({ ok: true });
}
__name(updateBooking, "updateBooking");
async function cancelBooking(request, env, path) {
  const id = path.split("/").pop();
  await env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
__name(cancelBooking, "cancelBooking");
async function assignStaff(request, env) {
  const { bookingId, staffId } = await request.json();
  const b = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first();
  if (!b) return err("\u9884\u7EA6\u4E0D\u5B58\u5728", 404);
  const ctx = await loadDayContext(env, b.shop_id, b.date_key);
  ctx.dk = b.date_key;
  const t = toMin(b.start_time);
  const need = Math.ceil(b.duration_min / SLOT_MIN);
  const st = ctx.staff.find((x) => x.id === staffId);
  if (!st) return err("\u5458\u5DE5\u4E0D\u5B58\u5728");
  const svc = await env.DB.prepare("SELECT * FROM services WHERE id = ?").bind(b.service_id).first();
  const weekday = (/* @__PURE__ */ new Date(b.date_key + "T00:00:00")).getDay();
  for (let i = 0; i < need; i++) {
    const min = t + i * SLOT_MIN;
    if (!staffOnDuty(st, ctx.schedules, min, weekday, svc?.skill)) {
      return err(`${st.name} \u5728 ${toHHMM(min)} \u4E0D\u5728\u5C97\u6216\u4E0D\u4F1A\u505A\u8FD9\u4E2A\u9879\u76EE`);
    }
    const others = ctx.bookings.filter((x) => !(x.staffId === staffId && x.startTime === b.start_time));
    if (staffBusy(staffId, others, min)) {
      return err(`${st.name} \u5728 ${toHHMM(min)} \u5DF2\u88AB\u5176\u4ED6\u9884\u7EA6\u5360\u7528`);
    }
  }
  try {
    await env.DB.prepare(
      "UPDATE bookings SET staff_id = ?, assign_mode = 'shop_assign' WHERE id = ?"
    ).bind(staffId, bookingId).run();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return err("\u8BE5\u6280\u5E08\u6B64\u65F6\u6BB5\u5DF2\u88AB\u9884\u7EA6", 409);
    }
    throw e;
  }
  return json({ ok: true });
}
__name(assignStaff, "assignStaff");
async function hqOverview(env) {
  const shops = await env.DB.prepare("SELECT * FROM shops").all();
  const list = [];
  for (const s of shops.results || []) {
    const stats = await env.DB.prepare(
      `SELECT
        COUNT(*) as bookings,
        SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status='arrived' THEN 1 ELSE 0 END) as arrived
       FROM bookings WHERE shop_id = ?`
    ).bind(s.id).first();
    list.push({
      id: s.id,
      name: s.name,
      bedCount: s.bed_count,
      bookings: stats?.bookings || 0,
      confirmed: stats?.confirmed || 0,
      arrived: stats?.arrived || 0
    });
  }
  return json({ ok: true, shops: list, note: "\u591A\u5E97\u6570\u636E\u63A5\u5165\u540E\u8865\u5168\u6A2A\u5411\u5BF9\u6BD4\u6307\u6807" });
}
__name(hqOverview, "hqOverview");

// C:/Users/Administrator/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// C:/Users/Administrator/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-iFsflB/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// C:/Users/Administrator/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-iFsflB/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
