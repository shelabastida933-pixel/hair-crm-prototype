/* ==========================================================================
   发丝管家 v2 · 云端 API 客户端
   
   切换方式：修改 db.js 里的 API_CONFIG.mode
     'local' → 用 IndexedDB（演示，数据不共享）
     'cloud' → 调 Cloudflare Worker（真共享）
   ========================================================================== */

/** 统一请求 */
async function apiReq(path, opt = {}) {
  const r = await fetch(API_CONFIG.baseUrl + path, {
    method: opt.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** 云端数据访问（与 Local 同语义） */
const CloudAPI = {
  /* ---- 店铺 ---- */
  async getShop() {
    const j = await apiReq('/api/shop');
    return j.shop;
  },
  async updateShop(shop) {
    return apiReq('/api/shop', {
      method: 'PUT',
      body: {
        id: shop.id, name: shop.name, phone: shop.phone,
        bedCount: shop.bedCount, businessHours: shop.businessHours,
        allowCustomerPickStaff: shop.allowCustomerPickStaff,
      },
    });
  },

  /* ---- 员工 ---- */
  async listStaff(shopId) {
    const j = await apiReq(`/api/staff?shopId=${encodeURIComponent(shopId)}`);
    return j.staff;
  },
  async getSchedule(staffId) {
    const j = await apiReq(`/api/staff/schedule?staffId=${encodeURIComponent(staffId)}`);
    return j.schedule;
  },
  async saveSchedule(s) {
    return apiReq('/api/staff/schedule', { method: 'PUT', body: s });
  },

  /* ---- 服务 ---- */
  async listServices(shopId) {
    const j = await apiReq(`/api/services?shopId=${encodeURIComponent(shopId)}`);
    return j.services;
  },

  /* ---- 可约时段 ---- */
  async availability(shopId, serviceId, date, staffId) {
    let u = `/api/availability?shopId=${encodeURIComponent(shopId)}&serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`;
    if (staffId) u += `&staffId=${encodeURIComponent(staffId)}`;
    const j = await apiReq(u);
    return j.slots;
  },

  /* ---- 登录 ---- */
  async loginCustomer(name, phone) {
    const j = await apiReq('/api/login/customer', { method: 'POST', body: { name, phone } });
    return j.user;
  },
  async loginStaff(username, password) {
    const j = await apiReq('/api/login/staff', { method: 'POST', body: { username, password } });
    return j.user;
  },

  /* ---- 预约 ---- */
  async listBookings(shopId, date, customerId) {
    let u = '/api/bookings?';
    if (shopId) u += `shopId=${encodeURIComponent(shopId)}&`;
    if (date) u += `date=${encodeURIComponent(date)}&`;
    if (customerId) u += `customerId=${encodeURIComponent(customerId)}&`;
    const j = await apiReq(u);
    return j.bookings;
  },
  async createBooking(b) {
    const j = await apiReq('/api/bookings', { method: 'POST', body: b });
    return j.booking;
  },
  async cancelBooking(id) {
    return apiReq(`/api/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async assignStaff(bookingId, staffId) {
    return apiReq('/api/assign', { method: 'POST', body: { bookingId, staffId } });
  },

  /* ---- 初始化（首次部署调用） ---- */
  async init() { return apiReq('/api/init', { method: 'POST' }); },
};
