/* ===========================================================
   収録状況の点検スクリプト

   使い方:  node coverage.js
            node coverage.js カント        （その人物だけ詳しく）

   何が分かるか:
     - 人物ごとの収録問題数と、実際に扱っている概念の一覧
     - 用語タグごとの問題数（横断の網の密度）
     - 解説では繰り返し使っているのに、一度も出題していない語
       ※「存在」が抜けていたのと同じ種類の抜けを見つけるための項目
     - 解説にも設問文にも出るのに TERMS に無い語（用語一覧に足す候補）
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

/* ---------- 4. TERMS に登録されていない概念 ---------- */
/*
   第3節との違い。
   第3節は「設問文・選択肢に一度も出ない語」を探す。だから中心概念ほど
   設問文に出てしまい、検出できない（「真理」「経験」「認識」が漏れる）。
   この節は逆に、設問文にも問われている語に限って TERMS に無いものを出す。

   一般語（経験、自然、歴史…）を落とすのに使うのは「集中度」である。
   概念は特定の学派に偏って現れ、一般語は全学派に散る。
   最も多い学派が全体の40%以上を占める語だけを残す。
*/
console.log("");
console.log("===== 解説にも設問文にも出るのに TERMS に無い語 =====");
console.log("（用語一覧に足す候補。5〜25問くらいが絞り込みとして働く範囲）");
console.log("");

const regSet = new Set(TERMS.map(t => t.name));
const schoolOf = {};
PHILOSOPHERS.forEach(p => schoolOf[p.name] = p.school);

// 人名は「メルロ＝ポンティ」のような複合形もばらして除く
const nameParts = new Set();
PHILOSOPHERS.forEach(p => p.name.split(/[＝・]/).forEach(x => { if (x.length >= 2) nameParts.add(x); }));

const general = new Set(("経験 自然 歴史 価値 道徳 行為 目的 論理 精神 意識 社会 世界 人間 " +
  "枠組 要点 応答 理由 系譜 背景 共通 文脈 世紀 論法 仕事 成立 両者 基準 自体 選択 同時 " +
  "運動 反論 思考 現実 定義 注意 方針 共有 根拠 仕方 一節 帰結 規則 単純 本人 領域 結論 " +
  "性格 関心 対応 由来 一方 評価 否定 対立 構図 体系 論争 出発点 出発 理論 発想 診断 適切 " +
  "ドイツ イギリス ロシア オランダ ウィーン ベルリン パリ").split(/\s+/));

const seenIn = new Map();
QUESTIONS.forEach(q => {
  const t = (q.explanation || "") + (q.detail || "");
  const found = new Set();
  (t.match(/[ァ-ヴー]{3,}/g) || []).forEach(w => found.add(w));
  (t.match(/[一-龥]{2,5}/g) || []).forEach(w => found.add(w));
  found.forEach(w => { if (!seenIn.has(w)) seenIn.set(w, []); seenIn.get(w).push(q); });
});
const questionText = QUESTIONS.map(q => q.question).join("\n");

const cands = [];
for (const [w, qs] of seenIn) {
  if (qs.length < 5) continue;                                   // 5問未満は一覧に出す意味がない
  if (regSet.has(w) || stop.has(w) || general.has(w)) continue;
  if (nameParts.has(w)) continue;
  if ([...regSet].some(r => w !== r && w.includes(r))) continue; // 登録語を含む複合語
  if (questionText.split(w).length - 1 < 2) continue;            // 設問文にも問われている語だけ
  const c = {};
  qs.forEach(q => q.philosophers.forEach(n => { const sc = schoolOf[n]; if (sc) c[sc] = (c[sc] || 0) + 1; }));
  const ent = Object.entries(c).sort((a, b) => b[1] - a[1]);
  const tot = ent.reduce((a, b) => a + b[1], 0);
  if (!tot) continue;
  const share = ent[0][1] / tot;
  if (share < 0.4) continue;                                     // 全学派に散る語は一般語とみなす
  cands.push({ w: w, n: qs.length, school: ent[0][0], share: Math.round(share * 100) });
}
cands.sort((a, b) => a.n - b.n).forEach(c => {
  const mark = (c.n >= 5 && c.n <= 25) ? "" : "   ← 広すぎる";
  console.log("  " + c.w.padEnd(8, "　") + String(c.n).padStart(3) + "問  " +
              String(c.share).padStart(3) + "%が " + c.school + mark);
});
console.log("");
console.log("  候補 " + cands.length + "語（登録済み " + TERMS.length + "語）");
console.log("");

/* ---------- 5. 全体 ---------- */
const flagged = QUESTIONS.filter(q => q.source.kind === "ai_flagged").length;
const verified = QUESTIONS.filter(q => q.source.kind === "book" || q.source.kind === "ai_web").length;
console.log("\n===== 全体 =====\n");
console.log(`  問題 ${QUESTIONS.length}　人物 ${PHILOSOPHERS.length}　用語 ${TERMS.length}`);
console.log(`  比較問題 ${QUESTIONS.filter(q => q.type === "compare").length}`);
console.log(`  要検証マーク ${flagged}　検証済み ${verified}　未検証 ${QUESTIONS.length - flagged - verified}`);
console.log("");

/* ---------- 6. 四択の成立状況 ---------- */
const judged = QUESTIONS.filter(q => q.source.choicesOk);
if (judged.length) {
  const by = k => judged.filter(q => q.source.choicesOk === k);
  const ids = k => by(k).map(q => q.id).join(" ");
  console.log("===== 四択の成立状況（choicesOk）=====");
  console.log("（争点を踏まえても、いま四択として成立しているか。値は現在の状態を表し、履歴は note に書く）");
  console.log("");
  console.log(`  判定済み ${judged.length}問 / 検証済み ${verified + flagged}問`);
  console.log("");
  console.log(`  ok      ${String(by("ok").length).padStart(3)}問  争点があっても成立する`);
  console.log(`  fragile ${String(by("fragile").length).padStart(3)}問  成立しているが編集禁止（選択肢に触れると壊れる）`);
  if (by("fragile").length) console.log(`             ${ids("fragile")}`);
  console.log(`  broken  ${String(by("broken").length).padStart(3)}問  いま四択として成立していない（直したら ok に変える）`);
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
