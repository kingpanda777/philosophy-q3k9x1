// 典拠の回をまだ終えていない棚の棚卸し（2026年9月24日、科学哲学の回のあとに tools/_work から移した）。書き込みはしない。
// 使い方:
//   node tools/remain_list.js            まだの棚すべてを1行ずつ（表の形）と、棚どうしが共有する比較問題の数
//   node tools/remain_list.js <棚の名前>  その棚の問題を1問1行で（refs の本数・未確認・型外れ・支えなし・逸話の保留・q001〜q050・済んだ棚と組むか）
// 「済んだ棚」は tools/unverified_list.js の DONE をそのまま読む（棚の一覧を2か所に持たないため）。回を終えたら DONE に足すだけでよい。
// 数え方：
//   支えなし … detail・explanation の文のうち、年・数字・直接の引用を含む文で、その年・数字・引用を refs にも note にも書いていないもの
//   逸話の保留 … 伝記の逸話の手がかり語（亡命・手紙・晩年など）を含むが、年も引用も無く機械では判定できない文
//   型外れ … detail が370字を超えるか、3段落でないもの（tools/over_limit.js と同じ）
//   回すもの … CLAUDE.md の「ほかの棚の回へ回すもの」の表で、その棚に割り振ってある問題
// 検出器の限界：支えなし・逸話の保留は文字列の手がかりで拾っているので、手がかりの無い文（後の時代への影響の文など）は拾えない。手順0は人の目で探す。
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(R, 'questions.js'), 'utf8');
const { QUESTIONS: Q, PHILOSOPHERS: PH, SCHOOLS } = new Function(src + ';return {QUESTIONS,PHILOSOPHERS,SCHOOLS};')();
const ul = fs.readFileSync(path.join(__dirname, 'unverified_list.js'), 'utf8').match(/const DONE = \[([^\]]*)\]/);
if (!ul) throw new Error('unverified_list.js の DONE が読めない');
const DONE = [...ul[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const so = {}; PH.forEach(p => so[p.name] = p.school);
const L = s => [...s.replace(/\n/g, '')].length;
const KN = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const kd = s => s.replace(/[〇一二三四五六七八九]{3,4}/g, m => m.split('').map(c => KN[c]).join(''));
const QUOTE_CUE = /」(と|という|との)(述べ|書|言|語|記|呼|断|宣|定式|一文|言葉|句)/;
const ANEC = /(亡命|逮捕|投獄|処刑|獄中|死の床|臨終|葬|手紙|書簡|辞職|解任|決闘|自殺|遺言|日記|墓|碑|焼き捨|燃や|持ち歩|神託|生涯|晩年|若い頃|若いころ|幼い|亡くな|死後|没後|師事|訪ね|逸話|エピソード)/;
function audit(q) {
  const refs = Array.isArray(q.source.refs) ? q.source.refs : null;
  const rt = kd((refs || []).join(' ')), nt = kd(q.source.note || '');
  const nashi = [], hold = [];
  for (const t of [q.detail || '', q.explanation || '']) for (const s of t.split(/(?<=。)|\n+/).map(x => x.trim()).filter(Boolean)) {
    const nums = (s.match(/(?<!約)前?[0-9]{3,4}(?=年(?!以上|後|前|の隔|にわた|ほど|あまり|間|余))|第[0-9]+(?=[節章巻条篇部問項])|[0-9]+(?=歳)|B[0-9]+|[0-9]{3,4}[a-e][0-9]*/g) || []).map(n => n.replace(/^第/, ''));
    const quotes = s.match(/「[^」]{6,}」/g) || [];
    const isQ = quotes.length > 0 && QUOTE_CUE.test(s), isA = ANEC.test(s);
    if (!nums.length && !isQ && !isA) continue;
    const nOK = nums.length ? nums.every(n => rt.includes(n.replace(/^前/, ''))) : null;
    const qOK = isQ ? quotes.every(x => rt.includes(x.slice(1, 9))) : null;
    const ch = [nOK, qOK].filter(v => v !== null);
    if (!ch.length) { hold.push(s); continue; }
    if (ch.every(Boolean)) continue;
    const n2 = nums.length ? nums.every(n => nt.includes(n.replace(/^前/, ''))) : true;
    const q2 = isQ ? quotes.every(x => nt.includes(x.slice(1, 9))) : true;
    if (!(n2 && q2)) nashi.push(s);
  }
  const d = q.detail || '';
  return { refsN: refs ? refs.length : -1, unv: /確認できていない点/.test(q.source.note || ''), unvS: q.source.unverified !== undefined,
    over: L(d) > 370 || d.split(/\n\n/).length !== 3, len: L(d), par: d.split(/\n\n/).length, nashi, hold };
}
const passOn = {};
const cm = fs.readFileSync(path.join(R, 'CLAUDE.md'), 'utf8');
const i0 = cm.indexOf('**ほかの棚の回へ回すもの');
const sec = i0 < 0 ? '' : cm.slice(i0, cm.indexOf('\n\n', cm.indexOf('\n|', i0) + 1) + 1 || undefined);
for (const line of sec.split('\n')) { const m = line.match(/^\| (q\d{3})[^|]*\| ([^|]+) \|/); if (m) (passOn[m[2].trim()] = passOn[m[2].trim()] || []).push(m[1] + (/（追加）/.test(line.split('|')[1]) ? '（追加）' : '')); }
const shelfQs = s => Q.filter(q => (q.philosophers || []).some(n => so[n] === s));
const row = q => ({ q, a: audit(q), early: +q.id.slice(1) <= 50, done: [...new Set((q.philosophers || []).map(n => so[n]))].filter(x => DONE.includes(x)) });
const arg = process.argv[2];
if (arg) {
  if (!SCHOOLS.includes(arg)) throw new Error('SCHOOLS に無い棚: ' + arg);
  const A = shelfQs(arg).map(row);
  console.log('■ ' + arg + '（' + A.length + '問）' + (DONE.includes(arg) ? '【典拠の回は済んでいる】' : ''));
  for (const { q, a, early, done } of A) console.log([q.id, (q.philosophers || []).join('・'), 'refs' + (a.refsN < 0 ? '(欄無)' : a.refsN), a.unv ? '未確認' + (a.unvS ? '(画面)' : '') : '', a.over ? '型外れ' + a.len + '字' + a.par + '段落' : '', early ? 'q001-050' : '', done.length ? '済:' + done.join('・') : '', a.nashi.length ? '支えなし' + a.nashi.length : '', a.hold.length ? '保留' + a.hold.length : ''].filter(Boolean).join(' '));
  const pass = passOn[arg] || [];
  console.log('回すもの: ' + (pass.join('・') || 'なし'));
  return;
}
console.log('| 棚 | 問（人） | q001〜050 | 済んだ棚と組む | refs 1本 | refs 欄なし | note 未確認 | 型外れ | 支えなし | 逸話の保留 | 回すもの |');
console.log('|---|---|---:|---:|---:|---:|---:|---|---:|---|---|');
const rem = SCHOOLS.filter(s => !DONE.includes(s));
for (const s of rem) {
  const A = shelfQs(s).map(row), ids = f => A.filter(f).map(x => x.q.id);
  const over = ids(x => x.a.over);
  console.log('| ' + [s, A.length + '（' + PH.filter(p => p.school === s).length + '人）', ids(x => x.early).length, ids(x => x.done.length).length,
    ids(x => x.a.refsN === 1).length, ids(x => x.a.refsN === -1).length, ids(x => x.a.unv).length, over.length + (over.length ? '（' + over.join('・') + '）' : ''),
    A.reduce((t, x) => t + x.a.nashi.length, 0), A.reduce((t, x) => t + x.a.hold.length, 0) + '文・' + ids(x => x.a.hold.length).length + '問', (passOn[s] || []).join('・') || 'なし'].join(' | ') + ' |');
}
const pair = {};
for (const q of Q) { const ss = [...new Set((q.philosophers || []).map(n => so[n]))].filter(x => rem.includes(x)); for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) { const k = [ss[i], ss[j]].sort().join('×'); pair[k] = (pair[k] || 0) + 1; } }
console.log('\n棚どうしが共有する比較問題: ' + Object.entries(pair).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' / '));
