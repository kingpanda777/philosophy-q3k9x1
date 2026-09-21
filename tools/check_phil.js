/* ===========================================================
   哲学者紹介（⑧）の整合の点検

   使い方:  node tools/check_phil.js
            （通れば終了コード0、どれか落ちれば1）

   PHIL_INTRO が持つのは name・yomi・place・intro・works・checked だけである。
   生没年と学派は questions.js の PHILOSOPHERS 側にしか無く、表示のときに引く。
   二か所で持たない決まりなので、突き合わせではなく引く先があるかを見る。
   =========================================================== */

"use strict";
const fs = require("fs");
const path = require("path");
/* 字数の数え方・JSON の読み書き・紹介文の基準値は tools/_lib.js から読む。
   add_person.js（登録の前の検査）が同じ基準値を読む。2026-09-21 に切り出した。 */
const { L, readJson, PHIL, matchYears } = require("./_lib.js");
const R = path.join(__dirname, "..");
const src = f => fs.readFileSync(path.join(R, f), "utf8");

const { QUESTIONS, PHILOSOPHERS } =
  new Function(src("questions.js") + ";return {QUESTIONS,PHILOSOPHERS};")();
const { PHIL_INTRO } = new Function(src("philosophers.js") + ";return {PHIL_INTRO};")();
const html = src("index.html");

let bad = 0;
const ok = (cond, label, detail) => {
  console.log((cond ? "  ○ " : "  ✗ ") + label + (detail ? "  " + detail : ""));
  if (!cond) bad++;
};
const base = {};
PHILOSOPHERS.forEach(p => { base[p.name] = p; });

console.log("\n===== 1. 名前が questions.js の PHILOSOPHERS にあるか =====\n");
const noName = PHIL_INTRO.filter(p => !base[p.name]).map(p => p.name);
ok(noName.length === 0, `${PHIL_INTRO.length}人すべての name が一覧側にある`, noName.join("、"));
const dup = PHIL_INTRO.map(p => p.name).filter((n, i, a) => a.indexOf(n) !== i);
ok(dup.length === 0, `name の重複がない`, dup.join("、"));

console.log("\n===== 2. 二か所で持っていないか =====\n");
const dupField = PHIL_INTRO.filter(p => "years" in p || "school" in p).map(p => p.name);
ok(dupField.length === 0, `years と school を紹介側に持っていない`, dupField.join("、"));
const noBase = PHIL_INTRO.filter(p => base[p.name] && (!base[p.name].years || !base[p.name].school))
  .map(p => p.name);
ok(noBase.length === 0, `引く先（PHILOSOPHERS）に years と school がある`, noBase.join("、"));

console.log("\n===== 3. 型を守っているか =====\n");
const noYomi = PHIL_INTRO.filter(p => !p.yomi || !PHIL.YOMI_RE.test(p.yomi)).map(p => p.name);
ok(noYomi.length === 0, `yomi がひらがなで入っている`, noYomi.join("、"));
const noPlace = PHIL_INTRO.filter(p => !p.place || /\s/.test(p.place)).map(p => p.name);
ok(noPlace.length === 0, `place が1語で入っている`, noPlace.join("、"));
const lenBad = PHIL_INTRO.filter(p => L(p.intro) < PHIL.INTRO_MIN || L(p.intro) > PHIL.INTRO_MAX)
  .map(p => `${p.name}(${L(p.intro)}字)`);
ok(lenBad.length === 0, `intro が${PHIL.INTRO_MIN}〜${PHIL.INTRO_MAX}字に収まっている`, lenBad.join("、"));
const wBad = PHIL_INTRO.filter(p => !Array.isArray(p.works) || p.works.length > 3).map(p => p.name);
ok(wBad.length === 0, `works が3冊以内`, wBad.join("、"));
const wOrder = PHIL_INTRO.filter(p => {
  const ys = (p.works || []).filter(w => w.year).map(w => w.year);
  return ys.some((y, i) => i && y < ys[i - 1]);
}).map(p => p.name);
ok(wOrder.length === 0, `works が年代順`, wOrder.join("、"));
/* 根拠になる問題が1問しかない人は、書ける中身がそもそも少ない。下限を緩める（_lib.js） */
const thMin = p => PHIL.thoughtMin(p.thought_src);
const thLen = PHIL_INTRO.filter(p => !p.thought || L(p.thought) < thMin(p) || L(p.thought) > PHIL.THOUGHT_MAX)
  .map(p => `${p.name}(${p.thought ? L(p.thought) + "字／下限" + thMin(p) : "なし"})`);
ok(thLen.length === 0, `thought が字数の範囲に収まっている（上限${PHIL.THOUGHT_MAX}、下限${PHIL.THOUGHT_MIN}。根拠が1問なら${PHIL.THOUGHT_MIN_1SRC}）`,
   thLen.join("、"));

