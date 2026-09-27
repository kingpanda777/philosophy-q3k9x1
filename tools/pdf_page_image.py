# PDF の頁を画像にして、引用が誌面と合っているかを目で確かめる道具（2026年9月27日に作った）。
# 使い方: python tools/pdf_page_image.py <URL か PDF のパス> <PDF の頁番号（1始まり）> [上端 下端] [倍率]
#   上端・下端は頁の高さに対する割合（0〜1）。頁の一部を大きく見たいときに使う（例: 0.4 0.7）。倍率は既定 2.5。
#   URL は tools/quote_check_pdf.py と同じキャッシュ（tools/_sources/quote_cache/pdf/）を使い、無ければ curl（既定の設定）で取る。
#   画像は tools/_sources/page_images/ に書き出す（gitignore 済み）。書き出したパスを表示するので、Read ツールで開いて見る。
# 「テキスト抽出を許可しない」設定の PDF は画像にしない（quote_check_pdf.py と同じ扱い。CLAUDE.md「refs の書き方」）。
import sys, os, hashlib, subprocess
import pymupdf
from pdfminer.pdfparser import PDFParser
from pdfminer.pdfdocument import PDFDocument

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '_sources', 'quote_cache', 'pdf')
OUT = os.path.join(HERE, '_sources', 'page_images')
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

if len(sys.argv) < 3:
    print('使い方: python tools/pdf_page_image.py <URL か PDF のパス> <頁番号> [上端 下端] [倍率]')
    sys.exit(1)
src, page_no = sys.argv[1], int(sys.argv[2])
rest = [float(x) for x in sys.argv[3:]]
y0, y1 = (rest[0], rest[1]) if len(rest) >= 2 else (0.0, 1.0)
zoom = rest[2] if len(rest) >= 3 else (rest[0] if len(rest) == 1 else 2.5)

if src.startswith('http'):
    key = hashlib.md5(src.encode()).hexdigest()
    path = os.path.join(CACHE, key + '.pdf')
    if not os.path.exists(path):
        subprocess.run(['curl', '-sL', '--max-time', '90', '-o', path, src])
else:
    path = src
    key = hashlib.md5(os.path.abspath(src).encode()).hexdigest()

with open(path, 'rb') as fp:
    if not PDFDocument(PDFParser(fp)).is_extractable:
        print('【抽出不可の設定】画像にしない: ' + src)
        sys.exit(0)

doc = pymupdf.open(path)
if not 1 <= page_no <= doc.page_count:
    print(f'頁番号が範囲の外（この PDF は {doc.page_count} 頁）')
    sys.exit(1)
page = doc[page_no - 1]
r = page.rect
clip = pymupdf.Rect(r.x0, r.y0 + r.height * y0, r.x1, r.y0 + r.height * y1)
pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip)
name = f'{key[:12]}_p{page_no}_{int(y0 * 100)}-{int(y1 * 100)}.png'
out = os.path.join(OUT, name)
pix.save(out)
print(out)
