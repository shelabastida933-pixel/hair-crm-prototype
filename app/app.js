/* ==========================================================================
   发丝管家 · 主逻辑
   ========================================================================== */

const S = { page: 'pg-home', custId: null, photos: [], cmpBlob: null, cmpName: '' };

/* ---------------- 启动 ---------------- */
window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  await openDB();
  // 首次使用：灌入演示数据（让老板娘一眼看懂）
  const inited = await Store.getSetting('seeded', false);
  if (!inited) await seedDemo();
  // 载入设置
  document.getElementById('setShop').value = await Store.getSetting('shop', '');
  const _ph = await Store.getSetting('phone', '');
  document.getElementById('setPhone').value = _ph;
  const _pw = document.getElementById('phoneWarn');
  if (_pw) _pw.style.display = _ph ? 'none' : 'block';
  await renderHome();
}

/** 首次演示数据 */
async function seedDemo() {
  const today = todayStart();
  const day = 86400000;
  const demo = [
    { name: '张姐', project: '白发转黑 · 疗程A', total: 12, done: 4, gap: 6, lastAt: today - 6 * day, note: '女儿下个月结婚，想拍好看点' },
    { name: '李姐', project: '白发转黑 · 疗程A', total: 12, done: 10, gap: 6, lastAt: today - 9 * day, note: '效果不错，可以推后续保养' },
    { name: '王姐', project: '体验课', total: 1, done: 1, gap: 3, lastAt: today - 3 * day, note: '8/29 到店体验，未成交' },
  ];
  for (const d of demo) await Store.saveCustomer(d);
  await Store.setSetting('seeded', true);
}

/* ---------------- 页面切换 ---------------- */
function go(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  S.page = id;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('on', t.dataset.pg === id);
  });
  if (id === 'pg-home') renderHome();
  if (id === 'pg-customers') renderCustomers();
  if (id === 'pg-settings') renderStats();
}
function back() { go(S.custId ? 'pg-customers' : 'pg-home'); }

/* ---------------- 待办算法 ---------------- */
/** 算出每个客户今天要不要联系、为什么 */
function todoOf(c) {
  const now = Date.now();
  const day = 86400000;
  const last = c.lastAt || c.createdAt || now;
  const since = Math.floor((now - last) / day);
  const gap = c.gap || 6;
  const remain = Math.max(0, (c.total || 12) - (c.done || 0));

  // 未成交的体验客
  if ((c.total || 12) <= 1) {
    if (since >= 2) return { level: 'b', tag: '待跟进', line: `体验后 ${since} 天没回复`, urgent: false, need: true };
    return null;
  }
  // 快结束
  if (remain <= 2 && remain > 0) {
    return { level: 'a', tag: '快结束', line: `疗程还剩 ${remain} 次`, urgent: false, need: true };
  }
  // 该来了
  if (since >= gap && remain > 0) {
    return { level: 'r', tag: '该来了', line: `该做第 ${(c.done || 0) + 1} 次护理了`, urgent: true, need: true, since };
  }
  return null;
}

/* ---------------- 首页 ---------------- */
async function renderHome() {
  const all = await Store.customers();
  const list = [];
  for (const c of all) {
    const t = todoOf(c);
    if (t) list.push({ c, t });
  }
  // 紧急的排前面
  const order = { r: 0, a: 1, b: 2 };
  list.sort((x, y) => order[x.t.level] - order[y.t.level]);

  const el = document.getElementById('todoCount');
  const box = document.getElementById('todoList');

  if (!list.length) {
    el.textContent = '今天都联系完了';
    box.innerHTML = `<div class="done-title"><span class="em">🎉</span>今天的联系都做完了<br>休息一下吧</div>`;
    return;
  }
  el.textContent = `要联系 ${list.length} 位`;

  box.innerHTML = list.map(({ c, t }) => {
    const last = c.lastAt ? fmtShort(c.lastAt) : '—';
    const sinceTxt = t.since ? ` ｜ 已隔 ${t.since} 天` : '';
    return `
    <div class="card ${t.urgent ? 'urgent' : ''}" id="card-${c.id}">
      <div class="card-top">
        <span class="dot ${t.level}"></span>
        <span class="cname" onclick="openDetail('${c.id}')">${esc(c.name)}</span>
        <span class="ctag ${t.level === 'r' ? 'r' : (t.level === 'a' ? 'a' : '')}">${t.tag}</span>
      </div>
      <div class="card-line" onclick="openDetail('${c.id}')">${esc(t.line)}</div>
      <div class="card-meta">上次 ${last}${sinceTxt}</div>
      <div class="btns">
        <button class="btn btn-primary" onclick="openMsg('${c.id}')">发消息</button>
        <button class="btn btn-ghost" onclick="openDetail('${c.id}')">看档案</button>
      </div>
    </div>`;
  }).join('');
}

