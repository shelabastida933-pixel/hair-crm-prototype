/* ==========================================================================
   发丝管家 v2 · 主逻辑
   三种角色：customer / staff / manager
   ========================================================================== */

const S = {
  me: null,          // 当前登录用户
  role: null,        // 'customer' | 'staff' | 'manager'
  shop: null,
  shops: [],
  staff: [], schedules: [], services: [], bookings: [], customers: [],
  sel: { serviceId: null, dateTs: null, staffId: null, slot: null },
  mgTab: 'today',
  staffTab: 'schedule',
};

/* ---------------- 启动 ---------------- */
window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  await openDB();
  await Store.seedIfEmpty();
  // 恢复登录态
  const saved = await Store.getSetting('session', null);
  if (saved) {
    await restoreSession(saved);
  }
}

async function loadAll() {
  S.shops = await DB.all('shops');
  S.shop = S.shops[0] || null;
  if (!S.shop) return;
  S.staff = await Store.staffOf(S.shop.id);
  S.services = await Store.servicesOf(S.shop.id);
  S.bookings = await Store.bookingsOf(S.shop.id);
  S.customers = await DB.all('customers');
  S.schedules = [];
  for (const st of S.staff) {
    S.schedules.push(...await Store.schedulesOf(st.id));
  }
}

async function restoreSession(sess) {
  await loadAll();
  if (sess.role === 'customer') {
    const c = await Store.customer(sess.id);
    if (c) { S.me = c; S.role = 'customer'; enterCustomer(); return; }
  } else {
    const st = await Store.staff(sess.id);
    if (st) { S.me = st; S.role = st.role === 'manager' ? 'manager' : 'staff'; 
      if (S.role === 'manager') enterManager(); else enterStaff(); return; }
  }
  go('sc-login');
}

/* ---------------- 登录 ---------------- */
function loginAs(role) {
  if (role === 'customer') go('sc-custlogin');
  else go('sc-stafflogin');
}

async function doCustomerLogin() {
  const name = document.getElementById('ci-name').value.trim();
  const phone = document.getElementById('ci-phone').value.trim();
  if (!name) return toast('请填姓名');
  if (!/^1\d{10}$/.test(phone)) return toast('手机号格式不对');

  let c = await Store.findCustomerByPhone(phone);
  if (!c) {
    c = await Store.saveCustomer({ name, phone, shopId: S.shop?.id || null });
  } else if (c.name !== name) {
    c.name = name;
    await Store.saveCustomer(c);
  }
  S.me = c; S.role = 'customer';
  await Store.setSetting('session', { role: 'customer', id: c.id });
  await loadAll();
  enterCustomer();
}

async function doStaffLogin() {
  const u = document.getElementById('si-user').value.trim();
  const p = document.getElementById('si-pass').value.trim();
  const all = await DB.all('staff');
  const st = all.find(x => x.username === u && x.password === p && x.status === 'active');
  if (!st) return toast('账号或密码不对');
  S.me = st;
  S.role = st.role === 'manager' ? 'manager' : 'staff';
  await Store.setSetting('session', { role: S.role, id: st.id });
  await loadAll();
  if (S.role === 'manager') enterManager(); else enterStaff();
}

async function logout() {
  await Store.setSetting('session', null);
  S.me = null; S.role = null;
  go('sc-login');
}

