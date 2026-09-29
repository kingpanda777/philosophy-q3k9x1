// 本文の括弧「」で人の言葉として引いた箇所の棚卸し（2026年9月28日、引用の照らし直しの回の規模を測る点検で作った）。書き込みはしない。
// 使い方:
//   node tools/quote_survey.js            棚ごとの表（1〜4の数え）
//   node tools/quote_survey.js --list     1か所1行の一覧（区分・照らしの状態つき）を足す
//   node tools/quote_survey.js --other    どの区分にも入らなかった括弧（目で決めるもの）を足す
//   node tools/quote_survey.js --pdf      PDF の refs を1本1行で足す
//   --out <出力先> で、道具自身がファイルに書く（リダイレクトは hooks で止まる）
//
// 何を測るか（一文）: 本文4フィールド（設問文・選択肢・explanation・detail）の括弧「」のうち、
//   前後の言い回しから「人の言葉として引いている」と読めるものを拾い、その文言が refs か note にあるか、
//   いつ書かれたか（照らし合わせの決まりの前か後か）を数える。
//
// 区分（上から順に当てる）:
//   書名   … 論文・講演・章・プラトーなどの題（前が「論文」「講演」「第3篇第11章」「』の」、後ろが「と題」「（1963年）」など）。
//            『』の中にある括弧もここ
//   語     … 語・訳語・原語を示す括弧（後ろが「という語」「と訳」、前が「原語は」、3字以下で引用の手がかりが無いもの）
//   呼び名 … 「〜と呼んだ」「〜と名づけた」。その人が付けた名（術語）で、CLAUDE.md の決まりでは括弧の対象外の側
//   引用   … 後ろ（句点まで）に「と述べ」「と書き」「と言う」「と語り」「と答え」「と定式化」「という言葉」「という一節」
//            「という主張」「の一節」「の言葉」などがあるもの。設問文の「Xの「…」という言葉／主張」「Xの「…」として」で、
//            中身が文の形（8字以上で、る・い・だ・か・ない などで終わる）のものも引用に入れる
//   その他 … どれにも当たらないもの（--other で出す。目で決める）
//   通り名 … 本人の言葉ではないと本文自身が書く、流通した言い回し（目で決めた表 JUDGE でだけ入る）
//   規則より先に、目で決めた表 JUDGE を見る（2026年9月28日に361か所を読んで決めた）。
//   2026年9月28日の時点で「その他」に残っているものは、読んで人の言葉の引用ではないと判断したもの
//   （地の文の言い換え・仮の発話・語の強調・問いの形の要約）。これより後に足された括弧は、読まれていない
//
// 何を測るかの補い: 引用の数は「括弧の数」で、同じ文言が同じ問題の2か所にあれば2と数える
// 照らしの状態（引用だけ）:
//   refs一致 … その文言（空白と句読点を除く）が refs の説明欄にある。その ref が「照らし合わせの決まり」（2026年9月24日）の
//              後に書かれたか（git blame の日付）で、後＝照らし済みとみなす／前＝照らしていない、に分ける
//   noteのみ … note にはあるが refs には無い
//   原語あり … refs にも note にも無いが、その問題の refs に外国語の引用（"…" “…” „…“ が15字以上）がある。
//              訳が語どおりかは目で見る
//   なし     … どこにも無い
//   あわせて、本文のその行が「括弧の決まり」（2026年9月27日、f5dcb77）の後に書かれたか・直されたかも見る
//
// 検出器の限界（数える前に書き出したもの）:
//   ・括弧を付けずに引いた引用（地の文の言い換えや、括弧なしの原文）は拾えない。この道具は括弧の中だけを見る
//   ・手がかり語が句点の先にある文（「〜」。これはXの言葉です）は、次の文を見ないので「その他」に落ちる
//   ・「と言う」は引用でない言い方（「〜と言うのと同じ」）にも当たる。数えすぎの側に振れる
//   ・blame の日付は、その行のどこかが最後に直された日で、括弧の箇所を直した日とは限らない。
//     explanation と detail は1行なので、後で別の文を直すと「後」に数えられる（照らし済みの側へ振れる）
//   ・refs一致は日本語の文字列の一致なので、外国語の原文から訳した引用は「原語あり」か「なし」に入る。
//     「原語あり」は問題単位の手がかりで、その原文がその括弧の原文かまでは見ていない
//   ・PDF の判定は tools/_sources/quote_cache/pdf/ にある（quote_check_pdf.py で一度取った）PDF だけ。取っていないものは不明
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
require('./_lib.js').outOption();
const R = path.join(__dirname, '..');
const LIST = process.argv.includes('--list'), OTHER = process.argv.includes('--other'), PDF = process.argv.includes('--pdf');
const src = fs.readFileSync(path.join(R, 'questions.js'), 'utf8');
const { QUESTIONS: Q, PHILOSOPHERS: PH, SCHOOLS } = new Function(src + ';return {QUESTIONS,PHILOSOPHERS,SCHOOLS};')();
const so = {}; PH.forEach(p => so[p.name] = p.school);
const shelves = q => [...new Set((q.philosophers || []).map(n => so[n]).filter(Boolean))];