/* ---------------- 客户列表 ---------------- */
async function renderCustomers() {
  const all = await Store.customers();
  const box = document.getElementById('custList');
  if (!all.length) {
    box.innerHTML = `<div class="empty"><span class="em">👥</span>还没有客户<br>点右上角「加客户」开始</div>`;
    return;
  }
  const items = [];
  for (const c of all) {
    const photos = await Store.photosOf(c.id);
    items.push(`
    <div class="card">
      <div class="card-top">
        <span class="cname" onclick="openDetail('${c.id}')">${esc(c.name)}</span>
        <span class="ctag">${c.done || 0}/${c.total || 12}</span>
      </div>
      <div class="card-meta">${esc(c.project || '')} ｜ ${photos.length} 张照片</div>
      <div class="btns">
        <button class="btn btn-ghost" onclick="openDetail('${c.id}')">打开档案</button>
        <button class="btn btn-primary" onclick="takePhotoFlow('${c.id}')">📷 拍照</button>
      </div>
    </div>`);
  }
  box.innerHTML = items.join('');
}

/* ---------------- 客户详情 ---------------- */
async function openDetail(id) {
  S.custId = id;
  const c = await Store.customer(id);
  if (!c) return toast('客户不存在');

  document.getElementById('dName').textContent = c.name;
  document.getElementById('dSub').textContent = c.project || '';

  const photos = await Store.photosOf(id);
  S.photos = photos;
  const remain = Math.max(0, (c.total || 12) - (c.done || 0));
  const pct = Math.round(((c.done || 0) / (c.total || 12)) * 100);
  const t = todoOf(c);

  const photoHTML = photos.length
    ? photos.map((p, i) => `
      <div class="ph has" onclick="viewPhoto(${i})">
        <img data-pid="${p.id}" alt="">
        <span class="d">${fmtShort(p.takenAt)}</span>
      </div>`).join('')
    : `<div class="empty-tip">还没有照片，点右边＋拍第一张</div>`;

  document.getElementById('dBody').innerHTML = `
    <div class="prog-wrap">
      <div class="prog-label"><span>疗程进度</span><span><b>${c.done || 0}</b> / ${c.total || 12} 次</span></div>
      <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
    </div>

    <div class="info-row"><span class="k">上次到店</span><span class="v">${c.lastAt ? fmtDate(c.lastAt) : '—'}</span></div>
    <div class="info-row"><span class="k">下次该来</span><span class="v ${t && t.level === 'r' ? 'hot' : ''}">${
      t && t.level === 'r' ? '今天' : (c.lastAt ? fmtDate(c.lastAt + (c.gap || 6) * 86400000) : '—')
    }</span></div>
    <div class="info-row"><span class="k">还剩</span><span class="v">${remain} 次</span></div>

    <div class="sec-title">效果记录 <span class="tip">点头看大图</span></div>
    <div class="photos">
      ${photoHTML}
      <div class="ph add" onclick="takePhotoFlow('${c.id}')">
        <span class="em">＋</span>
        <span class="d" style="background:none;color:#00A0B4;position:static;padding:2px">拍照</span>
      </div>
    </div>

    ${photos.length >= 2 ? `
    <button class="btn btn-primary w100 btn-big" style="margin-top:14px" onclick="openCompare()">
      📊 生成效果对比图，发给客户
    </button>` : `
    <div class="empty-tip" style="margin-top:12px">拍满 2 张照片后，就能生成对比图了</div>`}

    ${c.note ? `<div class="sec-title">上次聊到</div><div class="note">${esc(c.note)}</div>` : ''}

    <div class="sec-title">操作</div>
    <button class="btn btn-ghost w100" onclick="markArrived('${c.id}')">✓ 记录到店（已完成一次）</button>
  `;

  // 异步填图
  for (const p of photos) {
    const img = document.querySelector(`img[data-pid="${p.id}"]`);
    if (img) {
      const url = blobURL(p.blob);
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
    }
  }
  go('pg-detail');
}

