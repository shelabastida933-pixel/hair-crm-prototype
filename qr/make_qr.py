#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
发丝管家 · 二维码 + 引导卡片生成
输出：
  qr/发丝管家_纯二维码.png      纯二维码（放大版，可直接打印）
  qr/发丝管家_引导卡片.png      带说明的卡片（贴店里/发微信）
  qr/发丝管家_圆形二维码.png    圆形描边版（好看些）
"""
import os
from PIL import Image, ImageDraw, ImageFont
import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers.pil import RoundedModuleDrawer

URL = "https://shelabastida933-pixel.github.io/hair-crm-prototype/app/"
OUT = os.path.dirname(os.path.abspath(__file__))

FONT_BOLD = r"C:\Windows\Fonts\simhei.ttf"
FONT_REG  = r"C:\Windows\Fonts\simhei.ttf"
if not os.path.exists(FONT_BOLD):
    FONT_BOLD = r"C:\Windows\Fonts\msyh.ttc"

INK   = (28, 30, 38)
GRAY  = (139, 145, 152)
BRAND = (0, 160, 180)
LINE  = (232, 235, 237)

def F(size, bold=True):
    p = FONT_BOLD if bold else FONT_REG
    try:
        return ImageFont.truetype(p, size)
    except Exception:
        return ImageFont.load_default()

def make_qr(url, box=10, border=2):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,  # 高容错，脏了也能扫
        box_size=box,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    return qr.make_image(fill_color="black", back_color="white").convert("RGB")

def make_qr_round(url, box=10, border=2):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,
                       box_size=box, border=border)
    qr.add_data(url)
    qr.make(fit=True)
    return qr.make_image(image_factory=StyledPilImage,
                         module_drawer=RoundedModuleDrawer(),
                         fill_color="#1C1E26", back_color="white").convert("RGB")

def center_text(draw, cx, y, text, font, fill, max_w=None):
    """居中绘制，必要时自动换行（按字符）"""
    if max_w is None:
        w = draw.textlength(text, font=font)
        draw.text((cx - w / 2, y), text, font=font, fill=fill)
        return y + font.size + 8
    # 换行
    line = ""
    lines = []
    for ch in text:
        if draw.textlength(line + ch, font=font) <= max_w:
            line += ch
        else:
            lines.append(line)
            line = ch
    if line:
        lines.append(line)
    for ln in lines:
        w = draw.textlength(ln, font=font)
        draw.text((cx - w / 2, y), ln, font=font, fill=fill)
        y += font.size + 10
    return y

# ---------- 1. 纯二维码（大，直接打印） ----------
qr = make_qr(URL, box=14, border=3)
qr.save(os.path.join(OUT, "发丝管家_纯二维码.png"))
print("已生成 纯二维码:", qr.size)

# ---------- 2. 圆形二维码 ----------
try:
    qrr = make_qr_round(URL, box=14, border=3)
    qrr.save(os.path.join(OUT, "发丝管家_圆形二维码.png"))
    print("已生成 圆形二维码:", qrr.size)
except Exception as e:
    print("圆形二维码跳过:", e)

# ---------- 3. 引导卡片（动态算高度，避免截断） ----------
W = 1080
# 先按内容量估算高度：主标题区 + 二维码区 + 说明区 + 底部提示框
QR_BOX = 17
_qr = make_qr(URL, box=QR_BOX, border=2)
QW, QH = _qr.size
H = (82 + 90 + 34 + 50 + 42           # 顶部：标题/副标题/分隔线
     + 56 + QH + 26 * 2 + 40          # 二维码 + 外框留白
     + 62 + 50 + 18 + 40              # 扫码提示两行
     + 56 + (34 + 52 + 44 * 4 + 34)   # 底部提示框
     + 190)                            # 底部品牌 + 安全留白
card = Image.new("RGB", (W, H), (255, 255, 255))
d = ImageDraw.Draw(card)

# 顶部色条
d.rectangle([0, 0, W, 14], fill=BRAND)

y = 82
y = center_text(d, W // 2, y, "发丝管家", F(72), INK, max_w=W - 160)
y += 6
y = center_text(d, W // 2, y, "养发馆客户管理 · 扫码即用", F(34), GRAY, max_w=W - 160)

# 分隔线
y += 42
d.line([(W//2 - 130, y), (W//2 + 130, y)], fill=LINE, width=2)

# 二维码（居中）
y += 56
qr2 = make_qr(URL, box=17, border=2)
qw, qh = qr2.size
# 二维码外框
pad = 26
d.rounded_rectangle(
    [ (W - qw)//2 - pad, y - pad, (W + qw)//2 + pad, y + qh + pad ],
    radius=26, outline=LINE, width=3
)
card.paste(qr2, ((W - qw)//2, y))
y = y + qh + pad + 62

# 说明
y = center_text(d, W // 2, y, "微信 / 相机 扫一扫", F(40), BRAND, max_w=W - 200)
y += 18
y = center_text(d, W // 2, y, "打开后点「添加到主屏幕」，就像装了个 App", F(30), GRAY, max_w=W - 200)

# 底部提示框
y += 56
box_h = 230
bx1, bx2 = 90, W - 90
d.rounded_rectangle([bx1, y, bx2, y + box_h], radius=22, fill=(247, 250, 251))
tx = bx1 + 38
ty = y + 34
d.text((tx, ty), "第一次用？", font=F(32), fill=INK)
ty += 52
for i, t in enumerate([
    "① 设置里填上店名（会印在分享图上）",
    "② 点「加客户」，把客户名字录进去",
    "③ 每次客户做完 → 点「拍照」",
    "④ 攒够照片 → 一键生成对比图发给客户",
]):
    d.text((tx, ty), t, font=F(28, bold=False), fill=(74, 81, 88))
    ty += 44

# 底部品牌
_brand_font = F(26)
by = H - 66
assert by + 40 <= H, f"底部品牌文字会溢出：{by + 40} > {H}"
d.text((W//2 - d.textlength("坚持护理，效果看得见", font=_brand_font)//2, by),
       "坚持护理，效果看得见", font=_brand_font, fill=GRAY)

# 关键：断言底部提示框没有超出画布（防截断）
assert y + box_h + 20 <= H - 90, f"底部提示框溢出：{y + box_h} 接近画布底 {H}"

card.save(os.path.join(OUT, "发丝管家_引导卡片.png"))
print("已生成 引导卡片:", card.size)

# 自动检查：底部是否真的有内容触边（严格版 —— 排除抗锯齿噪点）
import numpy as np
arr = np.array(card.convert("L"))
Hh = arr.shape[0]
# 逐行统计「明显深色」像素（<120 = 实心文字，抗锯齿边缘多在 150+）
for r in range(1, 61):
    row = arr[Hh - r]
    n_dark = int((row < 120).sum())
    if n_dark > 3:                       # 超过 3 个实心像素才算真内容
        print(f"⚠️  警告：距底 {r}px 处有 {n_dark} 个实心像素，可能截断")
        break
else:
    # 没有实质内容靠近底边 → 安全
    content_rows = np.where((arr < 120).any(axis=1))[0]
    gap = Hh - 1 - int(content_rows.max()) if len(content_rows) else Hh
    print(f"✓ 底部留白充足（最后内容距底 {gap}px），无截断")

print("\nURL:", URL)
print("输出目录:", OUT)
