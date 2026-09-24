// detail が型（370字以内・3段落）を外れている問題の一覧を出す（2026年9月24日）。
// 使い方: node tools/over_limit.js
// 許可欄で通した問題は、note の「型の例外として通した（…）。理由: …」の最後の記録を理由として出す。
// 記録の無い問題は、道具に許可欄ができた2026年9月18日より前から型を外れていたもの（字数の例外として残すと決めたものを含む）。
// CLAUDE.md の「型を外れて許可した問題の一覧」はこの出力を写したもの。許可欄で通したら、この道具を流して一覧を直す。
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'questions.js'), 'utf8');
const { QUESTIONS: Q } = new Function(src + ';return {QUESTIONS};')();
const L = s => [...s.replace(/\n/g, '')].length;
const rows = [], none = [];
for (const q of Q) {
  const d = L(q.detail || ''), p = (q.detail || '').split(/\n\n/).length, note = (q.source && q.source.note) || '';
  if (!(d > 370 || p !== 3)) continue;
  const ex = [...note.matchAll(/型の例外として通した（([^）]*)）。理由: ([^。]*)/g)];
  if (!ex.length) { none.push(q.id + '（' + d + '字・' + p + '段落）'); continue; }
  rows.push('| ' + q.id + ' | ' + d + '字・' + p + '段落 | ' + ex[ex.length - 1][2].replace(/\s*refs に.*$/, '').replace(/\|/g, '／') + ' |');
}
console.log('**許可欄で通した問題（' + rows.length + '問）**\n\n| 問題 | いまの形 | 許可の理由（note の最後の許可の記録） |\n|---|---|---|\n' + rows.join('\n'));
console.log('\n**許可の記録が無い問題（' + none.length + '問。2026年9月18日より前から型を外れていたもの）：**' + none.join('・'));
