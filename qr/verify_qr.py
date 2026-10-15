#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证生成的二维码能否扫出正确网址（多条件：原图/缩放/压缩/低对比模拟）"""
import os
from PIL import Image
from pyzbar.pyzbar import decode

OUT = os.path.dirname(os.path.abspath(__file__))
EXPECT = "https://shelabastida933-pixel.github.io/hair-crm-prototype/app/"

files = [
    "发丝管家_纯二维码.png",
    "发丝管家_圆形二维码.png",
    "发丝管家_引导卡片.png",
]

ok = True
for f in files:
    p = os.path.join(OUT, f)
    if not os.path.exists(p):
        print(f"FAIL  缺文件 {f}")
        ok = False
        continue

    img = Image.open(p)
    results = decode(img)

    # 卡片里二维码是嵌在整张图上的，需要能识别出来
    if not results:
        # 试放大再解（有些解码器对小模块不友好）
        big = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
        results = decode(big)

    if results:
        got = results[0].data.decode("utf-8")
        match = got == EXPECT
        print(f"{'PASS' if match else 'FAIL'}  {f:28s} -> {got}")
        if not match:
            ok = False
    else:
        print(f"FAIL  {f:28s} -> 扫不出来")
        ok = False

# 额外：模拟真实使用条件
p = os.path.join(OUT, "发丝管家_纯二维码.png")
img = Image.open(p)
tests = []

# 1) 缩小到 200px（小尺寸打印/屏幕显示）
small = img.resize((200, 200), Image.LANCZOS)
tests.append(("缩小到200px", decode(small)))

# 2) 转灰度 + JPEG 压缩（照片拍摄场景）
import io
buf = io.BytesIO()
img.convert("L").save(buf, "JPEG", quality=60)
jpg = Image.open(buf)
tests.append(("灰度+JPEG60", decode(jpg)))

# 3) 轻微旋转（拍摄倾斜 5 度）
rot = img.rotate(5, expand=True, fillcolor="white")
tests.append(("倾斜5度", decode(rot)))

for name, res in tests:
    if res:
        got = res[0].data.decode("utf-8")
        m = got == EXPECT
        print(f"{'PASS' if m else 'FAIL'}  抗性测试 {name:14s} -> {'内容正确' if m else got}")
        if not m:
            ok = False
    else:
        print(f"FAIL  抗性测试 {name:14s} -> 扫不出来")
        ok = False

print()
print("RESULT:", "ALL PASS" if ok else "HAS FAILURES")
