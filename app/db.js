/* ==========================================================================
   发丝管家 · 数据层
   全部存在手机本地（IndexedDB + 照片存为 Blob）
   不依赖任何服务器 —— 换手机/清缓存会丢，仅用于验证
   ========================================================================== */

const DB_NAME = 'haircrm';
const DB_VER = 1;

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // 客户表
      if (!db.objectStoreNames.contains('customers')) {
        const s = db.createObjectStore('customers', { keyPath: 'id' });
        s.createIndex('name', 'name');
      }
      // 照片表（存 Blob）
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('customerId', 'customerId');
        s.createIndex('takenAt', 'takenAt');
      }
      // 联系记录
      if (!db.objectStoreNames.contains('contacts')) {
        const s = db.createObjectStore('contacts', { keyPath: 'id' });
        s.createIndex('customerId', 'customerId');
      }
      // 设置（店名等）
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

function req2p(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ---------- 通用 ---------- */
const DB = {
  async put(store, obj) {
    const s = await tx(store, 'readwrite');
    await req2p(s.put(obj));
    return obj;
  },
  async get(store, id) {
    const s = await tx(store, 'readonly');
    return req2p(s.get(id));
  },
  async del(store, id) {
    const s = await tx(store, 'readwrite');
    return req2p(s.delete(id));
  },
  async all(store) {
    const s = await tx(store, 'readonly');
    return req2p(s.getAll());
  },
  async byIndex(store, index, value) {
    const s = await tx(store, 'readonly');
    return req2p(s.index(index).getAll(value));
  },
};

/* ---------- 业务层 ---------- */
const Store = {
  /* 客户 */
  async customers() {
    const list = await DB.all('customers');
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
  },
  async customer(id) { return DB.get('customers', id); },

  async saveCustomer(c) {
    if (!c.id) c.id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    if (!c.createdAt) c.createdAt = Date.now();
    c.updatedAt = Date.now();
    return DB.put('customers', c);
  },

  async deleteCustomer(id) {
    // 连带删除照片与联系记录
    const photos = await this.photosOf(id);
    for (const p of photos) await DB.del('photos', p.id);
    const contacts = await DB.byIndex('contacts', 'customerId', id);
    for (const c of contacts) await DB.del('contacts', c.id);
    return DB.del('customers', id);
  },

  /* 照片 */
  async addPhoto(customerId, blob, note) {
    const p = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      customerId,
      blob,
      note: note || '',
      takenAt: Date.now(),
    };
    await DB.put('photos', p);
    return p;
  },

  async photosOf(customerId) {
    const list = await DB.byIndex('photos', 'customerId', customerId);
    return list.sort((a, b) => a.takenAt - b.takenAt);
  },

  async deletePhoto(id) { return DB.del('photos', id); },

  /* 联系记录 */
  async addContact(customerId, type, text) {
    const c = {
      id: 'ct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      customerId, type, text,
      at: Date.now(),
    };
    await DB.put('contacts', c);
    // 更新客户最后联系时间
    const cust = await this.customer(customerId);
    if (cust) { cust.lastContactAt = c.at; await DB.put('customers', cust); }
    return c;
  },

  async contactsOf(customerId) {
    const list = await DB.byIndex('contacts', 'customerId', customerId);
    return list.sort((a, b) => b.at - a.at);
  },

  /* 设置 */
  async getSetting(key, def) {
    const r = await DB.get('settings', key);
    return r ? r.value : def;
  },
  async setSetting(key, value) {
    return DB.put('settings', { key, value });
  },

  /* ---------- 导出 / 导入（换手机用） ---------- */
  async exportAll() {
    const [customers, photos, contacts, settings] = await Promise.all([
      DB.all('customers'), DB.all('photos'), DB.all('contacts'), DB.all('settings'),
    ]);
    const photosOut = [];
    for (const p of photos) {
      photosOut.push({ ...p, blob: await blobToDataURL(p.blob) });
    }
    return { version: 1, exportedAt: Date.now(), customers, photos: photosOut, contacts, settings };
  },

  async importAll(data) {
    if (!data || !data.customers) throw new Error('文件格式不对');
    for (const c of data.customers || []) await DB.put('customers', c);
    for (const ct of data.contacts || []) await DB.put('contacts', ct);
    for (const s of data.settings || []) await DB.put('settings', s);
    for (const p of data.photos || []) {
      const { blob, ...meta } = p;
      await DB.put('photos', { ...meta, blob: await dataURLToBlob(blob) });
    }
    return true;
  },

  async clearAll() {
    for (const s of ['customers', 'photos', 'contacts', 'settings']) {
      const s2 = await tx(s, 'readwrite');
      await req2p(s2.clear());
    }
  },
};

/* ---------- Blob <-> DataURL ---------- */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL) {
  if (!dataURL) return Promise.resolve(new Blob());
  return fetch(dataURL).then(r => r.blob());
}