/* ---------------- 拍照流程 ---------------- */
async function takePhotoFlow(custId) {
  const c = await Store.customer(custId);
  if (!c) return;
  await pickAndSave(custId);
}

/** 弹选择：拍照 or 相册 */
function pickAndSave(custId) {
  return new Promise((resolve) => {
    const isWX = /MicroMessenger/i.test(navigator.userAgent);
    const isHttps = location.protocol === 'https:';
    const mask = document.createElement('div');
    mask.className = 'sheet-mask on';
    mask.innerHTML = `
      <div class="sheet">
        <h3>添加照片</h3>
        <div class="hint">${isWX ? '微信里建议用「从相册选」，最稳' : '两种方式都可以'}</div>
        <button class="btn btn-primary w100 btn-big" id="_pk_cam">📷 用相机拍一张</button>
        <button class="btn btn-ghost w100 btn-big" style="margin-top:10px" id="_pk_alb">🖼 从相册选</button>
        <button class="btn btn-ghost w100" style="margin-top:10px" id="_pk_cancel">取消</button>
        ${isHttps ? '' : '<div class="warn-box" style="margin-top:14px">当前不是 HTTPS，相机可能打不开。请用「从相册选」，或换 https 地址打开。</div>'}
      </div>`;
    document.body.appendChild(mask);
    const close = () => { mask.remove(); resolve(); };
    mask.onclick = (e) => { if (e.target === mask) close(); };
    mask.querySelector('#_pk_cancel').onclick = close;

    mask.querySelector('#_pk_alb').onclick = async () => {
      mask.remove();
      await doCapture(custId, false);
      resolve();
    };
    mask.querySelector('#_pk_cam').onclick = async () => {
      mask.remove();
      await doCapture(custId, true);
      resolve();
    };
  });
}

async function doCapture(custId, forceCamera) {
  try {
    toast(forceCamera ? '正在打开相机…' : '正在打开相册…');
    const blob = await capturePhoto({ forceCamera });
    if (!blob) throw new Error('empty');
    await Store.addPhoto(custId, blob, '');
    toast('照片已保存 ✓');
    if (S.page === 'pg-detail') await openDetail(custId);
    else await renderCustomers();
  } catch (e) {
    // 明确报错，不静默
    alert('没能拿到照片。\n\n' +
      '可以试这几步：\n' +
      '1. 换「从相册选」再试一次\n' +
      '2. 如果是微信里打开的，点右上角「⋯」→「在浏览器打开」\n' +
      '3. 长按这个页面链接，用系统浏览器打开\n\n' +
      '错误信息：' + (e && e.message ? e.message : e));
  }
}

/* ---------------- 记录到店 ---------------- */
async function markArrived(id) {
  const c = await Store.customer(id);
  if (!c) return;
  c.done = Math.min((c.total || 12), (c.done || 0) + 1);
  c.lastAt = Date.now();
  await Store.saveCustomer(c);
  await Store.addContact(id, 'arrive', '到店完成一次护理');
  toast(`已记录，第 ${c.done} 次 ✓`);
  await openDetail(id);
}

