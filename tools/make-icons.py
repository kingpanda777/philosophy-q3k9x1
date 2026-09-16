# -*- coding: utf-8 -*-
"""仮アイコン（PWA 用 PNG）を作る。
   icons/icon.svg と同じ図柄を、外部ライブラリなしで PNG に焼く。
   差し替えるときは icons/icon.svg を描き直し、このスクリプトの
   COLORS / 半径をそれに合わせてから、もう一度実行すればよい。
       python tools/make-icons.py
"""
import os, zlib, struct

BG     = (0x0D, 0x11, 0x17)   # --bg     背景
RING   = (0x4A, 0x8F, 0xD4)   # --accent 輪
DOT    = (0xC9, 0xA2, 0x27)   # --brass  中心の点

R_RING = 0.30    # 輪の半径（辺の長さに対する比）
W_RING = 0.055   # 輪の太さ
R_DOT  = 0.085   # 中心の点の半径

def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v

def mix(under, over, a):
    return tuple(int(round(u + (o - u) * a)) for u, o in zip(under, over))

def render(size):
    c  = size / 2.0
    rr = R_RING * size
    hw = W_RING * size / 2.0
    rd = R_DOT * size
    out = bytearray()
    for y in range(size):
        dy = y + 0.5 - c
        for x in range(size):
            dx = x + 0.5 - c
            d  = (dx * dx + dy * dy) ** 0.5
            px = BG
            # 輪。縁から 1px ぶんで濃度を落としてギザギザを消す
            px = mix(px, RING, clamp(hw - abs(d - rr) + 0.5))
            px = mix(px, DOT,  clamp(rd - d + 0.5))
            out += bytes(px) + b'\xff'
    return bytes(out)

def write_png(path, size):
    px  = render(size)
    raw = b''.join(b'\x00' + px[y * size * 4:(y + 1) * size * 4] for y in range(size))
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    print('%s  %dx%d  %d bytes' % (path, size, size, len(png)))

if __name__ == '__main__':
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
    write_png(os.path.join(here, 'icon-192.png'), 192)
    write_png(os.path.join(here, 'icon-512.png'), 512)
    write_png(os.path.join(here, 'apple-touch-icon.png'), 180)
