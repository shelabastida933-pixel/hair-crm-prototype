/* ==========================================================================
   发丝管家 · 原件（拍照上传 + 分享图生成）
   ========================================================================== */

/* ---------------- 1. 拍照上传 ---------------- */

/**
 * 调起手机相机/相册，返回压缩后的 Blob
 * @param {Object} opt { maxSize: 最长边像素, quality: jpeg质量 }
 */
function capturePhoto(opt = {}) {
  const maxSize = opt.maxSize || 1400;
  const quality = opt.quality || 0.86;

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';   // 优先调后置相机（微信里也能调相册）
    input.style.display = 'none';
    document.body.appendChild(input);

    let done = false;
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.onchange = async () => {
      if (done) return;
      done = true;
      const file = input.files && input.files[0];
      cleanup();
      if (!file) return reject(new Error('cancel'));

      try {
        const blob = await compressImage(file, maxSize, quality);
        resolve(blob);
      } catch (e) {
        reject(e);
      }
    };

    // 用户取消（部分浏览器不触发 change，靠 focus 兜底不reject，只清理）
    window.addEventListener('focus', () => {
      setTimeout(() => { done = true; cleanup(); }, 1000);
    }, { once: true });

    input.click();
  });
}

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
 * 合成「效果对比图」——左首图 + 右最新图 + 底部水印
 * 返回 PNG Blob
 */
async function makeCompareImage(opt) {
  const {
    firstBlob, lastBlob, firstDate, lastDate,
    customerName, shopName, brand,
    text1, text2,
  } = opt;

  const W = 1080;                 // 输出宽度
  const HEAD = 150;               // 标题区
  const PHOTO_H = 1180;           // 照片区高
  const CAP_H = 90;               // 日期条
  const FOOT = 160;               // 底部水印区
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

  ctx.fillStyle = '#00A0B4';
  ctx.font = '700 40px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(shopName || '', W / 2, fy + 66);

  ctx.fillStyle = '#8B9198';
  ctx.font = '400 26px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('坚持护理，效果看得见', W / 2, fy + 112);

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
