/* ==========================================================================
   发丝管家 v2 · 数据层
   
   设计要点：
   - 双模式：'local'（IndexedDB，先跑起来）/ 'cloud'（接后端）
   - 切换只改 API_CONFIG.mode，业务代码不用动
   - 所有写操作都走统一接口，方便后面换成 REST/云函数
   
   为什么这样设计：
   GitHub Pages 是纯静态托管，存不了多人共享的数据。
   但为了「今天就能跑」，先用本地模式把界面和算法跑通，
   接后端那天只换 adapter，不改业务逻辑。
   ========================================================================== */

const API_CONFIG = {
  mode: 'local',                 // ★ 'local' | 'cloud'
  baseUrl: '',                   // cloud 模式下填后端地址
};

/* ---------------- 实体定义（与方案文档一致） ---------------- */
/*
  shops / staff / schedules / services / bookings / customers
  本版本只做：shops, staff, schedules, services, bookings, customers
  消费/储值（orders/packages）留到下一期
*/

const DB_NAME = 'haircrm_v2';
const DB_VER = 1;

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const stores = {
        shops:     { keyPath: 'id' },
        staff:     { keyPath: 'id' },
        schedules: { keyPath: 'id' },
        services:  { keyPath: 'id' },
        bookings:  { keyPath: 'id' },
        customers: { keyPath: 'id' },
        settings:  { keyPath: 'key' },
      };
      for (const [name, opt] of Object.entries(stores)) {
        if (!db.objectStoreNames.contains(name)) {
          const s = db.createObjectStore(name, opt);
          // 常用索引
          if (name === 'staff') s.createIndex('shopId', 'shopId');
          if (name === 'staff') s.createIndex('openid', 'openid', { unique: false });
          if (name === 'schedules') s.createIndex('staffId', 'staffId');
          if (name === 'services') s.createIndex('shopId', 'shopId');
          if (name === 'bookings') s.createIndex('shopId', 'shopId');
          if (name === 'bookings') s.createIndex('customerId', 'customerId');
          if (name === 'customers') s.createIndex('phone', 'phone', { unique: false });
        }
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
function req2p(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/* ---------------- 通用本地存储 ---------------- */
const Local = {
  async put(store, obj) { const s = await tx(store, 'readwrite'); await req2p(s.put(obj)); return obj; },
  async get(store, id) { const s = await tx(store, 'readonly'); return req2p(s.get(id)); },
  async del(store, id) { const s = await tx(store, 'readwrite'); return req2p(s.delete(id)); },
  async all(store) { const s = await tx(store, 'readonly'); return req2p(s.getAll()); },
  async byIndex(store, idx, val) { const s = await tx(store, 'readonly'); return req2p(s.index(idx).getAll(val)); },
  async clear(store) { const s = await tx(store, 'readwrite'); return req2p(s.clear()); },
};

/* ---------------- 云端适配器（骨架，接后端时实现） ---------------- */
const Cloud = {
  async req(path, opt = {}) {
    const r = await fetch(API_CONFIG.baseUrl + path, {
      method: opt.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  // 每个方法对应一个 REST 端点，后端按同样语义实现即可
  put(store, obj)       { return this.req(`/${store}`, { method: 'PUT', body: obj }); },
  get(store, id)        { return this.req(`/${store}/${encodeURIComponent(id)}`); },
  del(store, id)        { return this.req(`/${store}/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  all(store)            { return this.req(`/${store}`); },
  byIndex(store, i, v)  { return this.req(`/${store}?${encodeURIComponent(i)}=${encodeURIComponent(v)}`); },
  clear(store)          { return this.req(`/${store}`, { method: 'DELETE' }); },
};

/* 统一入口：按 mode 选实现 */
function backend() { return API_CONFIG.mode === 'cloud' ? Cloud : Local; }

const DB = {
  put(store, obj)        { return backend().put(store, obj); },
  get(store, id)         { return backend().get(store, id); },
  del(store, id)         { return backend().del(store, id); },
  all(store)             { return backend().all(store); },
  byIndex(store, i, v)   { return backend().byIndex(store, i, v); },
  clear(store)           { return backend().clear(store); },
};

/* ==========================================================================
   业务层
   ========================================================================== */

const Store = {
  /* ---------- 店铺 ---------- */
  async shops() { return DB.all('shops'); },
  async shop(id) { return DB.get('shops', id); },
  async saveShop(s) {
    if (!s.id) s.id = uid('shop');
    s.updatedAt = Date.now();
    if (!s.createdAt) s.createdAt = Date.now();
    return DB.put('shops', s);
  },

  /* ---------- 员工 ---------- */
  async staffOf(shopId) { return DB.byIndex('staff', 'shopId', shopId); },
  async staff(id) { return DB.get('staff', id); },

  /**
   * 保存员工 —— 强制校验「同一时间只能入职一个店铺」
   * ★ 这条约束前端也要查一遍（真正保障在数据库唯一索引）
   */
  async saveStaff(st) {
    if (!st.id) st.id = uid('staff');

    if (st.status === 'active') {
      const all = await DB.all('staff');
      const conflict = all.find(x =>
        x.id !== st.id &&
        x.openid && st.openid &&
        x.openid === st.openid &&
        x.status === 'active'
      );
      if (conflict) {
        throw new Error(`${st.name} 已在「${conflict.shopName || '另一家店'}」在职。同一时间只能入职一个店铺。`);
      }
    }
    st.updatedAt = Date.now();
    if (!st.createdAt) st.createdAt = Date.now();
    return DB.put('staff', st);
  },

  /* ---------- 工作时间 ---------- */
  async schedulesOf(staffId) { return DB.byIndex('schedules', 'staffId', staffId); },
  async saveSchedule(sc) {
    if (!sc.id) sc.id = uid('sch');
    return DB.put('schedules', sc);
  },
  async deleteSchedule(id) { return DB.del('schedules', id); },

  /* ---------- 服务项目 ---------- */
  async servicesOf(shopId) { return DB.byIndex('services', 'shopId', shopId); },
  async saveService(sv) {
    if (!sv.id) sv.id = uid('svc');
    return DB.put('services', sv);
  },
  async deleteService(id) { return DB.del('services', id); },

  /* ---------- 客户 ---------- */
  async customers() { return DB.all('customers'); },
  async customer(id) { return DB.get('customers', id); },
  async findCustomerByPhone(phone) {
    const list = await DB.all('customers');
    return list.find(c => c.phone === phone) || null;
  },
  async saveCustomer(c) {
    if (!c.id) c.id = uid('cust');
    c.updatedAt = Date.now();
    if (!c.createdAt) c.createdAt = Date.now();
    return DB.put('customers', c);
  },

  /* ---------- 预约 ---------- */
  async bookingsOf(shopId) { return DB.byIndex('bookings', 'shopId', shopId); },
  async bookingsOfCustomer(cid) { return DB.byIndex('bookings', 'customerId', cid); },
  async booking(id) { return DB.get('bookings', id); },
  async saveBooking(b) {
    if (!b.id) b.id = uid('bk');
    if (!b.createdAt) b.createdAt = Date.now();
    return DB.put('bookings', b);
  },
  async deleteBooking(id) { return DB.del('bookings', id); },

  /* ---------- 设置 ---------- */
  async getSetting(k, d) { const r = await DB.get('settings', k); return r ? r.value : d; },
  async setSetting(k, v) { return DB.put('settings', { key: k, value: v }); },

  /* ---------- 初始化演示数据 ---------- */
  async seedIfEmpty() {
    const shops = await DB.all('shops');
    if (shops.length) return false;

    const shop = await this.saveShop({
      name: '张姐养发馆（示范店）',
      phone: '13800138000',
      bedCount: 3,
      businessHours: { open: '09:00', close: '18:00' },
      allowCustomerPickStaff: false,   // ★ 默认关闭
      slotMinutes: 30,
    });

    const st1 = await this.saveStaff({
      shopId: shop.id, shopName: shop.name, name: '小王', role: 'manager',
      username: 'wang', password: '123456', openid: 'wx_wang',
      skills: ['白发转黑', '头皮护理'], status: 'active',
    });
    const st2 = await this.saveStaff({
      shopId: shop.id, shopName: shop.name, name: '小李', role: 'staff',
      username: 'li', password: '123456', openid: 'wx_li',
      skills: ['白发转黑'], status: 'active',
    });
    const st3 = await this.saveStaff({
      shopId: shop.id, shopName: shop.name, name: '小张', role: 'staff',
      username: 'zhang', password: '123456', openid: 'wx_zhang',
      skills: ['头皮护理', '头部SPA'], status: 'active',
    });

    // 工作时间（周模板：1-7 全周，简化演示）
    const seg = {
      [st1.id]: [['09:00', '12:00'], ['13:30', '18:00']],
      [st2.id]: [['10:00', '18:00']],
      [st3.id]: [['09:00', '13:00']],
    };
    for (const [sid, segments] of Object.entries(seg)) {
      await this.saveSchedule({
        staffId: sid, shopId: shop.id, weekdays: [1, 2, 3, 4, 5, 6, 0],
        segments: segments.map(([a, b]) => ({ start: a, end: b })),
        effectiveFrom: null, effectiveTo: null,
      });
    }

    await this.saveService({ shopId: shop.id, name: '白发转黑 · 单次护理', durationMin: 90, price: 398, skill: '白发转黑' });
    await this.saveService({ shopId: shop.id, name: '头皮护理', durationMin: 60, price: 198, skill: '头皮护理' });
    await this.saveService({ shopId: shop.id, name: '头部SPA', durationMin: 30, price: 98, skill: '头部SPA' });

    // 演示客户
    const c1 = await this.saveCustomer({ phone: '13900000001', name: '李姐', shopId: shop.id });
    const c2 = await this.saveCustomer({ phone: '13900000002', name: '王姐', shopId: shop.id });

    return true;
  },
};

/* ---------------- 工具 ---------------- */
function uid(p) { return (p || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function toHHMM(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
function fmtDate(ts) { const d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
function fmtShort(ts) { const d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate(); }
function dateKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