// 決まりの日付（秒）
const CUT_QC = Date.parse('2026-09-24T08:00:00+09:00') / 1000;   // refs の引用を原文で照らし合わせてから書く（フランクフルト学派の回の初め）
const CUT_BR = Date.parse('2026-09-27T08:00:00+09:00') / 1000;   // 括弧の中は原文の文言そのまま（CLAUDE.md への記入は f5dcb77 だが、
                                                                  // 決まりを立てて照らしたのはラトゥールとハラウェイの承認の段〔24d0a33、08:31〕から）
const CUT_IMG = Date.parse('2026-09-27T09:18:59+09:00') / 1000;  // 走査の PDF は頁の画像で照らす（f24cca5）

// git blame（読むだけ）で行ごとの日付
const blame = cp.execSync('git blame --line-porcelain questions.js', { cwd: R, maxBuffer: 1 << 28 }).toString('utf8').split('\n');
const lineTime = []; let cur = 0;
for (const l of blame) {
  if (/^[0-9a-f]{40} \d+ \d+/.test(l)) cur = +l.split(' ')[2];
  else if (l.startsWith('committer-time ')) lineTime[cur] = +l.slice(15);
}
const lines = src.split('\n');
const qStart = {}; lines.forEach((l, i) => { const m = l.match(/^    id: "(q\d+)",/); if (m) qStart[m[1]] = i; });
const ids = Object.keys(qStart).sort((a, b) => qStart[a] - qStart[b]);
const qEnd = {}; ids.forEach((id, k) => qEnd[id] = k + 1 < ids.length ? qStart[ids[k + 1]] : lines.length);
// ある問題の範囲で、文字列 s を含む行の日付（1始まりの行番号で blame を引く）
function timeOf(id, s) {
  const probe = s.slice(0, 40);
  for (let i = qStart[id]; i < qEnd[id]; i++) if (lines[i].includes(probe)) return lineTime[i + 1] || 0;
  return 0;
}
const fieldLine = (id, key) => { for (let i = qStart[id]; i < qEnd[id]; i++) if (lines[i].startsWith('    ' + key + ':')) return lineTime[i + 1] || 0; return 0; };