/* ---------------- 看大图 ---------------- */
function viewPhoto(i) {
  const p = S.photos[i];
  if (!p) return;
  const url = blobURL(p.blob);
  const img = document.getElementById('viewerImg');
  img.src = url;
  document.getElementById('viewer').classList.add('on');
  document.getElementById('viewerShare').onclick = async (e) => {
    e.stopPropagation();
    await shareImage(p.blob, `照片_${fmtShort(p.takenAt)}.jpg`, '');
    toast('已分享');
  };
}
function closeViewer() {
  document.getElementById('viewer').classList.remove('on');
  document.getElementById('viewerImg').removeAttribute('src');
}

/* ---------------- 对比图 ---------------- */
async function openCompare() {
  const c = await Store.customer(S.custId);
  const photos = await Store.photosOf(S.custId);
  if (!c || photos.length < 2) return toast('至少要 2 张照片');

  const first = photos[0];
  const last = photos[photos.length - 1];
  const shop = await Store.getSetting('shop', '');
  const phone = await Store.getSetting('phone', '');

  // 同一天拍的：用「首次/第N次」代替重复日期
  const sameDay = new Date(first.takenAt).toDateString() === new Date(last.takenAt).toDateString();
  const firstLabel = sameDay ? `首次` : fmtDate(first.takenAt);
  const lastLabel = sameDay ? `第${photos.length}次` : fmtDate(last.takenAt);

  document.getElementById('cmpTitle').textContent = `效果对比 · ${c.name}`;
  document.getElementById('cmpHint').textContent =
    `${firstLabel} → ${lastLabel}`;
  const box = document.getElementById('cmpPreview');
  box.innerHTML = `<div class="cmp-loading">正在生成对比图…</div>`;
  document.getElementById('cmpMask').classList.add('on');

  try {
    const blob = await makeCompareImage({
      firstBlob: first.blob,
      lastBlob: last.blob,
      firstDate: firstLabel,
      lastDate: lastLabel,
      customerName: c.name,
      shopName: shop || '养发馆',
      shopPhone: phone || '',
      brand: '#00A0B4',
    });
    S.cmpBlob = blob;
    S.cmpName = `${c.name}_效果对比_${fmtShort(last.takenAt)}.png`;
    const url = blobURL(blob);
    box.innerHTML = `<img src="${url}" alt="">`;
  } catch (e) {
    box.innerHTML = `<div class="cmp-loading">生成失败，请重试</div>`;
  }
}
function closeCmp() {
  document.getElementById('cmpMask').classList.remove('on');
  document.getElementById('cmpPreview').innerHTML = '';
  S.cmpBlob = null;
}
async function doShareCmp() {
  if (!S.cmpBlob) return toast('还没生成好');
  const r = await shareImage(S.cmpBlob, S.cmpName, '');
  if (r === 'shared') toast('已分享 ✓');
  else if (r === 'saved') toast('已存到相册 ✓');
}
function doSaveCmp() {
  if (!S.cmpBlob) return toast('还没生成好');
  saveImage(S.cmpBlob, S.cmpName);
  toast('已存到相册 ✓');
}

