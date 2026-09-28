# PDF の作りを見分ける道具（2026年9月28日、引用の照らし直しの規模を測る点検で作った）。書き込みはしない。
# 使い方: 標準入力に PDF のパスの JSON 配列を渡すと、標準出力に {パス: 判定} の JSON を返す。
#   tools/quote_survey.js が呼ぶ。単独で使うときは:  echo ["a.pdf"] | python tools/pdf_kind.py
# 判定:
#   scanned  … 走査の PDF（頁のほぼ全面を1枚の画像が覆い、文字は文字認識の層）。最初の10頁のうち半分以上がそうなら true
#   columns  … 段組み（頁の左半分と右半分に、それぞれ3つ以上の文字の塊がある頁が、文字のある頁の半分以上）
#   vertical … 縦書き（文字の行の向きが縦のものが、行の半分以上）
#   extractable … 「テキスト抽出を許可しない」設定なら false。そのときは中身を見ず、ほかの判定は null
# 検出器の限界（先に書き出したもの）:
#   ・走査の頁を細かい画像に切って並べた PDF は、1枚で全面を覆わないので scanned にならない
#   ・生まれつき電子の PDF でも、表紙だけ画像の頁は数えるので、短い PDF（2〜3頁）は割合が振れる
#   ・段組みは文字の塊の位置で見るので、左右に図や注が並ぶ頁でも true になりうる
#   ・判定は PDF の作りであって、引用の文字が合っているかではない（それは頁の画像で目で見る）
import sys, json
import pymupdf
from pdfminer.pdfparser import PDFParser
from pdfminer.pdfdocument import PDFDocument
pymupdf.TOOLS.mupdf_display_errors(False)   # MuPDF の警告が標準出力に混ざると JSON が壊れるため
pymupdf.TOOLS.mupdf_display_warnings(False)

def extractable(p):
    try:
        with open(p, 'rb') as fp:
            return PDFDocument(PDFParser(fp)).is_extractable
    except Exception:
        return True

def kind(p):
    if not extractable(p):
        return {'extractable': False, 'scanned': None, 'columns': None, 'vertical': None, 'pages': None}
    try:
        doc = pymupdf.open(p)
    except Exception as e:
        return {'error': str(e)[:80]}
    n = min(len(doc), 10)
    scan = col = textpages = 0
    vert = lines = 0
    for i in range(n):
        pg = doc[i]
        area = pg.rect.width * pg.rect.height
        big = False
        for info in pg.get_image_info():
            b = pymupdf.Rect(info['bbox'])
            if b.width * b.height >= 0.7 * area:
                big = True
                break
        if big:
            scan += 1
        blocks = [b for b in pg.get_text('blocks') if b[6] == 0 and len(b[4].strip()) >= 20]
        if blocks:
            textpages += 1
            mid = pg.rect.width / 2
            w = pg.rect.width
            left = [b for b in blocks if b[2] <= mid + 0.02 * w and (b[2] - b[0]) < 0.55 * w]
            right = [b for b in blocks if b[0] >= mid - 0.02 * w and (b[2] - b[0]) < 0.55 * w]
            if len(left) >= 3 and len(right) >= 3:
                col += 1
        for bl in pg.get_text('dict')['blocks']:
            for ln in bl.get('lines', []):
                lines += 1
                dx, dy = ln['dir']
                if abs(dy) > abs(dx):
                    vert += 1
    return {'extractable': True, 'pages': len(doc),
            'scanned': n > 0 and scan * 2 >= n,
            'columns': textpages > 0 and col * 2 >= textpages,
            'vertical': lines > 0 and vert * 2 >= lines}

paths = json.load(sys.stdin)
out = {p: kind(p) for p in paths}
sys.stdout.write(json.dumps(out, ensure_ascii=False))
