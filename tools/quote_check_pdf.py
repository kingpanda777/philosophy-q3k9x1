# PDF の引用が原文にあるかを確かめる道具（2026年9月24日、フランクフルト学派の回で作った）。
# 使い方: python tools/quote_check_pdf.py list.json（形は tools/quote_check.js と同じ: [[URL, "引用の一部", ...], ...]）
# PDF は curl（既定の設定）で取り、tools/_sources/quote_cache/pdf/ に置く（gitignore 済み）。pdfminer.six で文字を抜き、空白を除いて比べる。
# 「テキスト抽出を許可しない」設定の PDF は【抽出不可の設定】と出して文字を抜かない（2026年9月24日の決め。使わない）。
import json,sys,re,hashlib,os,subprocess
from pdfminer.high_level import extract_text
from pdfminer.pdfparser import PDFParser
from pdfminer.pdfdocument import PDFDocument
C=os.path.join(os.path.dirname(os.path.abspath(__file__)),'_sources','quote_cache','pdf')+os.sep
os.makedirs(C,exist_ok=True)
def norm(s):return re.sub(r'\s+','',s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').replace('ﬁ','fi').replace('ﬂ','fl')).lower()
def extractable(p):
  try:
    with open(p,'rb') as fp: return PDFDocument(PDFParser(fp)).is_extractable
  except Exception: return True
bad=0
for url,*qs in json.load(open(sys.argv[1],encoding='utf-8')):
  f=C+hashlib.md5(url.encode()).hexdigest()
  if not os.path.exists(f+'.pdf'): subprocess.run(['curl','-sL','--max-time','90','-o',f+'.pdf',url])
  if not extractable(f+'.pdf'):
    print('【抽出不可の設定】'+url[:110]); bad+=len(qs); continue
  if not os.path.exists(f+'.txt'):
    try:t=extract_text(f+'.pdf')
    except Exception:t=''
    open(f+'.txt','w',encoding='utf-8').write(t)
  t=norm(open(f+'.txt',encoding='utf-8').read())
  print(('【取得できず】' if len(t)<2000 else '')+url[:110])
  for q in qs:
    ok=norm(q) in t
    if not ok: bad+=1
    print('  '+('○' if ok else '×')+' '+q[:80])
sys.exit(1 if bad else 0)
