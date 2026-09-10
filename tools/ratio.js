/* ===========================================================
   選択肢の長さの測定
   -----------------------------------------------------------
   使い方:  node tools/ratio.js            … 全体の指標
            node tools/ratio.js --list A   … 分類 A の一覧
            node tools/ratio.js q058 q265  … 個別の問題

   CLAUDE.md「### 7. 選択肢の長さの均等化」に対応する。
   目標は比率1.3倍以下。最長率は指標にしない（反転を招くため）。
   =========================================================== */
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','questions.js'),'utf8');
const {QUESTIONS}=(new Function(src+'\nreturn {QUESTIONS};'))();
const L=s=>[...s].length;
const FRAGILE=['q007','q015','q030','q227','q234','q311','q325','q419','q456'];
const CONN=['であり、','であって、','ものであり、','ことであり、','とされ、','とされており、',
            'ており、','ているが、','であるが、','とともに、','うえで、','ため、','ことで、','ながら、'];

function measure(q){
  const lens=q.choices.map(L), c=lens[q.answer];
  const w=lens.filter((_,i)=>i!==q.answer);
  const wAvg=w.reduce((a,b)=>a+b,0)/3, wMax=Math.max(...w);
  const ans=q.choices[q.answer];
  let cut=null; CONN.forEach(m=>{const i=ans.lastIndexOf(m); if(i>0&&(!cut||i>cut.i)) cut={i,m,pre:L(ans.slice(0,i+m.length-1))};});
  const isRel=/関係(として|について|は|を)/.test(q.question)||/の関係/.test(q.question);
  const np=q.philosophers.length;
  const r={id:q.id,lens,c,wAvg,wMax,ratio:c/wAvg,
    gapAvg:c-wAvg,          // 誤答の平均との差
    gap2nd:c-wMax,          // 2番目に長い選択肢との差（突出の度合い）
    rank:1+lens.filter(x=>x>c).length,
    fragile:FRAGILE.includes(q.id),type:q.type,np,isRel,
    hasConn:!!cut,marker:cut?cut.m:null,trimRatio:cut?cut.pre/wAvg:null,
    ph:q.philosophers};
  r.cls = r.fragile ? 'F 対象外(fragile)'
    : r.ratio<1.5 ? '- 対象外(1.5倍未満)'
    : (r.isRel&&np===1) ? 'C'
    : (r.type==='compare'||np>=2) ? 'D'
    : (r.hasConn&&r.trimRatio<=1.3) ? 'A'
    : r.hasConn ? 'B' : 'E';
  return r;
}
const rows=QUESTIONS.map(measure);
const arg=process.argv.slice(2);

if(arg[0]==='--list'){
  const k=arg[1];
  const g=rows.filter(r=>r.cls===k).sort((a,b)=>a.id.localeCompare(b.id));
  console.log('分類 '+k+' : '+g.length+'問');
  g.forEach(r=>console.log('  '+r.id+'  '+r.ratio.toFixed(2)+'倍  差'+r.gapAvg.toFixed(1)+'字  2位差'+r.gap2nd+'字  ['+r.lens.join(',')+']  '+(r.marker||'')+'  '+r.ph.join('・')));
  process.exit(0);
}
if(arg.length){
  arg.forEach(id=>{const r=rows.find(x=>x.id===id);
    if(!r)return console.log(id+' : 見つからない');
    console.log(r.id+'  '+r.cls+'  比率'+r.ratio.toFixed(2)+'倍  平均差'+r.gapAvg.toFixed(1)+'字  2位差'+r.gap2nd+'字  ['+r.lens.join(',')+']');});
  process.exit(0);
}
const n=rows.length, P=x=>(100*x/n).toFixed(1)+'%';
const avg=f=>rows.reduce((s,r)=>s+f(r),0)/n;
console.log('=== 全体（'+n+'問） ===');
console.log('  正解の平均          : '+avg(r=>r.c).toFixed(1)+'字');
console.log('  誤答の平均          : '+avg(r=>r.wAvg).toFixed(1)+'字');
console.log('  比率の平均          : '+avg(r=>r.ratio).toFixed(2)+'倍');
console.log('  比率の中央値        : '+(()=>{const a=rows.map(r=>r.ratio).sort((x,y)=>x-y);return((a[(n>>1)-1]+a[n>>1])/2).toFixed(2);})()+'倍');
console.log('');
console.log('=== 目標指標 ===');
const g13=rows.filter(r=>r.ratio<=1.3).length;
console.log('  比率1.3倍以下       : '+g13+'問  '+P(g13)+'   ← 目標');
const g20=rows.filter(r=>r.gapAvg>=20).length;
console.log('  誤答平均より20字以上長い: '+g20+'問  '+P(g20));
const g10=rows.filter(r=>r.gap2nd>=10).length;
console.log('  2位より10字以上長い   : '+g10+'問  '+P(g10)+'   ← 突出の度合い');
console.log('');
console.log('  （参考）正解が最長    : '+rows.filter(r=>r.rank===1).length+'問  '+P(rows.filter(r=>r.rank===1).length));
console.log('');
console.log('=== 2位との差の分布 ===');
[[-99,0],[0,5],[5,10],[10,20],[20,30],[30,999]].forEach(([lo,hi])=>{
  const c=rows.filter(r=>r.gap2nd>=lo&&r.gap2nd<hi).length;
  console.log('  '+(lo<0?'0字未満（最長でない）':lo+'〜'+(hi===999?'':hi-1)+'字').padEnd(22)+String(c).padStart(3)+'問  '+P(c));});
console.log('');
console.log('=== 分類別 ===');
const b={};rows.forEach(r=>{(b[r.cls]=b[r.cls]||[]).push(r);});
Object.keys(b).sort().forEach(k=>{const g=b[k];
  console.log('  '+k.padEnd(20)+String(g.length).padStart(3)+'問  平均比率'+(g.reduce((s,x)=>s+x.ratio,0)/g.length).toFixed(2)+
    '倍  平均差'+(g.reduce((s,x)=>s+x.gapAvg,0)/g.length).toFixed(1)+'字  平均2位差'+(g.reduce((s,x)=>s+x.gap2nd,0)/g.length).toFixed(1)+'字');});
