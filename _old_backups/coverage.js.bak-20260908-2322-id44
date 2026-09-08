/* ===========================================================
   収録状況の点検スクリプト

   使い方:  node coverage.js
            node coverage.js カント        （その人物だけ詳しく）

   何が分かるか:
     - 人物ごとの収録問題数と、実際に扱っている概念の一覧
     - 用語タグごとの問題数（横断の網の密度）
     - 解説では繰り返し使っているのに、一度も出題していない語
       ※「存在」が抜けていたのと同じ種類の抜けを見つけるための項目
   =========================================================== */

"use strict";
const fs = require("fs");
const path = require("path");

const srcText = fs.readFileSync(path.join(__dirname, "questions.js"), "utf8");
const { QUESTIONS, PHILOSOPHERS, TERMS } =
  new Function(srcText + ";return {QUESTIONS,PHILOSOPHERS,TERMS};")();

const target = process.argv[2];

function shortTitle(q, name) {
  return q.question
    .replace(new RegExp(name, "g"), "")
    .replace(/として最も適切なものは？|として正しいものは？|の説明|は？$/g, "")
    .trim();
}

/* ---------- 1. 人物ごとの収録状況 ---------- */
console.log("\n===== 人物ごとの収録状況 =====\n");
const list = target ? PHILOSOPHERS.filter(p => p.name.includes(target)) : PHILOSOPHERS;
if (target && !list.length) {
  console.log(`「${target}」という人物は登録されていません。\n`);
}
list.forEach(p => {
  const all = QUESTIONS.filter(q => q.philosophers.includes(p.name));
  const solo = all.filter(q => q.type === "single");
  const cmp = all.length - solo.length;
  const mark = all.length < 5 ? "  ← 薄い" : "";
  console.log(`■ ${p.name}（${p.years}）　単独${solo.length} / 比較${cmp}${mark}`);
  if (target || all.length < 5) {
    solo.forEach(q => console.log("     ・" + shortTitle(q, p.name)));
  }
});

/* ---------- 2. 用語タグの密度 ---------- */
console.log("\n===== 用語タグごとの問題数 =====\n");
TERMS.map(t => ({
  name: t.name,
  n: QUESTIONS.filter(q => q.terms.includes(t.name)).length,
  who: [...new Set(QUESTIONS.filter(q => q.terms.includes(t.name)).flatMap(q => q.philosophers))].length
}))
  .sort((a, b) => b.n - a.n)
  .forEach(t => {
    const mark = t.n < 5 ? "  ← 薄い" : "";
    console.log(`  ${t.name.padEnd(6, "　")} ${String(t.n).padStart(3)}問 / ${t.who}人${mark}`);
  });

/* ---------- 3. 出題されていない語の検出 ---------- */
console.log("\n===== 解説で繰り返し使っているのに出題していない語 =====");
console.log("（「存在」が抜けていたのと同じ種類の抜けを探す項目。ノイズも混じるので目視で判断）\n");

const asked = QUESTIONS.map(q => q.question + q.choices.join("")).join("\n");
const used = QUESTIONS.map(q => q.explanation + (q.detail || "")).join("\n");

const stop = new Set(("一番目 二番目 三番目 四番目 選択肢 場合 場面 議論 主張 批判 指摘 概念 立場 問題 論点 " +
  "現在 当時 自分 人間 世界 存在 意味 理解 説明 記述 分析 提示 展開 必要 可能 前提 結果 原因 関係 構造 " +
  "内容 形式 方法 部分 全体 以上 以下 実際 有名 重要 中心 基本 最初 最後 現代 古代 時代 思想 哲学 著作 " +
  "論文 講義 読者 正反対 決定的 分岐点 抽象的 典型例 興味深 研究上 影響関係 間接的 連続性 心理的 定式化 " +
  "フランス アメリカ ヨーロッパ イングランド テキスト 世紀後半 思想史 哲学史 " +
  "分析哲学 正義論 政治哲学 科学哲学 現象学 構造主義 実存主義 社会学 精神分析 " +
  "同時代 同時期 彼自身 影響力 メートル 往復書簡").split(/\s+/));

const count = new Map();
const push = w => count.set(w, (count.get(w) || 0) + 1);
(used.match(/[ァ-ヴー]{4,}/g) || []).forEach(push);
(used.match(/[一-龥]{2,6}/g) || []).forEach(push);

[...count.entries()]
  .filter(([w, c]) => c >= 3 && w.length >= 3 && !stop.has(w) && !asked.includes(w) && !w.endsWith("的"))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 50)
  .forEach(([w, c]) => console.log(`  ${String(c).padStart(3)}回  ${w}`));

/* ---------- 4. 全体 ---------- */
const flagged = QUESTIONS.filter(q => q.source.kind === "ai_flagged").length;
const verified = QUESTIONS.filter(q => q.source.kind === "book" || q.source.kind === "ai_web").length;
console.log("\n===== 全体 =====\n");
console.log(`  問題 ${QUESTIONS.length}　人物 ${PHILOSOPHERS.length}　用語 ${TERMS.length}`);
console.log(`  比較問題 ${QUESTIONS.filter(q => q.type === "compare").length}`);
console.log(`  要検証マーク ${flagged}　検証済み ${verified}　未検証 ${QUESTIONS.length - flagged - verified}`);
console.log("");

/* ---------- 5. 四択の成立状況 ---------- */
const judged = QUESTIONS.filter(q => q.source.choicesOk);
if (judged.length) {
  const by = k => judged.filter(q => q.source.choicesOk === k);
  const ids = k => by(k).map(q => q.id).join(" ");
  console.log("===== 四択の成立状況（choicesOk）=====");
  console.log("（争点を踏まえても四択として成立するか。検証時に判定する）");
  console.log("");
  console.log(`  判定済み ${judged.length}問 / 検証済み ${verified + flagged}問`);
  console.log("");
  console.log(`  ok      ${String(by("ok").length).padStart(3)}問  争点があっても成立する`);
  console.log(`  fragile ${String(by("fragile").length).padStart(3)}問  条件付きで成立。編集で崩れる`);
  if (by("fragile").length) console.log(`             ${ids("fragile")}`);
  console.log(`  broken  ${String(by("broken").length).padStart(3)}問  成立していなかった（修正済み）`);
  if (by("broken").length) console.log(`             ${ids("broken")}`);
  const noNote = judged.filter(q => !q.source.note);
  if (noNote.length) {
    console.log("");
    console.log(`  ← 判定はあるが note がない ${noNote.length}問`);
  }
  const unjudged = QUESTIONS.filter(q => q.source.kind !== "ai" && !q.source.choicesOk);
  if (unjudged.length) {
    console.log(`  ← 検証済みだが未判定 ${unjudged.length}問: ${unjudged.map(q => q.id).join(" ")}`);
  }
  console.log("");
}