const norm = s => s.replace(/[\s、。，．・「」『』（）()〔〕［］\[\]"“”'‘’―—…-]/g, '');
const QUOTE_A = /(と(述べ|書|言(い|っ|う|わ|明)|語(り|っ|る)|答え|定式|表現|定義|記し|宣言|断じ|論じ|付け加え|問い|問う)|という(言葉|一節|定式|主張|言い回し|言明|格率|標語|問い|形|定義|言い分|句|形です)|の一節|の言葉|の定式|として(広|伝)|がその主張|が伴いう)/;
const TITLE_B = /(論文|講演|講義|書評|対談|論考|序文|序説|序論|章|プラトー|断章|の詩|原題は|副題は?|論集|小説|報告|』の|[0-9]{4}年の)$/;
const TITLE_A = /^(と題|（[0-9]{4}|（『|として(発表|刊行|公刊)|は(公刊|刊行)|という副題)/;
const TERM_A = /^(という(語|訳語|訳|概念|連想|条件|規定)|の語|とは別語|と訳|を意味|の意味|は.{0,6}訳)/;
const TERM_B = /(原語は|訳語は|誤答の|邦題は)$/;
const NAME_A = /^.{0,4}(と(呼|名づ|名付|称)|の名で)/;
// 目で決めたもの（2026年9月28日）。手がかり語の規則では決まらない括弧を、前後を読んで区分した。キーは「id:フィールド:括弧の中身」。
// 通り名 … 本人の言葉ではないと本文自身が書いている、流通した言い回し（「自然に帰れ」「悪法も法なり」「正・反・合」）。
//          文言を原文と照らす対象ではないので、引用とは別に数える
// 新しい問題で規則が外れたら、ここに足す（規則を緩めて数えすぎるより、目で決めたものを残すほうを取る）
const JUDGE = {
  // 規則では「その他」に落ちるが、人の言葉として引いているもの
  'q006:D:我思う、ゆえに我あり': '引用', 'q011:D:窓がない': '引用', 'q016:D:自分の事件で裁判官になる': '引用',
  'q018:D:生命・自由・財産': '引用', 'q025:D:コペルニクスの最初の着想': '引用', 'q034:D:最大多数の最大幸福': '引用',
  'q048:E:それが何かは知らないが何か': '引用', 'q053:E:狐は多くのことを知るが、ハリネズミは大きなことを一つ知る': '引用',
  'q105:E:単に……のみ': '引用', 'q105:E:つねに同時に': '引用', 'q143:D:その単独者、わが読者': '引用',
  'q282:D:必要なしに複数性を立ててはならない': '引用', 'q477:E:ここで何が起きているのか': '引用',
  'q534:D:たとえ神が存在しないとしても': '引用', 'q671:Q:吟味されない生は生きるに値しない': '引用',
  'q806:Q:ふさわしい領分': '引用', 'q829:D:XなきX': '引用', 'q829:D:どちらでもない': '引用', 'q829:D:でもない、でもない': '引用',
  'q838:E:過去のものとして与えられている現在のもの': '引用', 'q841:D:私なしの物': '引用',
  'q855:E:可能的に生命をもつ自然の身体の形相としての実体': '引用', 'q870:D:罪ある人': '引用', 'q870:D:お前が悪いのだ': '引用',
  'q873:E:実体は主体である': '引用', 'q880:D:殺すなかれ': '引用', 'q880:D:殺した者は罰せられるべし': '引用',
  'q881:D:人が殺す': '引用', 'q881:D:銃が殺す': '引用', 'q887:E:動物であると同時に機械': '引用', 'q891:E:東洋を知ること': '引用',
  'q898:E:本質主義の還元不可能な契機を自ら意識して用いる': '引用',
  // 規則では「引用」に入るが、人の言葉として引いていないもの
  'q008:D:神即自然': '語', 'q013:D:なぜこの世界なのか': '語', 'q032:E:認識できない何かがある': '語',
  'q049:D:である': '語', 'q049:D:べきである': '語', 'q056:D:等しさそのもの': '語', 'q474:D:神秘化': '語', 'q574:E:私の': '語',
  'q320:Q:作者の死': '書名', 'q518:D:気晴らし': '書名', 'q587:D:国民性について': '書名', 'q899:E:サバルタンは語ることができるか': '書名',
  'q882:D:科学的事実の構築': '書名', 'q882:D:科学的事実の社会的構築': '書名',
  'q020:D:自然に帰れ': '通り名', 'q030:Q:正・反・合（テーゼ・アンチテーゼ・ジンテーゼ）': '通り名',
  'q210:C0:悪法も法なり': '通り名', 'q210:D:悪法も法なり': '通り名',
  // 規則では「その他」に落ちる、その人が付けた名
  'q363:D:閉じた不偏性': '呼び名', 'q363:D:開かれた不偏性': '呼び名', 'q395:D:第三の存在の類': '呼び名', 'q600:D:エロスの自己昇華': '呼び名',
  'q776:D:実践の哲学': '呼び名', 'q810:D:第二の自然': '呼び名', 'q841:D:大いなる外部': '呼び名', 'q885:C0:テレストリアル': '呼び名',
  'q885:E:テレストリアル': '呼び名', 'q886:E:どこからでもない視点': '呼び名', 'q553:E:無限の質的差異': '呼び名',
};
function classify(field, text, i, full, content, id) {
  const j = JUDGE[id + ':' + field + ':' + content];
  if (j) return j;
  return classifyRule(field, text, i, full, content);
}
function classifyRule(field, text, i, full, content) {
  const pre = text.slice(0, i);
  const inBook = (pre.match(/『/g) || []).length > (pre.match(/』/g) || []).length;
  let b = pre.slice(Math.max(pre.lastIndexOf('。'), pre.lastIndexOf('\n')) + 1);
  b = b.replace(/((や|と|、)?「[^」]*」)+(や|と|、)?$/, '');          // 直前に並んだ括弧を飛ばす
  b = b.slice(-30);
  let a = text.slice(i + full.length);
  a = a.replace(/^((や|と|、)?「[^」]*」)+/, '');                     // 直後に並んだ括弧を飛ばす
  const e = a.search(/[。\n]/); a = a.slice(0, e < 0 ? 60 : Math.min(e, 60));
  if (inBook || TITLE_B.test(b) || TITLE_A.test(a)) return '書名';
  if (TERM_A.test(a) || TERM_B.test(b)) return '語';
  if (NAME_A.test(a)) return '呼び名';
  if (QUOTE_A.test(a)) return '引用';
  if (field === 'Q' && /^(という|として)/.test(a)) {
    if ([...content].length >= 8 && /(る|い|だ|か|ない|なり|ある|も|た|う)$/.test(content)) return '引用';
    return '語';
  }
  if ([...content].length <= 3) return '語';
  return 'その他';
}

const foreignQ = /["“„][^"”“]{15,}["”“]/;
const rows = [];
for (const q of Q) {
  const refs = Array.isArray(q.source.refs) ? q.source.refs : [];
  const note = q.source.note || '';
  const F = [['Q', 'question', q.question], ...(q.choices || []).map((c, k) => ['C' + k, 'choices', c]), ['E', 'explanation', q.explanation || ''], ['D', 'detail', q.detail || '']];
  for (const [f, key, t] of F) for (const m of t.matchAll(/「([^」]*)」/g)) {
    const kind = classify(f, t, m.index, m[0], m[1], q.id);
    const r = { id: q.id, f, content: m[1], kind, shelves: shelves(q) };
    const bodyT = key === 'choices' ? timeOf(q.id, t) : fieldLine(q.id, key);
    r.afterBR = bodyT >= CUT_BR;
    if (kind === '引用') {
      const n = norm(m[1]);
      const hit = s => { const x = norm(s); return n.length <= 12 ? x.includes(n) : (x.includes(n) || (x.includes(n.slice(0, 10)) && x.includes(n.slice(-6)))); };
      const ref = refs.find(hit);
      if (ref) { r.state = 'refs一致'; r.afterQC = timeOf(q.id, ref) >= CUT_QC; }
      else if (hit(note)) r.state = 'noteのみ';
      else if (refs.some(x => foreignQ.test(x))) r.state = '原語あり';
      else r.state = 'なし';
    }
    rows.push(r);
  }
}

const seen = new Set(rows.map(r => r.id + ':' + r.f + ':' + r.content));
const stale = Object.keys(JUDGE).filter(k => !seen.has(k));
if (stale.length) console.log('△ 目で決めた表 JUDGE のうち、いまの本文に無いもの（本文が直された。表を見直す）: ' + stale.join(' ／ '));
// ---- 1・2 区分と棚 ----
const kinds = ['引用', '呼び名', '通り名', 'その他', '語', '書名'];
const cnt = (arr, f) => arr.filter(f).length;
console.log('■ 括弧「」の総数: ' + rows.length + ' か所（' + new Set(rows.map(r => r.id)).size + ' 問）');
console.log('  区分: ' + kinds.map(k => k + ' ' + cnt(rows, r => r.kind === k)).join(' ／ '));
const quotes = rows.filter(r => r.kind === '引用');
console.log('  引用の問題数: ' + new Set(quotes.map(r => r.id)).size + ' 問');
const st = ['refs一致', 'noteのみ', '原語あり', 'なし'];
console.log('\n■ 棚ごと（比較問題は関わる棚それぞれで数える。延べ）');
console.log('| 棚 | 引用 | 呼び名 | その他 | 引用のうち refs一致（決まりの後／前） | noteのみ | 原語あり | なし | 本文が括弧の決まりの後 |');
console.log('|---|---:|---:|---:|---|---:|---:|---:|---:|');
const tot = {};
for (const s of SCHOOLS) {
  const A = rows.filter(r => r.shelves.includes(s)), Qs = A.filter(r => r.kind === '引用');
  const ri = Qs.filter(r => r.state === 'refs一致');
  console.log('| ' + [s, Qs.length, cnt(A, r => r.kind === '呼び名'), cnt(A, r => r.kind === 'その他'),
    ri.length + '（' + cnt(ri, r => r.afterQC) + '／' + cnt(ri, r => !r.afterQC) + '）',
    cnt(Qs, r => r.state === 'noteのみ'), cnt(Qs, r => r.state === '原語あり'), cnt(Qs, r => r.state === 'なし'), cnt(Qs, r => r.afterBR)].join(' | ') + ' |');
}
const ri = quotes.filter(r => r.state === 'refs一致');
console.log('| **実数** | ' + [quotes.length, cnt(rows, r => r.kind === '呼び名'), cnt(rows, r => r.kind === 'その他'),
  ri.length + '（' + cnt(ri, r => r.afterQC) + '／' + cnt(ri, r => !r.afterQC) + '）',
  ...st.slice(1).map(x => cnt(quotes, r => r.state === x)), cnt(quotes, r => r.afterBR)].join(' | ') + ' |');

if (LIST) {
  console.log('\n■ 引用・呼び名の一覧');
  for (const r of rows.filter(r => r.kind === '引用' || r.kind === '呼び名'))
    console.log([r.id, r.f, r.kind, r.state ? r.state + (r.state === 'refs一致' ? (r.afterQC ? '(後)' : '(前)') : '') : '', r.afterBR ? '括弧の決まりの後' : '', r.shelves.join('・'), '「' + r.content + '」'].filter(Boolean).join(' '));
}
if (OTHER) {
  console.log('\n■ その他（目で決めるもの）');
  for (const r of rows.filter(r => r.kind === 'その他')) console.log(r.id + ' ' + r.f + ' 「' + r.content + '」');
}

// ---- 4 PDF の refs ----
const CACHE = path.join(__dirname, '_sources', 'quote_cache', 'pdf');
const IMG = fs.existsSync(path.join(__dirname, '_sources', 'page_images')) ? fs.readdirSync(path.join(__dirname, '_sources', 'page_images')) : [];
const pdfRefs = [];
// URL の書き方の違い（末尾の / の有無、J-STAGE は _article／_pdf と -char/ja の有無）を並べる。先頭はもとの URL
function urlVariants(u) {
  const b = u.replace(/\/$/, '');
  const v = [u, b, b + '/'];
  if (/jstage\.jst\.go\.jp\/article\/.*\/_(article|pdf)/.test(b)) {
    const p = b.replace('/_article', '/_pdf').replace(/\/-char\/ja$/, '');
    for (const x of [p, p + '/-char/ja']) v.push(x, x + '/');
  }
  return [...new Set(v)];
}
for (const q of Q) for (const ref of (Array.isArray(q.source.refs) ? q.source.refs : [])) {
  const url = (ref.match(/^https?:\/\/\S+/) || [''])[0];
  if (!url) continue;
  // J-STAGE は refs に論文の頁（_article）を書き、PDF は _article を _pdf に替えて取る（CLAUDE.md の J-STAGE の節）。
  // refs が _pdf の形で書かれていることもある（q657 の岡崎2009）。だから J-STAGE の URL は、_article／_pdf のどちらで
  // 書かれていても、_pdf の形（-char/ja の有無・末尾の / の有無）を全部試してキャッシュと頁の画像を探す（2026年9月29日に直した）
  const variants = urlVariants(url);
  const isJ = /jstage\.jst\.go\.jp\/article\/.*\/_(article|pdf)/.test(url);
  const keys = variants.map(v => crypto.createHash('md5').update(v).digest('hex'));
  const key = keys.find(k => fs.existsSync(path.join(CACHE, k + '.pdf'))) || keys[0];
  const cached = fs.existsSync(path.join(CACHE, key + '.pdf'));
  const looks = /\.pdf(\b|$|\?|#)|_pdf\b|\/pdf(\/|$)/i.test(url) || isJ;
  if (!cached && !looks) continue;
  const desc = ref.slice(url.length);
  pdfRefs.push({ id: q.id, url, key, cached, desc, shelves: shelves(q), quoted: /「[^」]{4,}」|["“„][^"”“]{10,}["”“]/.test(desc),
    imaged: IMG.some(f => keys.some(k => f.startsWith(k.slice(0, 12)))), t: timeOf(q.id, ref) });
}
const paths = [...new Set(pdfRefs.filter(p => p.cached).map(p => path.join(CACHE, p.key + '.pdf')))];
let kindOf = {};
if (paths.length) {
  const r = cp.spawnSync('python', [path.join(__dirname, 'pdf_kind.py')], { input: JSON.stringify(paths), maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error('pdf_kind.py が落ちた: ' + r.stderr.toString());
  const s = r.stdout.toString('utf8');
  kindOf = JSON.parse(s.slice(s.lastIndexOf('{"')  >= 0 ? s.indexOf('{"') : 0));   // 前に警告が混ざっても JSON から読む
}
for (const p of pdfRefs) p.k = p.cached ? kindOf[path.join(CACHE, p.key + '.pdf')] || {} : null;
// 同じ PDF を2通りの URL で引くことがあるので、取得済みのものは中身（ファイルのハッシュ）で1本に数える（2026年9月29日に直した）。
// 頁の画像も、同じ中身のどれかの URL で作ってあれば、その PDF は画像で照らしたとみなす
const hashOf = {};
for (const f of paths) hashOf[f] = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
for (const p of pdfRefs) p.doc = p.cached ? 'h:' + hashOf[path.join(CACHE, p.key + '.pdf')] : 'u:' + p.url;
const imagedDoc = new Set(pdfRefs.filter(p => p.imaged).map(p => p.doc));
for (const p of pdfRefs) p.imaged = imagedDoc.has(p.doc);
const risky =p => p.k && p.k.extractable !== false && (p.k.scanned || p.k.columns || p.k.vertical);
console.log('\n■ refs の PDF（1問1本で延べ。比較問題は関わる棚それぞれで数える）');
console.log('（PDF の refs には、J-STAGE の論文頁〔_article〕の refs も入れる。取得済みは quote_check_pdf.py で一度取ったもの）');
// 未取得の J-STAGE で、説明欄の刊行年が2009年以前のもの（CLAUDE.md：古い巻は走査のことが多い）を「走査の疑い」として数える
const oldJ = p => !p.cached && /jstage/.test(p.url) && (() => { const m = p.desc.match(/（(\d{4})年）/); return m && +m[1] <= 2009; })();
console.log('| 棚 | PDF の refs | うち説明欄に引用 | そのうち取得済み | 走査 | 段組み・縦書き（走査でない） | 抽出不可の設定 | 頁の画像で照らした | 走査か段組みで画像未照合 | 未取得で走査の疑い（J-STAGE・2009年以前） |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
const line4 = (lab, A) => {
  const B = A.filter(p => p.quoted), C = B.filter(p => p.cached);
  console.log('| ' + [lab, A.length, B.length, C.length, cnt(C, p => p.k.scanned), cnt(C, p => !p.k.scanned && (p.k.columns || p.k.vertical)),
    cnt(C, p => p.k.extractable === false), cnt(B, p => p.imaged), cnt(C, p => risky(p) && !p.imaged), cnt(B, oldJ)].join(' | ') + ' |');
};
for (const s of SCHOOLS) line4(s, pdfRefs.filter(p => p.shelves.includes(s)));
line4('**実数**', pdfRefs);
const u = [...new Map(pdfRefs.map(p => [p.doc, p])).values()];
console.log('  異なる PDF（取得済みは中身で、未取得は URL で数える）: ' + u.length + ' 本（取得済み ' + cnt(u, p => p.cached) + '・走査 ' + cnt(u, p => p.cached && p.k.scanned) + '・段組み／縦書き ' + cnt(u, p => p.cached && !p.k.scanned && (p.k.columns || p.k.vertical)) + '・頁の画像あり ' + cnt(u, p => p.imaged) + '）');
const restDocs = new Set(pdfRefs.filter(p => p.quoted && p.cached && risky(p) && !p.imaged).map(p => p.doc));
console.log('  説明欄に引用があり、走査か段組みで頁の画像が無い PDF（中身で数えて）: ' + restDocs.size + ' 本');
if (PDF) {
  console.log('\n■ PDF の refs の一覧');
  for (const p of pdfRefs) console.log([p.id, p.shelves.join('・'), p.quoted ? '引用あり' : '', p.cached ? (p.k.extractable === false ? '抽出不可' : [p.k.scanned ? '走査' : '', p.k.columns ? '段組み' : '', p.k.vertical ? '縦書き' : ''].filter(Boolean).join('・') || '電子') : '未取得', p.imaged ? '画像で照合' : '', p.url.slice(0, 100)].filter(Boolean).join(' '));
}
