/* ==========================================================================
   发丝管家 · 原件（拍照上传 + 分享图生成）
   ========================================================================== */

/* ---------------- 1. 拍照上传 ---------------- */

/**
 * 调起手机相机/相册，返回压缩后的 Blob
 *
 * ⚠️ 两个真机踩过的坑：
 *  1) `input.style.display='none'` 在 iOS Safari / 微信内置浏览器里
 *     会被判为「非用户手势」→ 静默失败，什么都不弹。
 *     正确做法：页面里常驻一个 <input>，用 opacity:0.01 让它「可见但透明」。
 *  2) input 常驻复用 → `capture` 属性会残留！
 *     点过「用相机拍」之后，再点「从相册选」仍然会直接开相机。
 *     **每次调用都必须明确 set 或 removeAttribute('capture')。**
 */
function capturePhoto(opt = {}) {
  const maxSize = opt.maxSize || 1400;
  const quality = opt.quality || 0.86;
  const forceCamera = !!opt.forceCamera;

  return new Promise((resolve, reject) => {
    let input = document.getElementById('_camInput');
    if (!input) {
      input = document.createElement('input');
      input.id = '_camInput';
      input.type = 'file';
      input.accept = 'image/*';
      // 关键：不用 display:none，用「可见但透明」
      Object.assign(input.style, {
        position: 'fixed',
        left: '50%',
        bottom: '0',
        width: '1px',
        height: '1px',
        opacity: '0.01',
        zIndex: '9999',
        pointerEvents: 'none',
      });
      document.body.appendChild(input);
    }

    /* ⭐ 每次都重置 capture —— 消除上次调用残留
       这是关键：input 常驻复用，capture 属性不会自己消失。
       点过「用相机拍」之后再点「从相册选」，若不 removeAttribute
       手机上仍会直接开相机（或表现异常）。 */
    input.removeAttribute('capture');
    if (forceCamera) {
      input.setAttribute('capture', 'environment');
    }
    input.accept = 'image/*';

    let done = false;
    const handler = async () => {
      if (done) return;
      const file = input.files && input.files[0];
      if (!file) return;             // 用户取消
      done = true;
      cleanup();
      try {
        const blob = await compressImage(file, maxSize, quality);
        resolve(blob);
      } catch (e) { reject(e); }
    };
    const cleanup = () => {
      input.removeEventListener('change', handler);
      input.value = '';               // 允许重复选同一张
    };

    input.addEventListener('change', handler);
    input.click();
  });
}

/** 兜底：用户取消后重新可点（不需要额外处理，change 不触发即可） */

/** 压缩图片：等比缩放到最长边 maxSize，输出 jpeg Blob */
function compressImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
      else if (h >= w && h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }

      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      cv.toBlob(b => b ? resolve(b) : reject(new Error('压缩失败')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不了')); };
    img.src = url;
  });
}

/** Blob -> 可显示 URL（用完记得 revokeObjectURL） */
function blobURL(blob) { return URL.createObjectURL(blob); }

/** 读图片为 HTMLImageElement */
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('图加载失败'));
    i.src = src;
  });
}

/* ---------------- 2. 效果对比图生成 ---------------- */

/**
 * 合成「效果对比图」——左首图 + 右最新图 + 底部水印（店名 + 电话）
 * 返回 PNG Blob
 */
