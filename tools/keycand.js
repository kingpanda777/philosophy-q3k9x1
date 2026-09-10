/* ===========================================================
   鍵語タグ付けの候補出し
   -----------------------------------------------------------
   使い方:  node tools/keycand.js            … 由来ごとの件数
            node tools/keycand.js 1          … ①設問・選択肢由来の一覧
            node tools/keycand.js 2          … ②explanation 由来
            node tools/keycand.js 3          … ③detail 由来
            node tools/keycand.js 1 q001 q050 … id 範囲を絞る

   照合範囲は「広」（設問＋選択肢＋explanation＋detail）。
   採否の基準が detail を含むため、候補出しも detail を含める。
   由来ごとに分けるのは、①②と③で判断の基準が違うため。
     ①② … 主題か／四択の成立に直接関わるか
     ③   … 概念の中身が説明されているか／名前が出るだけか

   これは候補出しであって判定ではない。採否は目視で決める。
   =========================================================== */
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','questions.js'),'utf8');
const {QUESTIONS}=(new Function(src+'\nreturn {QUESTIONS};'))();
const kt=JSON.parse(fs.readFileSync(path.join(__dirname,'..','keyterms.json'),'utf8'));

const TERMS=[];
Object.entries(kt).forEach(([p,v])=>{ if(p==='_meta')return;
  (v['鍵語']||[]).forEach(t=>TERMS.push({ph:p, w:t['語'], atk:t['扱い']||'未設定'})); });

// 由来を決める：狭いほうから順に見て、最初に現れた場所を由来とする
function origin(q,w){
  if((q.question+q.choices.join('')).includes(w)) return 1;
  if(q.explanation.includes(w)) return 2;
  if(q.detail.includes(w)) return 3;
  return 0;
}
const rows=[];
QUESTIONS.forEach(q=>TERMS.forEach(t=>{
  const o=origin(q,t.w);
  if(o) rows.push({id:q.id, ph:t.ph, w:t.w, atk:t.atk, o,
                   self:q.philosophers.includes(t.ph)});
}));

const want=process.argv[2]?Number(process.argv[2]):null;
const lo=process.argv[3], hi=process.argv[4];
if(!want){
  console.log('照合範囲「広」の候補: '+rows.length+'件');
  [1,2,3].forEach(o=>{
    const g=rows.filter(r=>r.o===o);
    const qs=new Set(g.map(r=>r.id));
    console.log('  '+['','① 設問・選択肢由来','② explanation 由来','③ detail 由来'][o].padEnd(22)+
      String(g.length).padStart(5)+'件  '+String(qs.size).padStart(3)+'問  '+
      'うち出題者本人の語 '+g.filter(r=>r.self).length+'件');
  });
  const zero=QUESTIONS.filter(q=>!rows.some(r=>r.id===q.id)).map(q=>q.id);
  console.log('候補ゼロの問題: '+zero.length+'問  '+zero.join(', '));
  process.exit(0);
}
let g=rows.filter(r=>r.o===want);
if(lo) g=g.filter(r=>r.id>=lo&&(!hi||r.id<=hi));
const byQ={};g.forEach(r=>{(byQ[r.id]=byQ[r.id]||[]).push(r);});
const ids=Object.keys(byQ).sort();
console.log('由来'+want+' : '+g.length+'件 / '+ids.length+'問'+(lo?'（'+lo+'〜'+(hi||'')+'）':''));
ids.forEach(id=>{
  const q=QUESTIONS.find(x=>x.id===id);
  console.log('');
  console.log(id+' ['+q.philosophers.join('・')+'] '+q.question);
  byQ[id].forEach(r=>console.log('    '+(r.self?'●':'○')+' '+r.w+'（'+r.ph+'／'+r.atk+'）'));
});