console.log("\n===== 4. intro と thought に評価語が混ざっていないか =====\n");
/* 事実だけを書く決まり。ここに挙げた語が出たら書き直す。
   一覧は _lib.js にある（add_person.js が登録の前に同じ一覧で見る）。
   「卓越」を外した理由も、そちらに書いてある */
const NG = PHIL.NG;
const ngHit = [];
PHIL_INTRO.forEach(p => NG.forEach(w => {
  if (p.intro.includes(w)) ngHit.push(`${p.name}:intro:${w}`);
  if (p.thought && p.thought.includes(w)) ngHit.push(`${p.name}:thought:${w}`);
}));
ok(ngHit.length === 0, `評価語が入っていない`, ngHit.join("、"));

/* thought は「その人の問題に書いてあることの範囲で書く」決まり。
   根拠にした id を thought_src に残す。ここでは id が実在し、
   かつその人物の問題であることだけを見る（中身の当否は人が読む） */
const srcBad = [];
PHIL_INTRO.forEach(p => {
  if (!Array.isArray(p.thought_src) || !p.thought_src.length) {
    srcBad.push(`${p.name}(なし)`); return;
  }
  p.thought_src.forEach(id => {
    const q = QUESTIONS.find(x => x.id === id);
    if (!q) srcBad.push(`${p.name}:${id}(そんな問題はない)`);
    else if (!q.philosophers.includes(p.name)) srcBad.push(`${p.name}:${id}(別人の問題)`);
  });
});
ok(srcBad.length === 0, `thought_src がその人の問題を指している`, srcBad.join("、"));

console.log("\n===== 5. 照合済みか／入口が出るか =====\n");
const unchecked = PHIL_INTRO.filter(p => p.checked !== true).map(p => p.name);
ok(unchecked.length === 0, `${PHIL_INTRO.length}人すべて checked: true`,
   unchecked.length ? "照合前なので入口は出ない: " + unchecked.join("、") : "");
const noQ = PHIL_INTRO.filter(p => !QUESTIONS.some(q => q.philosophers.includes(p.name)))
  .map(p => p.name);
ok(noQ.length === 0, `全員に問題がある`, noQ.join("、"));
ok(html.includes('<script src="philosophers.js"></script>'),
   `index.html が philosophers.js を読み込んでいる`);
ok(html.includes('const PHIL_MAP = {}'), `index.html に紹介まわりの関数がある`);

console.log("\n===== 7. PHILOSOPHERS.years が引用行と一致するか =====\n");
/* tools/years_src.json は、生没年を確認した資料の一行を人物ごとに写したもの。
   ⑧では intro の年だけを引用行から写しており、years そのものは検証していなかった。
   バディウの没年 2025 が資料に無いことが分かったのが発端である。
   「頃」の付く端点は資料と5年までのずれを許す（幅のある推定だから）。 */
const ysrc = readJson(path.join(R, "tools", "years_src.json"));
const noSrc = PHILOSOPHERS.filter(p => !ysrc[p.name]).map(p => p.name);
ok(noSrc.length === 0, `${PHILOSOPHERS.length}人すべてに引用行がある`, noSrc.join("、"));

/* 端点の分け方と「頃」の許容幅は _lib.js の matchYears にある。
   add_person.js（登録の前の検査）が同じ判定を読む。2026-09-21 に寄せた。 */
const known = ysrc["_既知の食い違い"] || {};
const yBad = [];
const yKnown = [];
PHILOSOPHERS.forEach(p => {
  const q = ysrc[p.name];
  if (!q) return;
  const { inQuote, 合わない } = matchYears(p.years, q);
  合わない.forEach(() => {
    const line = `${p.name}(台帳:${p.years}／引用行の年:${inQuote.join(",") || "なし"})`;
    /* 食い違いを見つけたうえで、理由を書いて残すことにしたものは落とさない。
       黙って通すのではなく、毎回名前を出す */
    if (known[p.name]) yKnown.push(line); else yBad.push(line);
  });
});
ok(yBad.length === 0, `years の数字が引用行に出てくる`, yBad.join("　/　"));
if (yKnown.length) {
  console.log(`  △ 既知の食い違い${yKnown.length}件（tools/years_src.json の _既知の食い違い に理由がある）`);
  yKnown.forEach(l => console.log(`      ${l}`));
}
const alive = PHILOSOPHERS.filter(p => /–\s*$/.test(p.years));
console.log(`  （存命として扱っている人物：${alive.length}人）`);

console.log("\n===== 6. 残り =====\n");
const rest = PHILOSOPHERS.length - PHIL_INTRO.length;
console.log(`  紹介あり ${PHIL_INTRO.length}人 ／ まだ ${rest}人（入口は出ない）`);

console.log(bad ? `\n===== ${bad}件が通らなかった =====\n` : "\n===== すべて通った =====\n");
process.exit(bad ? 1 : 0);
