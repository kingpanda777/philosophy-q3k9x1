// note に「確認できていない点:」が残る問題の一覧を出す（2026年9月24日）。
// 使い方: node tools/unverified_list.js
// DONE は「学派ごとの典拠の回」を終えた棚。回を終えたらここに足す。
// SWEPT は、決まった形でない未確認の書き方を「確認できていない点:」に揃えた問題（2026年9月24日）。まだの棚でも一覧に載せる。
// CLAUDE.md の「典拠の回で残った未確認」はこの出力を写したもの。回を終えたら、この道具を流して一覧を直す（手で行を足さない）。
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'questions.js'), 'utf8');
const { QUESTIONS: Q, PHILOSOPHERS: PH } = new Function(src + ';return {QUESTIONS,PHILOSOPHERS};')();
const DONE = ['中世', '近世の認識論', '古代ギリシア', '分析哲学', '現象学と実存', 'フランクフルト学派', '現代の正義論'];
const SWEPT = ['q058', 'q137', 'q189', 'q339', 'q488', 'q495', 'q496', 'q580', 'q588', 'q182', 'q288', 'q328', 'q340', 'q373', 'q391', 'q402', 'q463', 'q478', 'q579', 'q625', 'q769', 'q792', 'q793', 'q804'];
const sch = {}; PH.forEach(p => sch[p.name] = p.school);
const items = n => [...n.matchAll(/確認できていない点: ([^。]*。?)/g)].map(m => m[1].replace(/\|/g, '／').slice(0, 110));
const row = q => '| ' + q.id + ' | ' + [...new Set((q.philosophers || []).map(n => sch[n]))].join('・') + (q.source.unverified !== undefined ? '（画面の unverified あり）' : '') + ' | ' + items(q.source.note || '').join(' ／ ') + ' |';
const done = [], swept = []; let rest = 0;
for (const q of Q) {
  if (!/確認できていない点:/.test((q.source && q.source.note) || '')) continue;
  const s = (q.philosophers || []).map(n => sch[n]);
  if (s.some(x => DONE.includes(x))) done.push(row(q));
  else if (SWEPT.includes(q.id)) swept.push(row(q));
  else rest++;
}
const H = '| 問題 | 棚 | 何が確かめられていないか（note の「確認できていない点:」） |\n|---|---|---|\n';
console.log('**典拠の回を終えた棚（' + DONE.join('・') + '）で残った未確認（' + done.length + '問）**\n\n' + H + done.join('\n'));
console.log('\n**典拠の回がまだの棚で、2026年9月24日に書き方を「確認できていない点:」に揃えた問題（' + swept.length + '問）**\n\n' + H + swept.join('\n'));
console.log('\n**典拠の回がまだの棚には、ほかに「確認できていない点:」の残る問題が' + rest + '問ある。**各棚の回で扱い、回を終えたら上の表に移る。');
