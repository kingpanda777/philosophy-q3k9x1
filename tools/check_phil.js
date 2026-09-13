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
const L = s => [...s].length;
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
const noYomi = PHIL_INTRO.filter(p => !p.yomi || !/^[ぁ-ゖー・]+$/.test(p.yomi)).map(p => p.name);
ok(noYomi.length === 0, `yomi がひらがなで入っている`, noYomi.join("、"));
const noPlace = PHIL_INTRO.filter(p => !p.place || /\s/.test(p.place)).map(p => p.name);
ok(noPlace.length === 0, `place が1語で入っている`, noPlace.join("、"));
const lenBad = PHIL_INTRO.filter(p => L(p.intro) < 60 || L(p.intro) > 100)
  .map(p => `${p.name}(${L(p.intro)}字)`);
ok(lenBad.length === 0, `intro が60〜100字に収まっている`, lenBad.join("、"));
const wBad = PHIL_INTRO.filter(p => !Array.isArray(p.works) || p.works.length > 3).map(p => p.name);
ok(wBad.length === 0, `works が3冊以内`, wBad.join("、"));
const wOrder = PHIL_INTRO.filter(p => {
  const ys = (p.works || []).filter(w => w.year).map(w => w.year);
  return ys.some((y, i) => i && y < ys[i - 1]);
}).map(p => p.name);
ok(wOrder.length === 0, `works が年代順`, wOrder.join("、"));

console.log("\n===== 4. intro に評価語が混ざっていないか =====\n");
/* 事実だけを書く決まり。ここに挙げた語が出たら書き直す */
const NG = ["偉大", "重要", "影響力", "最大の", "画期的", "先駆的", "天才", "有名", "著名",
            "傑作", "不朽", "卓越", "比類", "決定的", "革命的", "名高い"];
const ngHit = [];
PHIL_INTRO.forEach(p => NG.forEach(w => { if (p.intro.includes(w)) ngHit.push(`${p.name}:${w}`); }));
ok(ngHit.length === 0, `評価語が入っていない`, ngHit.join("、"));

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

console.log("\n===== 6. 残り =====\n");
const rest = PHILOSOPHERS.length - PHIL_INTRO.length;
console.log(`  紹介あり ${PHIL_INTRO.length}人 ／ まだ ${rest}人（入口は出ない）`);

console.log(bad ? `\n===== ${bad}件が通らなかった =====\n` : "\n===== すべて通った =====\n");
process.exit(bad ? 1 : 0);