/* ---------------- 发消息 ---------------- */
let msgCust = null;
async function openMsg(id) {
  const c = await Store.customer(id);
  if (!c) return;
  msgCust = c;
  const t = todoOf(c);
  const photos = await Store.photosOf(id);

  let text;
  if (t && t.level === 'r') {
    const lastTxt = c.lastAt ? fmtDate(c.lastAt) : '';
    text = `${c.name}好~ 您的疗程第 ${(c.done || 0) + 1} 次该安排啦，上一次是${lastTxt}做的，建议这几天来哦。您看明天下午方便吗？`;
  } else if (t && t.level === 'a') {
    const remain = (c.total || 12) - (c.done || 0);
    text = `${c.name}好~ 您的疗程还剩 ${remain} 次就做完了，效果一直挺好的，咱们把它坚持做完哈～`;
  } else if (t && t.level === 'b') {
    text = `${c.name}好~ 上次您来体验感觉怎么样呀？我这边有几个跟您情况差不多的对比图，您看看？`;
  } else {
    text = `${c.name}好~ 最近护理得怎么样？有空来店里我帮您看看～`;
  }

  document.getElementById('msgTitle').textContent = `发给 ${c.name}`;
  document.getElementById('msgBox').value = text;
  document.getElementById('msgMask').classList.add('on');
}
function closeMsg() { document.getElementById('msgMask').classList.remove('on'); msgCust = null; }
async function copyMsg() {
  const txt = document.getElementById('msgBox').value;
  try {
    await navigator.clipboard.writeText(txt);
    toast('文案已复制 ✓');
  } catch (e) {
    const ta = document.getElementById('msgBox');
    ta.select(); document.execCommand('copy');
    toast('文案已复制 ✓');
  }
}
async function sendMsg() {
  if (!msgCust) return;
  await Store.addContact(msgCust.id, 'msg', document.getElementById('msgBox').value);
  const id = msgCust.id;
  closeMsg();
  toast('已标记已联系 ✓');
  const card = document.getElementById('card-' + id);
  if (card) card.classList.add('done');
  setTimeout(renderHome, 500);
}

/* ---------------- 编辑客户 ---------------- */
let editId = null;
async function newCustomer() {
  editId = null;
  document.getElementById('editTitle').textContent = '加客户';
  ['fName', 'fProj', 'fNote'].forEach(k => document.getElementById(k).value = '');
  document.getElementById('fTotal').value = 12;
  document.getElementById('fDone').value = 0;
  document.getElementById('fGap').value = 6;
  document.getElementById('fLast').value = new Date().toISOString().slice(0, 10);
  document.getElementById('editMask').classList.add('on');
}
async function editCustomer() {
  const c = await Store.customer(S.custId);
  if (!c) return;
  editId = c.id;
  document.getElementById('editTitle').textContent = '编辑客户';
  document.getElementById('fName').value = c.name || '';
  document.getElementById('fProj').value = c.project || '';
  document.getElementById('fTotal').value = c.total || 12;
  document.getElementById('fDone').value = c.done || 0;
  document.getElementById('fGap').value = c.gap || 6;
  document.getElementById('fLast').value = c.lastAt ? new Date(c.lastAt).toISOString().slice(0, 10) : '';
  document.getElementById('fNote').value = c.note || '';
  document.getElementById('editMask').classList.add('on');
}
function closeEdit() { document.getElementById('editMask').classList.remove('on'); }
async function saveEdit() {
  const name = document.getElementById('fName').value.trim();
  if (!name) return toast('请填姓名');
  const lastStr = document.getElementById('fLast').value;
  const obj = {
    name,
    project: document.getElementById('fProj').value.trim(),
    total: Math.max(1, parseInt(document.getElementById('fTotal').value) || 12),
    done: Math.max(0, parseInt(document.getElementById('fDone').value) || 0),
    gap: Math.max(1, parseInt(document.getElementById('fGap').value) || 6),
    lastAt: lastStr ? new Date(lastStr + 'T10:00:00').getTime() : Date.now(),
    note: document.getElementById('fNote').value.trim(),
  };
  if (editId) { obj.id = editId; const old = await Store.customer(editId); obj.createdAt = old.createdAt; }
  await Store.saveCustomer(obj);
  closeEdit();
  toast('已保存 ✓');
  if (S.page === 'pg-detail' && editId) await openDetail(editId);
  else if (S.page === 'pg-customers') await renderCustomers();
  else await renderHome();
}