function go(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

/* ---------------- 顾客端 ---------------- */
async function enterCustomer() {
  await loadAll();
  S.sel.serviceId = S.services[0]?.id || null;
  S.sel.dateTs = todayTs();
  S.sel.staffId = null;
  S.sel.slot = null;
  document.getElementById('bk-shop').textContent = S.shop?.name || '预约';
  await renderBook();
  go('sc-book');
}

function todayTs() { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }

async function renderBook() {
  // 服务
  document.getElementById('svc-chips').innerHTML = S.services.map(sv => `
    <div class="chip ${sv.id === S.sel.serviceId ? 'on' : ''}" onclick="pickService('${sv.id}')">
      ${esc(sv.name)}<span class="sub">${sv.durationMin} 分钟</span>
    </div>`).join('');

  // 日期（未来 7 天）
  const days = [];
  for (let i = 0; i < 7; i++) days.push(todayTs() + i * 86400000);
  const wd = ['日','一','二','三','四','五','六'];
  document.getElementById('date-row').innerHTML = days.map((d, i) => {
    const dt = new Date(d);
    const label = i === 0 ? '今天' : i === 1 ? '明天' : '周' + wd[dt.getDay()];
    return `<div class="date-item ${d === S.sel.dateTs ? 'on' : ''}" onclick="pickDate(${d})">
      <div class="d1">${label}</div>
      <div class="d2">${dt.getMonth()+1}/${dt.getDate()}</div>
    </div>`;
  }).join('');

  // 技师（受店铺开关控制）
  const pickable = S.shop?.allowCustomerPickStaff === true;
  const sec = document.getElementById('staff-sec');
  if (pickable) {
    sec.style.display = '';
    const svc = S.services.find(x => x.id === S.sel.serviceId);
    const cands = S.staff.filter(s => s.status === 'active' &&
      (!svc?.skill || (s.skills || []).includes(svc.skill)));
    document.getElementById('staff-chips').innerHTML =
      `<div class="chip ${!S.sel.staffId ? 'on' : ''}" onclick="pickStaff(null)">不指定</div>` +
      cands.map(s => `<div class="chip ${S.sel.staffId === s.id ? 'on' : ''}" onclick="pickStaff('${s.id}')">${esc(s.name)}</div>`).join('');
  } else {
    sec.style.display = 'none';
  }

  // 时段
  await renderSlots();
}

async function renderSlots() {
  const svc = S.services.find(x => x.id === S.sel.serviceId);
  const grid = document.getElementById('slot-grid');
  if (!svc) { grid.innerHTML = '<div class="empty">请先选服务</div>'; return; }

  const avail = dayAvailability({
    shop: S.shop, staff: S.staff, schedules: S.schedules,
    bookings: S.bookings, services: S.services,
    service: svc, dateTs: S.sel.dateTs, staffId: S.sel.staffId,
  });

  grid.innerHTML = avail.map(a => {
    const cls = ['slot'];
    if (!a.ok) cls.push('off');
    if (S.sel.slot === a.time) cls.push('on');
    return `<div class="${cls.join(' ')}" onclick="${a.ok ? `pickSlot('${a.time}')` : `toast('${a.reason || '不可约'}')`}">
      ${a.time}${a.ok ? `<span class="rem">剩${a.remaining}</span>` : `<span class="rem">${a.reason || '—'}</span>`}
    </div>`;
  }).join('');

  updateFooter();
}

function pickService(id) { S.sel.serviceId = id; S.sel.slot = null; S.sel.staffId = null; renderBook(); }
function pickDate(ts) { S.sel.dateTs = ts; S.sel.slot = null; renderBook(); }
function pickStaff(id) { S.sel.staffId = id; S.sel.slot = null; renderBook(); }
function pickSlot(t) { S.sel.slot = t; renderSlots(); }

function updateFooter() {
  const bar = document.getElementById('bk-footer');
  const svc = S.services.find(x => x.id === S.sel.serviceId);
  if (!S.sel.slot || !svc) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const d = new Date(S.sel.dateTs);
  document.getElementById('fb-info').innerHTML =
    `<b>${d.getMonth()+1}月${d.getDate()}日 ${S.sel.slot}</b><br>${esc(svc.name)} · ${svc.durationMin}分钟`;
}

async function confirmBooking() {
  const svc = S.services.find(x => x.id === S.sel.serviceId);
  if (!svc || !S.sel.slot) return;

  const r = canBookRange({
    shop: S.shop, staff: S.staff, schedules: S.schedules,
    bookings: S.bookings, services: S.services,
    service: svc, startSlot: S.sel.slot, dateTs: S.sel.dateTs, staffId: S.sel.staffId,
  });
  if (!r.ok) return toast(r.reason || '这个时段约不了');

  // 未指定技师且开关关闭 → 进入待分配
  const assignMode = S.sel.staffId ? 'customer_pick' : 'shop_assign';

  await Store.saveBooking({
    shopId: S.shop.id,
    customerId: S.me.id,
    customerName: S.me.name,
    customerPhone: S.me.phone,
    serviceId: svc.id,
    serviceName: svc.name,
    durationMin: svc.durationMin,
    staffId: S.sel.staffId || null,
    assignMode,
    startTime: S.sel.slot,
    dateKey: dateKey(S.sel.dateTs),
    status: 'confirmed',
  });

  await loadAll();
  S.sel.slot = null;
  toast('预约成功 ✓');
  await showMyBookings();
}

async function showMyBookings() {
  const list = await Store.bookingsOfCustomer(S.me.id);
  list.sort((a, b) => (a.dateKey + a.startTime).localeCompare(b.dateKey + b.startTime));
  const box = document.getElementById('mine-list');
  if (!list.length) {
    box.innerHTML = '<div class="empty"><span class="em">📅</span>还没有预约<br>回去选一个时间吧</div>';
  } else {
    box.innerHTML = list.map(b => {
      const st = S.staff.find(s => s.id === b.staffId);
      return `<div class="list-card">
        <div class="lc-top">
          <div class="lc-name">${esc(b.serviceName)}</div>
          <div class="lc-tag ${b.status === 'cancelled' ? 'cancel' : 'ok'}">${b.status === 'cancelled' ? '已取消' : '已预约'}</div>
        </div>
        <div class="lc-row"><span class="k">时间</span><span>${b.dateKey} ${b.startTime}（${b.durationMin}分钟）</span></div>
        <div class="lc-row"><span class="k">技师</span><span>${st ? esc(st.name) : '待店铺安排'}</span></div>
        ${b.status !== 'cancelled' ? `<div class="lc-actions">
          <button class="btn btn-ghost" onclick="cancelBooking('${b.id}')">取消预约</button>
        </div>` : ''}
      </div>`;
    }).join('');
  }
  go('sc-mine');
}

async function cancelBooking(id) {
  if (!confirm('确定取消这个预约吗？')) return;
  const b = await Store.booking(id);
  b.status = 'cancelled';
  b.cancelledAt = Date.now();
  await Store.saveBooking(b);
  await loadAll();
  toast('已取消');
  await showMyBookings();
}

/* ---------------- 员工端 ---------------- */
async function enterStaff() {
  await loadAll();
  document.getElementById('st-title').textContent = `${S.me.name} 的工作台`;
  staffTab('schedule');
  go('sc-staff');
}

function staffTab(t) {
  S.staffTab = t;
  document.querySelectorAll('#staff-tabs .tab').forEach(el =>
    el.classList.toggle('on', el.dataset.t === t));
  if (t === 'schedule') renderStaffSchedule();
  else renderStaffToday();
}

async function renderStaffSchedule() {
  const sch = (await Store.schedulesOf(S.me.id))[0] || null;
  const days = ['日','一','二','三','四','五','六'];
  const activeDays = sch?.weekdays || [1,2,3,4,5,6,0];
  const segs = sch?.segments || [{ start: '09:00', end: '18:00' }];

  document.getElementById('staff-body').innerHTML = `
    <div class="sec-h">我的工作时间</div>
    <div class="note-box" style="margin-bottom:18px">
      设置你每天能上班的时间段。客户预约时会按这个时间判断你有没有空。
    </div>

    <div class="sec-h" style="margin-top:20px">上班的日子</div>
    <div class="day-toggle" id="day-toggle">
      ${days.map((d, i) => `<div class="d ${activeDays.includes(i) ? 'on' : ''}" data-d="${i}">${d}</div>`).join('')}
    </div>

    <div class="sec-h">时间段（可多段，最小 30 分钟）</div>
    <div id="seg-list">
      ${segs.map((s, i) => `
        <div class="sch-row">
          <label>${i+1}</label>
          <input type="time" class="seg-start" value="${s.start}" step="1800">
          <span style="color:#8B9198">—</span>
          <input type="time" class="seg-end" value="${s.end}" step="1800">
          <button class="back" style="width:36px;height:36px;font-size:15px"
            onclick="removeSeg(${i})">✕</button>
        </div>`).join('')}
    </div>
    <button class="btn btn-ghost w100" style="margin-top:8px" onclick="addSeg()">+ 添加时间段</button>

    <button class="btn btn-primary w100 big" style="margin-top:24px" onclick="saveMySchedule()">保存工作时间</button>
  `;

  document.querySelectorAll('#day-toggle .d').forEach(el => {
    el.onclick = () => el.classList.toggle('on');
  });
}

function addSeg() {
  const list = document.getElementById('seg-list');
  const i = list.children.length;
  const div = document.createElement('div');
  div.className = 'sch-row';
  div.innerHTML = `<label>${i+1}</label>
    <input type="time" class="seg-start" value="13:00" step="1800">
    <span style="color:#8B9198">—</span>
    <input type="time" class="seg-end" value="18:00" step="1800">
    <button class="back" style="width:36px;height:36px;font-size:15px" onclick="removeSeg(${i})">✕</button>`;
  list.appendChild(div);
}

function removeSeg(i) {
  const list = document.getElementById('seg-list');
  if (list.children.length <= 1) return toast('至少保留一段');
  list.children[i].remove();
  // 重新编号
  Array.from(list.children).forEach((el, k) => {
    el.querySelector('label').textContent = k + 1;
  });
}

async function saveMySchedule() {
  const weekdays = Array.from(document.querySelectorAll('#day-toggle .d.on'))
    .map(el => parseInt(el.dataset.d));
  if (!weekdays.length) return toast('至少选一天');

  const segs = [];
  for (const row of document.querySelectorAll('#seg-list .sch-row')) {
    const a = row.querySelector('.seg-start').value;
    const b = row.querySelector('.seg-end').value;
    if (!a || !b) continue;
    if (toMin(b) - toMin(a) < 30) return toast('时间段至少要 30 分钟');
    segs.push({ start: a, end: b });
  }
  if (!segs.length) return toast('至少填一个时间段');

  const old = (await Store.schedulesOf(S.me.id))[0];
  await Store.saveSchedule({
    id: old?.id,
    staffId: S.me.id, shopId: S.me.shopId,
    weekdays, segments: segs,
  });
  await loadAll();
  toast('工作时间已保存 ✓');
}

async function renderStaffToday() {
  const dk = dateKey(Date.now());
  const mine = S.bookings.filter(b => b.staffId === S.me.id && b.dateKey === dk && b.status !== 'cancelled');
  mine.sort((a, b) => a.startTime.localeCompare(b.startTime));

  document.getElementById('staff-body').innerHTML = `
    <div class="stat-grid">
      <div class="stat-box"><div class="num">${mine.length}</div><div class="lbl">今日预约</div></div>
      <div class="stat-box"><div class="num">${mine.reduce((s, b) => s + b.durationMin, 0)}</div><div class="lbl">总分钟</div></div>
    </div>
    ${mine.length ? mine.map(b => `
      <div class="list-card">
        <div class="lc-top">
          <div class="lc-name">${b.startTime} ${esc(b.customerName || '客户')}</div>
          <div class="lc-tag ok">${b.durationMin}分钟</div>
        </div>
        <div class="lc-row"><span class="k">项目</span><span>${esc(b.serviceName)}</span></div>
      </div>`).join('')
      : '<div class="empty"><span class="em">☕</span>今天没有预约</div>'}
  `;
}

/* ---------------- 店长端 ---------------- */
async function enterManager() {
  await loadAll();
  document.getElementById('mg-title').textContent = `${S.me.name} · ${S.shop?.name || ''}`;
  mgTab('today');
  go('sc-manager');
}

function mgTab(t) {
  S.mgTab = t;
  document.querySelectorAll('#mg-tabs .tab').forEach(el =>
    el.classList.toggle('on', el.dataset.t === t));
  if (t === 'today') renderMgToday();
  if (t === 'book') renderMgBook();
  if (t === 'staff') renderMgStaff();
  if (t === 'shop') renderMgShop();
}

async function renderMgToday() {
  const dk = dateKey(Date.now());
  const today = S.bookings.filter(b => b.dateKey === dk && b.status !== 'cancelled')
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const pending = today.filter(b => !b.staffId);
  const onDuty = S.staff.filter(s => s.status === 'active').length;

  document.getElementById('mg-body').innerHTML = `
    <div class="stat-grid">
      <div class="stat-box"><div class="num">${today.length}</div><div class="lbl">今日预约</div></div>
      <div class="stat-box"><div class="num">${pending.length}</div><div class="lbl">待分配技师</div></div>
    </div>

    ${pending.length ? `<div class="warn-box" style="margin-bottom:18px">
      ⚠️ 有 ${pending.length} 单还没指定技师 —— 客户预约时没选人，需要你安排。
    </div>` : ''}

    <div class="sec-h">今日预约</div>
    ${today.length ? today.map(b => {
      const st = S.staff.find(s => s.id === b.staffId);
      return `<div class="list-card">
        <div class="lc-top">
          <div class="lc-name">${b.startTime} ${esc(b.customerName || '客户')}</div>
          <div class="lc-tag ${st ? 'ok' : 'wait'}">${st ? esc(st.name) : '待分配'}</div>
        </div>
        <div class="lc-row"><span class="k">项目</span><span>${esc(b.serviceName)} · ${b.durationMin}分钟</span></div>
        <div class="lc-row"><span class="k">电话</span><span>${esc(b.customerPhone || '—')}</span></div>
        <div class="lc-actions">
          <button class="btn btn-ghost" onclick="mgAssign('${b.id}')">${st ? '改派技师' : '分配技师'}</button>
          <button class="btn btn-danger" onclick="mgCancel('${b.id}')">取消</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty"><span class="em">📅</span>今天还没有预约</div>'}
  `;
}

async function mgAssign(id) {
  const b = await Store.booking(id);
  const svc = S.services.find(s => s.id === b.serviceId);
  const slot = { key: b.dateKey + 'T' + b.startTime, time: b.startTime, min: toMin(b.startTime) };
  const cands = S.staff.filter(s => s.status === 'active' &&
    (!svc?.skill || (s.skills || []).includes(svc.skill)));

  const rows = cands.map(s => {
    const busy = staffBusy(s.id, S.bookings.filter(x => x.id !== b.id), slot);
    const onDuty = staffOnDuty(s, S.schedules, slot, svc);
    const ok = !busy && onDuty;
    return `<div class="list-card" style="${ok ? '' : 'opacity:.5'}"
      onclick="${ok ? `doAssign('${b.id}','${s.id}')` : `toast('${!onDuty ? '不在岗' : '该时段已被占'}')`}">
      <div class="lc-top">
        <div class="lc-name">${esc(s.name)}</div>
        <div class="lc-tag ${ok ? 'ok' : 'cancel'}">${ok ? '可分配' : (!onDuty ? '不在岗' : '已被占')}</div>
      </div>
    </div>`;
  }).join('');

  openSheet(`<h3>给 ${esc(b.customerName || '客户')} 分配技师</h3>
    <div class="note-box" style="margin-bottom:14px">${b.startTime} · ${esc(b.serviceName)} · ${b.durationMin}分钟</div>
    ${rows || '<div class="empty">没有会做这个项目的员工</div>'}`);
}

async function doAssign(bid, sid) {
  const b = await Store.booking(bid);
  b.staffId = sid;
  b.assignMode = 'shop_assign';
  await Store.saveBooking(b);
  await loadAll();
  closeSheet();
  toast('已分配');
  mgTab('today');
}

async function mgCancel(id) {
  if (!confirm('确定取消这个预约吗？')) return;
  const b = await Store.booking(id);
  b.status = 'cancelled';
  await Store.saveBooking(b);
  await loadAll();
  toast('已取消');
  mgTab('today');
}

async function renderMgBook() {
  document.getElementById('mg-body').innerHTML = `
    <div class="note-box" style="margin-bottom:18px">
      店长代客预约：客户打电话/发微信来，你在这里帮他约上。
    </div>
    <button class="btn btn-primary w100 big" onclick="mgCreateBooking()">＋ 新建预约</button>

    <div class="sec-h" style="margin-top:28px">未来 7 天预约</div>
    ${(() => {
      const now = dateKey(Date.now());
      const list = S.bookings
        .filter(b => b.dateKey >= now && b.status !== 'cancelled')
        .sort((a, b) => (a.dateKey + a.startTime).localeCompare(b.dateKey + b.startTime));
      if (!list.length) return '<div class="empty">没有即将到来的预约</div>';
      return list.map(b => {
        const st = S.staff.find(s => s.id === b.staffId);
        return `<div class="list-card">
          <div class="lc-top">
            <div class="lc-name">${b.dateKey.slice(5)} ${b.startTime} ${esc(b.customerName || '')}</div>
            <div class="lc-tag ${st ? 'ok' : 'wait'}">${st ? esc(st.name) : '待分配'}</div>
          </div>
          <div class="lc-row"><span class="k">项目</span><span>${esc(b.serviceName)}</span></div>
        </div>`;
      }).join('');
    })()}
  `;
}

async function mgCreateBooking() {
  openSheet(`<h3>新建预约</h3>
    <label class="field"><span>客户姓名</span><input id="mb-name" placeholder="如：李姐"></label>
    <label class="field"><span>客户手机号</span><input id="mb-phone" type="tel" maxlength="11" placeholder="11位手机号"></label>
    <button class="btn btn-primary w100 big" onclick="mgCreateNext()">下一步：选时间</button>`);
}

async function mgCreateNext() {
  const name = document.getElementById('mb-name').value.trim();
  const phone = document.getElementById('mb-phone').value.trim();
  if (!name) return toast('请填姓名');
  if (!/^1\d{10}$/.test(phone)) return toast('手机号格式不对');

  let c = await Store.findCustomerByPhone(phone);
  if (!c) c = await Store.saveCustomer({ name, phone, shopId: S.shop.id });

  // 复用顾客端的选择界面，简化：直接给一个时段选择
  const svc = S.services[0];
  const ts = todayTs();
  const avail = dayAvailability({
    shop: S.shop, staff: S.staff, schedules: S.schedules,
    bookings: S.bookings, services: S.services, service: svc, dateTs: ts, staffId: null,
  }).filter(a => a.ok);

  if (!avail.length) return toast('今天已无空位，换个日期');

  openSheet(`<h3>选时间（${esc(c.name)}）</h3>
    <div class="note-box" style="margin-bottom:14px">项目：${esc(svc.name)} · ${svc.durationMin}分钟</div>
    <div class="slots">
      ${avail.map(a => `<div class="slot" onclick="mgDoCreate('${c.id}','${svc.id}','${a.time}',${ts})">
        ${a.time}<span class="rem">剩${a.remaining}</span>
      </div>`).join('')}
    </div>`);
}

async function mgDoCreate(cid, sid, time, ts) {
  const c = await Store.customer(cid);
  const svc = S.services.find(s => s.id === sid);
  const r = canBookRange({
    shop: S.shop, staff: S.staff, schedules: S.schedules,
    bookings: S.bookings, services: S.services,
    service: svc, startSlot: time, dateTs: ts, staffId: null,
  });
  if (!r.ok) { closeSheet(); return toast(r.reason || '约不了'); }

  await Store.saveBooking({
    shopId: S.shop.id, customerId: cid, customerName: c.name, customerPhone: c.phone,
    serviceId: svc.id, serviceName: svc.name, durationMin: svc.durationMin,
    staffId: null, assignMode: 'shop_assign',
    startTime: time, dateKey: dateKey(ts), status: 'confirmed',
    createdBy: S.me.id,
  });
  await loadAll();
  closeSheet();
  toast('已创建 ✓');
  mgTab('today');
}

async function renderMgStaff() {
  const rows = S.staff.map(s => {
    const sch = S.schedules.filter(x => x.staffId === s.id);
    const segTxt = sch.length
      ? (sch[0].segments || []).map(g => `${g.start}-${g.end}`).join(' / ')
      : '未设置';
    return `<div class="list-card">
      <div class="lc-top">
        <div class="lc-name">${esc(s.name)}</div>
        <div class="lc-tag ${s.role === 'manager' ? 'ok' : ''}">${s.role === 'manager' ? '店长' : '员工'}</div>
      </div>
      <div class="lc-row"><span class="k">技能</span><span>${(s.skills || []).join(' / ') || '未设置'}</span></div>
      <div class="lc-row"><span class="k">时间</span><span>${segTxt}</span></div>
    </div>`;
  }).join('');
  document.getElementById('mg-body').innerHTML = `
    <div class="note-box" style="margin-bottom:18px">
      员工的工作时间由员工自己在「员工端」设置；这里能看到每个人的情况。
    </div>
    ${rows}
  `;
}

async function renderMgShop() {
  const sh = S.shop;
  document.getElementById('mg-body').innerHTML = `
    <label class="field"><span>店铺名称</span>
      <input id="ms-name" value="${esc(sh.name)}"></label>
    <label class="field"><span>联系电话</span>
      <input id="ms-phone" type="tel" value="${esc(sh.phone || '')}"></label>
    <label class="field"><span>床位数（同时能服务几人）</span>
      <input id="ms-beds" type="number" min="1" value="${sh.bedCount || 1}"></label>

    <div class="switch-row">
      <div class="sr-txt">
        <b>允许客户指定技师</b>
        <span>关闭时客户不能选人，由店铺分配（默认关闭）</span>
      </div>
      <div class="sw ${sh.allowCustomerPickStaff ? 'on' : ''}" id="sw-pick" onclick="togglePickStaff()"></div>
    </div>

    <button class="btn btn-primary w100 big" style="margin-top:26px" onclick="saveShopSettings()">保存设置</button>

    <div class="sec-h" style="margin-top:32px">服务项目</div>
    ${S.services.map(sv => `<div class="list-card">
      <div class="lc-top">
        <div class="lc-name">${esc(sv.name)}</div>
        <div class="lc-tag">${sv.durationMin}分钟</div>
      </div>
      <div class="lc-row"><span class="k">技能</span><span>${esc(sv.skill || '通用')}</span></div>
    </div>`).join('')}
  `;
}

function togglePickStaff() {
  const el = document.getElementById('sw-pick');
  el.classList.toggle('on');
}

async function saveShopSettings() {
  const sh = await Store.shop(S.shop.id);
  sh.name = document.getElementById('ms-name').value.trim();
  sh.phone = document.getElementById('ms-phone').value.trim();
  sh.bedCount = Math.max(1, parseInt(document.getElementById('ms-beds').value) || 1);
  sh.allowCustomerPickStaff = document.getElementById('sw-pick').classList.contains('on');
  await Store.saveShop(sh);
  await loadAll();
  toast('已保存 ✓');
  mgTab('shop');
}

/* ---------------- 通用 UI ---------------- */
function openSheet(html) {
  document.getElementById('sheet-body').innerHTML = html;
  document.getElementById('mask').classList.add('on');
}
function closeSheet() {
  document.getElementById('mask').classList.remove('on');
  document.getElementById('sheet-body').innerHTML = '';
}

let _tmr;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(_tmr);
  _tmr = setTimeout(() => t.classList.remove('on'), 1800);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