async function makeCompareImage(opt) {
  const {
    firstBlob, lastBlob, firstDate, lastDate,
    customerName, shopName, shopPhone, brand,
    text1, text2,
  } = opt;

  const W = 1080;                 // 输出宽度
  const HEAD = 150;               // 标题区
  const PHOTO_H = 1180;           // 照片区高
  const CAP_H = 90;               // 日期条
  const hasPhone = !!(shopPhone && String(shopPhone).trim());
  // 有电话时水印区高一档（多一行）
  const FOOT = hasPhone ? 220 : 160;
  const H = HEAD + PHOTO_H + CAP_H + FOOT;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  /* 背景 */
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  /* 顶部：店名 + 客户 + 进度 */
  ctx.fillStyle = '#1C1E26';
  ctx.textAlign = 'center';
  ctx.font = '600 44px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(`${customerName || ''} 的效果记录`, W / 2, 72);
  ctx.font = '400 30px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#8B9198';
  ctx.fillText('同一角度拍摄 · 真实记录', W / 2, 118);

  /* 照片区：左右并排 */
  const PAD = 36;
  const GAP = 24;
  const pw = (W - PAD * 2 - GAP) / 2;      // 单张宽
  const ph = PHOTO_H - PAD;                // 单张高
  const py = HEAD + 10;

  async function drawPhoto(blob, x, label, dateStr, accent) {
    // 白底 + 细边框
    ctx.save();
    roundRect(ctx, x, py, pw, ph, 24);
    ctx.fillStyle = '#F4F6F7';
    ctx.fill();
    ctx.strokeStyle = accent || '#E8EBED';
    ctx.lineWidth = accent ? 5 : 2;
    ctx.stroke();
    ctx.restore();

    if (blob) {
      try {
        const url = blobURL(blob);
        const img = await loadImg(url);
        ctx.save();
        roundRect(ctx, x, py, pw, ph, 24);
        ctx.clip();
        // contain 完整显示 —— 绝不裁掉照片内容（横拍/竖拍都不丢）
        const s = Math.min(pw / img.width, ph / img.height);
        const dw = img.width * s, dh = img.height * s;
        const dx = x + (pw - dw) / 2, dy = py + (ph - dh) / 2;
        // 两侧空白补浅灰底，避免突兀
        if (dw < pw - 1 || dh < ph - 1) {
          ctx.fillStyle = '#F4F6F7';
          ctx.fillRect(x, py, pw, ph);
        }
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
        URL.revokeObjectURL(url);
      } catch (e) { /* 画不了就留灰底 */ }
    } else {
      ctx.fillStyle = '#C9CDD1';
      ctx.font = '400 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无照片', x + pw / 2, py + ph / 2);
    }

    // 角标：首图/最新
    ctx.save();
    roundRect(ctx, x + 18, py + 18, 108, 54, 27);
    ctx.fillStyle = accent || '#8B9198';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 28px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 18 + 54, py + 18 + 28);
    ctx.restore();

    // 日期
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.fillStyle = accent || '#8B9198';
    ctx.font = '600 34px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(dateStr, x + pw / 2, py + ph + 58);
  }

  await drawPhoto(firstBlob, PAD, '首次', firstDate, null);
  await drawPhoto(lastBlob, PAD + pw + GAP, '最新', lastDate, brand || '#00A0B4');

  /* 中间箭头 */
  ctx.fillStyle = brand || '#00A0B4';
  ctx.font = '700 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('›', PAD + pw + GAP / 2, py + ph / 2);

  /* 底部水印区 */
  const fy = HEAD + PHOTO_H + CAP_H;
  ctx.fillStyle = '#F7FAFB';
  ctx.fillRect(0, fy, W, FOOT);

  ctx.textAlign = 'center';

  if (hasPhone) {
    // 店名
    ctx.fillStyle = '#00A0B4';
    ctx.font = '700 44px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(shopName || '', W / 2, fy + 66);

    // 电话（客户最需要的信息，用深色 + 图标强调）
    ctx.fillStyle = '#1C1E26';
    ctx.font = '700 42px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('☎ ' + String(shopPhone).trim(), W / 2, fy + 128);

    // 标语
    ctx.fillStyle = '#8B9198';
    ctx.font = '400 26px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('坚持护理，效果看得见', W / 2, fy + 182);
  } else {
    // 没填电话：保持原样，但提示补全
    ctx.fillStyle = '#00A0B4';
    ctx.font = '700 40px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(shopName || '', W / 2, fy + 66);

    ctx.fillStyle = '#8B9198';
    ctx.font = '400 26px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('坚持护理，效果看得见', W / 2, fy + 112);
  }

  /* 导出 */
  return new Promise((resolve) => {
    cv.toBlob(b => resolve(b), 'image/png');
  });
}

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------------- 3. 保存 / 分享 ---------------- */

/**
 * 保存图片到手机相册（或触发下载）
 */
function saveImage(blob, filename) {
  const url = blobURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || ('发丝管家_' + Date.now() + '.png');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * 分享图片：优先系统分享（微信里可直接发），不行就下载
 * 返回 'shared' | 'saved'
 */
async function shareImage(blob, filename, text) {
  const file = new File([blob], filename || 'effect.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: text || '' });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
      // 落到下载
    }
  }
  saveImage(blob, filename);
  return 'saved';
}

/* ---------------- 5. 环境诊断（手机上一点就知道卡在哪） ---------------- */
async function diagnoseCamera() {
  const ua = navigator.userAgent;
  const isWX = /MicroMessenger/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const https = location.protocol === 'https:';
  const hasFile = 'File' in window && 'FileReader' in window;
  const hasShare = !!(navigator.canShare);
  const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  const lines = [
    `系统：${isIOS ? 'iOS' : (isAndroid ? 'Android' : '电脑')}`,
    `浏览器：${isWX ? '微信内置' : '系统浏览器'}`,
    `协议：${location.protocol}${https ? ' ✓' : ' ✗（相机必须 HTTPS）'}`,
    `文件读取能力：${hasFile ? '有 ✓' : '无 ✗'}`,
    `系统分享能力：${hasShare ? '有 ✓' : '无（会改为下载）'}`,
    `摄像头 API：${hasMedia ? '有' : '无（用相册选择方式）'}`,
  ];
  return { isWX, isIOS, isAndroid, https, lines: lines.join('\n') };
}

/* ---------------- 4. 日期工具 ---------------- */
function fmtDate(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
function fmtShort(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate();
}
function daysBetween(a, b) {
  return Math.floor((b - a) / 86400000);
}
function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function uid(p) {
  return (p || 'x') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}