/* ---------------- 设置 ---------------- */
async function renderStats() {
  const [c, p] = await Promise.all([DB.all('customers'), DB.all('photos')]);
  let bytes = 0;
  for (const x of p) bytes += (x.blob && x.blob.size) || 0;
  document.getElementById('statBox').innerHTML =
    `客户 <b>${c.length}</b> 位<br>照片 <b>${p.length}</b> 张<br>占用 <b>${(bytes / 1048576).toFixed(1)}</b> MB`;
}
async function saveShop(v) { await Store.setSetting('shop', v.trim()); }
async function savePhone(v) {
  await Store.setSetting('phone', v.trim());
  const w = document.getElementById('phoneWarn');
  if (w) w.style.display = v.trim() ? 'none' : 'block';
}

/** 设置页：环境自检 —— 人话版，给 40-55 岁的人看 */
async function runDiag() {
  const d = await diagnoseCamera();
  const box = document.getElementById('diagBox');

  // 结论先行：一句话说清能不能用
  let head, advice;
  if (!d.https) {
    head = '❌ 拍照可能打不开';
    advice = '这个页面的打开方式不支持调相机。\n\n' +
             '怎么办：\n' +
             '① 先用「从相册选」——这个一定能用\n' +
             '② 或者找我要个 https 的地址';
  } else if (d.isWX && d.isIOS) {
    head = '⚠️ 在微信里，相机可能被限制';
    advice = '怎么办（按顺序试）：\n' +
             '① 优先用「从相册选」\n' +
             '② 点微信右上角 ⋯ → 「在浏览器打开」\n' +
             '③ 在浏览器里就能正常调相机了';
  } else if (d.isWX) {
    head = '⚠️ 在微信里建议用「从相册选」';
    advice = '相机被拦的话：\n' +
             '点右上角 ⋯ → 「在浏览器打开」';
  } else if (!d.isIOS && !d.isAndroid) {
    head = '💻 你现在在电脑上';
    advice = '电脑上不会真开相机，会弹文件选择器。\n要在手机上试。';
  } else {
    head = '✅ 环境正常，可以用相机';
    advice = '点「试拍一张」验证一下。';
  }

  // 技术细节折叠起来，不吓人
  box.innerHTML = `<b style="font-size:17px">${head}</b>\n\n${advice}\n\n` +
    `<details style="margin-top:10px"><summary style="color:#8B9198;font-size:14px;cursor:pointer">查看详细信息</summary>` +
    `<div style="color:#8B9198;font-size:14px;margin-top:8px;white-space:pre-line">${d.lines}</div></details>`;
}

/** 设置页：试拍（不写库） */
async function testShoot() {
  try {
    const blob = await capturePhoto({ forceCamera: false });
    document.getElementById('diagBox').textContent =
      `✅ 成功拿到照片！\n尺寸：${(blob.size / 1024).toFixed(0)} KB\n\n说明这条路是通的。`;
  } catch (e) {
    document.getElementById('diagBox').textContent =
      `❌ 没拿到照片\n错误：${e && e.message ? e.message : e}\n\n` +
      `换「从相册选」再试，或用系统浏览器打开。`;
  }
}

async function exportData() {
  try {
    const data = await Store.exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    saveImage(blob, `发丝管家备份_${new Date().toISOString().slice(0, 10)}.json`);
    toast('备份已导出 ✓');
  } catch (e) { toast('导出失败'); }
}
async function importData(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  try {
    const txt = await f.text();
    await Store.importAll(JSON.parse(txt));
    toast('导入完成 ✓');
    input.value = '';
    await renderStats();
  } catch (e) { toast('导入失败：文件不对'); }
}
async function clearAll() {
  if (!confirm('确定清空全部数据吗？这一步不能撤销。')) return;
  await Store.clearAll();
  await Store.setSetting('seeded', true);
  toast('已清空');
  await renderStats();
  await renderHome();
}

/* ---------------- 工具 ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
let tmr;
function toast(txt) {
  const t = document.getElementById('toast');
  t.textContent = txt; t.classList.add('on');
  clearTimeout(tmr);
  tmr = setTimeout(() => t.classList.remove('on'), 1600);
}
