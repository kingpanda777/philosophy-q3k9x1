/* ===========================================================
   鍵語まわりの整合の点検

   使い方:  node tools/check_keys.js
            （通れば終了コード0、どれか落ちれば1）

   鍵語は四つの場所に散っている。ひとつ直して他を忘れると、
   一覧に古い名前が残る、読みが引けずに並びが崩れる、といった形で壊れる。
   改名・統合・語の追加をしたら、必ずこれを通すこと。

     keyterms.json          … 台帳。語・読み・タグ付け対象
     questions.js の q.keys … 配信データ。鍵語タブの一覧と出題はここから作る
     tools/keys_draft.json  … 採用の記録。q.keys と同じ内容でなければならない
     index.html             … KEY_YOMI（読み）と CONCEPT_ALSO_KEY（規則1の語）

   アプリは keyterms.json を読まない（台帳であって配信データではない）。
   だから読みと規則1の語は index.html へ写してある。そのぶん食い違いが起きる。
   =========================================================== */

"use strict";
const fs = require("fs");
const path = require("path");
const R = path.join(__dirname, "..");

const kt = JSON.parse(fs.readFileSync(path.join(R, "keyterms.json"), "utf8"));
const draft = JSON.parse(fs.readFileSync(path.join(R, "tools", "keys_draft.json"), "utf8"));
const html = fs.readFileSync(path.join(R, "index.html"), "utf8");
const { QUESTIONS } = new Function(
  fs.readFileSync(path.join(R, "questions.js"), "utf8") + ";return {QUESTIONS};")();

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) throw new Error(`index.html に ${name} が見つからない`);
  return new Function(m[0] + ";return " + name + ";")();
};
const KEY_YOMI = grab(/const KEY_YOMI = \{[\s\S]*?\n\};/, "KEY_YOMI");
const CONCEPT_ALSO_KEY = grab(/const CONCEPT_ALSO_KEY = \[[^\]]*\];/, "CONCEPT_ALSO_KEY");

/* 台帳を引きやすい形にする */
const ledger = {};      // 語 → 読み
const ledgerOff = [];   // タグ付け対象: false の語
Object.entries(kt).forEach(([p, v]) => {
  if (p === "_meta") return;
  (v["鍵語"] || []).forEach(t => {
    ledger[t["語"]] = t["読み"];
    if (t["タグ付け対象"] === false) ledgerOff.push(t["語"]);
  });
});

let bad = 0;
const ok = (cond, label, detail) => {
  console.log((cond ? "  ○ " : "  ✗ ") + label + (detail ? "  " + detail : ""));
  if (!cond) bad++;
};
const uniq = a => [...new Set(a)];

/* ---------- 1. q.keys の全語が台帳にあるか ---------- */
console.log("\n===== 1. q.keys の語が台帳にあるか =====\n");
const used = uniq(QUESTIONS.flatMap(q => q.keys || []));
const notInLedger = used.filter(w => !(w in ledger));
ok(notInLedger.length === 0,
   `q.keys の ${used.length}語すべてが台帳にある`,
   notInLedger.length ? "台帳にない: " + notInLedger.join("、") : "");

/* ---------- 2. keys_draft.json と q.keys が一致するか ---------- */
console.log("\n===== 2. keys_draft.json と q.keys が一致するか =====\n");
const diff = [];
QUESTIONS.forEach(q => {
  const a = JSON.stringify(q.keys || []);
  const b = JSON.stringify(draft[q.id] || []);
  if (a !== b) diff.push(`${q.id} q.keys=${a} draft=${b}`);
});
const draftOnly = Object.keys(draft).filter(id => !QUESTIONS.some(q => q.id === id));
ok(diff.length === 0, `${QUESTIONS.length}問すべてで中身と順序が一致`, diff.slice(0, 5).join(" / "));
ok(draftOnly.length === 0, `draft にあって questions.js にない id がない`, draftOnly.join("、"));
const nDraft = Object.values(draft).reduce((a, b) => a + b.length, 0);
const nKeys = QUESTIONS.reduce((a, q) => a + (q.keys || []).length, 0);
ok(nDraft === nKeys, `延べ件数が一致（${nKeys}件 / ${Object.keys(draft).length}問）`);

/* ---------- 3. KEY_YOMI ---------- */
console.log("\n===== 3. KEY_YOMI が台帳と合っているか =====\n");
const shown = uniq(used.concat(CONCEPT_ALSO_KEY));        // 鍵語タブに出る語
const noYomi = shown.filter(w => !KEY_YOMI[w]);
const wrong = Object.keys(KEY_YOMI).filter(w => ledger[w] !== KEY_YOMI[w]);
const extra = Object.keys(KEY_YOMI).filter(w => !shown.includes(w));
ok(noYomi.length === 0, `鍵語タブに出る${shown.length}語すべてに読みがある`,
   noYomi.length ? "読みがない: " + noYomi.join("、") : "");
ok(wrong.length === 0, `KEY_YOMI の読みが台帳と一致する`,
   wrong.length ? "食い違い: " + wrong.map(w => `${w}(台帳:${ledger[w]}／写し:${KEY_YOMI[w]})`).join("、") : "");
ok(extra.length === 0, `KEY_YOMI に余分な語がない`, extra.length ? "余分: " + extra.join("、") : "");
const noLedgerYomi = Object.keys(ledger).filter(w => !ledger[w]);
ok(noLedgerYomi.length === 0, `台帳${Object.keys(ledger).length}語すべてに読みがある`,
   noLedgerYomi.join("、"));

/* ---------- 4. 規則1の語 ---------- */
console.log("\n===== 4. 規則1（タグ付け対象外）の語が一致するか =====\n");
const a1 = uniq(ledgerOff).sort();
const a2 = uniq(CONCEPT_ALSO_KEY).sort();
const onlyLedger = a1.filter(w => !a2.includes(w));
const onlyHtml = a2.filter(w => !a1.includes(w));
ok(onlyLedger.length === 0 && onlyHtml.length === 0,
   `台帳の対象外${a1.length}語と CONCEPT_ALSO_KEY ${a2.length}語が一致`,
   [onlyLedger.length ? "台帳だけ: " + onlyLedger.join("、") : "",
    onlyHtml.length ? "index.html だけ: " + onlyHtml.join("、") : ""].filter(Boolean).join(" / "));
const offInKeys = a1.filter(w => used.includes(w));
ok(offInKeys.length === 0, `対象外の語が q.keys に混ざっていない`, offInKeys.join("、"));

console.log("");
if (bad) { console.log(`===== ${bad}件が通らなかった =====\n`); process.exit(1); }
console.log("===== すべて通った =====\n");
