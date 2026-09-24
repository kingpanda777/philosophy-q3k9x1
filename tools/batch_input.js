// add_batch.js への入力（JSON）を組み立てる部品（2026年9月24日、フランクフルト学派の回で tools/_work の *_lib.js から移した）。
// 書き込みはしない。JSON を tools/_work/ に書き出すだけ。
//   const B = require('../batch_input.js')('（〇〇の回、2026年9月24日）');   // 引数は note に書く印
//   B.edit(...); B.add(...); B.out['作問'].push({...}); B.out['鍵語'] = { 作問由来: {...} }; B.save('xxx.json');
//
// 【直したこと（2026年9月24日）】save は、中身の無い欄を消すときに「.length が無い」ことで判定していたので、
// 配列でない欄（「鍵語」「台帳」のようなオブジェクト）を中身があっても消していた。フランクフルト学派の回で、
// 鍵語の登録が入力から消え、check_keys（台帳に無い語）で止まって見つかった。いまは「空の配列」と「キーの無いオブジェクト」だけを消す。
// 書き出したあと、入力に渡した欄が1つも欠けていないかを確かめ、欠けていれば止める。
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const WORK = path.join(R, 'tools', '_work');
module.exports = function (MARK) {
  const src = fs.readFileSync(path.join(R, 'questions.js'), 'utf8');
  const { QUESTIONS: Q } = new Function(src + ';return {QUESTIONS};')();
  const G = id => { const q = Q.find(x => x.id === id); if (!q) throw new Error('無い: ' + id); return q; };
  function once(hay, needle, label) {
    const n = hay.split(needle).length - 1;
    if (n !== 1) throw new Error(label + ': ' + n + '回当たる: ' + needle.slice(0, 40));
    return needle;
  }
  const out = { 作問: [], 追記: [], 'keys除去': [], 'refs追加': [], 'refs除去': [], 'refs置換': [], 'note置換': [], 'unverified除去': [] };
  const app = (id, field, find, replace, note) => {
    once(G(id)[field], find, id + ' ' + field);
    const x = { id, find, replace, note_add: ' ' + note, keys_add: [] };
    if (field !== 'detail') x['対象'] = field;  // explanation か question（2026-09-25 に question を足した）
    out['追記'].push(x);
  };
  const edit = (id, field, pairs, note, 許可) => {
    const whole = G(id)[field]; let nw = whole;
    for (const [a, b] of pairs) { once(nw, a, id + ' ' + field); nw = nw.replace(a, () => b); }
    const x = { id, find: whole, replace: nw, note_add: ' ' + note, keys_add: [] };
    if (field !== 'detail') x['対象'] = field;  // explanation か question（2026-09-25 に question を足した）
    if (許可) x['許可'] = 許可;
    out['追記'].push(x);
  };
  const kdel = (id, 語, 理由) => out['keys除去'].push({ id, 語, 理由 });
  const add = (id, arr, why) => out['refs追加'].push({ id, 新: arr, 理由: why });
  const rep = (id, 含む, 新, 理由) => {
    const hits = (G(id).source.refs || []).filter(r => r.includes(含む));
    if (hits.length !== 1) throw new Error(id + ' refs置換: ' + hits.length + '本当たる: ' + 含む);
    out['refs置換'].push({ id, 含む, 新, 理由 });
  };
  const del = (id, 含む, 理由) => out['refs除去'].push({ id, 含む: [含む], 理由 });
  const nrep = (id, 含む, 新, 理由) => { once(G(id).source.note, 含む, id + ' note'); out['note置換'].push({ id, 含む, 新, 理由 }); };
  const noteTail = (id, text, 理由) => { const t = G(id).source.note.slice(-40); nrep(id, t, t + ' ' + text, 理由); };
  const unv = (id, 理由) => out['unverified除去'].push({ id, 理由 });
  const isEmpty = v => v == null || (Array.isArray(v) ? v.length === 0 : (typeof v === 'object' ? Object.keys(v).length === 0 : false));
  const size = v => Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 1);
  const save = name => {
    // 同じ問題への2件目以降の追記は、2本目の入力（名前に b を付ける）へ回す
    const seen = new Set(), later = [];
    out['追記'] = out['追記'].filter(x => { if (seen.has(x.id)) { later.push(x); return false; } seen.add(x.id); return true; });
    if (later.length) {
      const nm2 = name.replace('.json', 'b.json');
      fs.writeFileSync(path.join(WORK, nm2), JSON.stringify({ 追記: later }, null, 1) + '\n');
      console.log('書き出した', nm2, '追記' + later.length, later.map(x => x.id).join(' '));
    }
    const keep = Object.keys(out).filter(k => !isEmpty(out[k]));
    const o = {}; for (const k of keep) o[k] = out[k];
    const f = path.join(WORK, name);
    fs.writeFileSync(f, JSON.stringify(o, null, 1) + '\n');
    // 書き出した欄と、中身のあった欄が一致するかを確かめる（欄が黙って消えるのを止める）
    const back = JSON.parse(fs.readFileSync(f, 'utf8'));
    const lost = keep.filter(k => !(k in back));
    if (lost.length) throw new Error('書き出した入力から欄が消えた: ' + lost.join('・'));
    console.log('書き出した', name, keep.map(k => k + size(o[k])).join(' '));
  };
  return { G, MARK, once, app, edit, kdel, add, rep, del, nrep, noteTail, unv, save, out };
};
