/* CLAUDE.md の「進捗」の表を、questions.js と keyterms.json の実測で書き換える。
   使い方: node tools/progress_table.js <リポジトリの絶対パス>
   数えている中身は coverage.js と同じだが、こちらは表の行を置き換えるところまでやる。
   行の文言が変わっている場合は、置換できなかった行を一覧で出して止める（終了コード1）。
   2026-09-17 に tools/ へ据え付けた。それまで点検のたびに scratchpad へ書き直していて、
   比較問題の数え方を取り違えて表へ214と書いた失敗がある（下の注記）。
   add_batch.js から呼ばれる。 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2];
const P = f => path.join(ROOT, f);

const { QUESTIONS, PHILOSOPHERS, TERMS } =
  new Function(fs.readFileSync(P("questions.js"), "utf8") + "\n;return {QUESTIONS,PHILOSOPHERS,TERMS};")();
const kt = JSON.parse(fs.readFileSync(P("keyterms.json"), "utf8"));

/* ---- 数える ---- */
const kind = {}, ok = {}, par = {};
let uv = 0, withKeys = 0, total = 0;
const allKeys = new Set();
for (const q of QUESTIONS) {
  kind[q.source.kind] = (kind[q.source.kind] || 0) + 1;
  ok[q.source.choicesOk] = (ok[q.source.choicesOk] || 0) + 1;
  if (q.source.unverified) uv++;
  if (q.detail) { const n = q.detail.split(/\n\n+/).length; par[n] = (par[n] || 0) + 1; }
  const k = q.keys || [];
  if (k.length) withKeys++;
  total += k.length;
  k.forEach(x => allKeys.add(x));
}
const treat = {};
let terms = 0, people = 0;
for (const p of Object.keys(kt)) {
  if (p === "_meta") continue;
  people++;
  for (const t of kt[p]["鍵語"]) { terms++; const v = t["扱い"] || "未設定"; treat[v] = (treat[v] || 0) + 1; }
}
const n = QUESTIONS.length;
const schools = new Set(PHILOSOPHERS.map(p => p.school)).size;
/* 比較問題は type が "compare" のものを数える（coverage.js と同じ定義）。
   philosophers が2人以上かどうかで数えると、type が single のまま複数人を挙げている
   問題まで入って数が倍近くになる。2026-09-16 に取り違えて表へ214と書いてしまった。 */
const compare = QUESTIONS.filter(q => q.type === "compare").length;
const T = k => treat[k] || 0;

/* ---- 置き換える ---- */
const rows = [
  [/^\| 検証済み \| .*$/m, `| 検証済み | **${n}問** / ${n}（完了） |`],
  [/^\| `ai_web` \| .*$/m, `| \`ai_web\` | ${kind.ai_web || 0} |`],
  [/^\| `ai_flagged` \| .*$/m, `| \`ai_flagged\` | ${kind.ai_flagged || 0} |`],
  [/^\| `ai`（未検証） \| .*$/m, `| \`ai\`（未検証） | ${kind.ai || 0} |`],
  [/^\| choicesOk \| .*$/m, `| choicesOk | ok ${ok.ok || 0} ／ fragile ${ok.fragile || 0} ／ broken ${ok.broken || 0}（判定済み${n}問） |`],
  [/^\| 鍵語（`keyterms\.json`） \| .*$/m, `| 鍵語（\`keyterms.json\`） | **${terms}語** / ${people}人 |`],
  [/^\| 鍵語の扱い \| .*$/m, `| 鍵語の扱い | 主題 ${T("主題")} ／ 説明あり ${T("説明あり")} ／ 言及 ${T("言及")} ／ 未登場 ${T("未登場")} ／ 未設定 ${T("未設定")} |`],
  [/^\| detail の段落数 \| .*$/m, `| detail の段落数 | 3段落 ${par[3] || 0}問 ／ 4段落 ${par[4] || 0}問 ／ 5段落 ${par[5] || 0}問 |`],
  [/^\| `q\.keys` \| .*$/m, `| \`q.keys\` | 異なり ${allKeys.size}語 ／ 延べ ${total}件 ／ 付いている問題 ${withKeys}問（${(withKeys / n * 100).toFixed(1)}%） |`],
  [/^\| `source\.unverified` \| .*$/m, `| \`source.unverified\` | ${uv}問（意図して残しているもの） |`],
  [/^\*\*2026年9月16日に `node coverage\.js` で実測した値である。\*\*人物.*$/m,
    `**2026年9月16日に \`node coverage.js\` で実測した値である。**人物${PHILOSOPHERS.length}人・学派${schools}・比較問題${compare}問。`]
];
let s = fs.readFileSync(P("CLAUDE.md"), "utf8");
const missed = [];
for (const [re, line] of rows) {
  if (!re.test(s)) { missed.push(line.slice(0, 40)); continue; }
  s = s.replace(re, line);
}
if (missed.length) { console.error("置換できなかった行:\n  " + missed.join("\n  ")); process.exit(1); }
fs.writeFileSync(P("CLAUDE.md"), s, "utf8");

console.log("進捗表を実測値で更新した");
console.log(`  問題 ${n}（ai_web ${kind.ai_web || 0} ／ ai_flagged ${kind.ai_flagged || 0} ／ ai ${kind.ai || 0}）`);
console.log(`  choicesOk: ok ${ok.ok || 0} ／ fragile ${ok.fragile || 0} ／ broken ${ok.broken || 0}`);
console.log(`  鍵語 ${terms}語 / ${people}人　扱い: 主題 ${T("主題")} ／ 説明あり ${T("説明あり")} ／ 言及 ${T("言及")} ／ 未登場 ${T("未登場")} ／ 未設定 ${T("未設定")}`);
console.log(`  detail: 3段落 ${par[3] || 0} ／ 4段落 ${par[4] || 0} ／ 5段落 ${par[5] || 0}　unverified ${uv}`);
console.log(`  q.keys: 異なり ${allKeys.size} ／ 延べ ${total} ／ 付与 ${withKeys}問`);
console.log(`  人物 ${PHILOSOPHERS.length} ／ 学派 ${schools} ／ 比較問題 ${compare} ／ TERMS ${TERMS.length}`);
