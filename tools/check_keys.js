/* ===========================================================
   鍵語まわりの整合の点検

   使い方:  node tools/check_keys.js
            （通れば終了コード0、どれか落ちれば1）

   鍵語は四つの場所に散っている。ひとつ直して他を忘れると、
   一覧に古い名前が残る、読みが引けずに並びが崩れる、といった形で壊れる。
   改名・統合・語の追加をしたら、必ずこれを通すこと。
   項目5だけは鍵語と関係なく、本文に妙な文字が混ざっていないかを見る。

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

/* ---------- 5. 本文に混ざってはいけない文字 ----------
   書いている途中で、キリル文字やハングルが一文字だけ紛れ込むことが実際に起きた。
   画面では日本語に見えるので目視では見つからない。全文を機械で通す。

   通す範囲: question / choices / explanation / detail / source.note / source.refs
   通す文字: ひらがな・カタカナ・漢字・全角記号・英数・半角記号・全角英数・ギリシア文字
             （ギリシア文字は原語の併記に使うことがあるので許す） */
console.log("\n===== 5. 本文に妙な文字が混ざっていないか =====\n");

const ALLOWED = new RegExp(
  "[" +
  "\\u0020-\\u007E" +          // 半角の英数と記号
  "\\u00A0-\\u00FF" +          // ラテン1補助（é など）
  "\\u0100-\\u024F" +          // ラテン拡張（ō など、翻字に使う）
  "\\u0370-\\u03FF" +          // ギリシア文字
  "\\u1E00-\\u1EFF" +          // ラテン拡張追加
  "\\u1F00-\\u1FFF" +          // ギリシア文字拡張（気息記号つき。原語の併記に使う）
  "\\u2000-\\u206F" +          // 一般句読点（— … ‘ ’ “ ” など）
  "\\u2460-\\u24FF" +          // 囲み英数字（①②③）
  "\\u2100-\\u21FF" +          // 文字様記号と矢印
  "\\u2200-\\u22FF" +          // 数学記号
  "\\u2500-\\u257F" +          // 罫線
  "\\u25A0-\\u25FF" +          // 幾何学模様
  "\\u3000-\\u303F" +          // 全角の句読点と括弧
  "\\u3040-\\u309F" +          // ひらがな
  "\\u30A0-\\u30FF" +          // カタカナ
  "\\u3400-\\u4DBF" +          // 漢字拡張A
  "\\u4E00-\\u9FFF" +          // 漢字
  "\\uF900-\\uFAFF" +          // 互換漢字
  "\\uFF00-\\uFFEF" +          // 全角の英数と記号、半角カナ
  "\\n" +
  "]"
);

const strangeName = c => {
  const n = c.codePointAt(0);
  if (n >= 0x0400 && n <= 0x04FF) return "キリル";
  if (n >= 0xAC00 && n <= 0xD7AF) return "ハングル";
  if (n >= 0x1100 && n <= 0x11FF) return "ハングル字母";
  if (n >= 0x0600 && n <= 0x06FF) return "アラビア";
  if (n >= 0x0590 && n <= 0x05FF) return "ヘブライ";
  if (n >= 0x0E00 && n <= 0x0E7F) return "タイ";
  if (n >= 0x0900 && n <= 0x097F) return "デーヴァナーガリー";
  if (n >= 0x1F300 && n <= 0x1FAFF) return "絵文字";
  return "不明";
};

const strange = [];
QUESTIONS.forEach(q => {
  const fields = [["question", q.question], ["explanation", q.explanation], ["detail", q.detail]];
  (q.choices || []).forEach((c, i) => fields.push(["choices[" + i + "]", c]));
  if (q.source) {
    if (q.source.note) fields.push(["source.note", q.source.note]);
    if (q.source.unverified) fields.push(["source.unverified", q.source.unverified]);
    (q.source.refs || []).forEach((r, i) => fields.push(["source.refs[" + i + "]", r]));
  }
  fields.forEach(([where, text]) => {
    if (!text) return;
    [...text].forEach((ch, pos) => {
      if (ALLOWED.test(ch)) return;
      const cp = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      strange.push(`${q.id} ${where} ${pos}文字目 「${ch}」 U+${cp}（${strangeName(ch)}）`);
    });
  });
});
ok(strange.length === 0,
   `${QUESTIONS.length}問の全文字を通した`,
   strange.length ? strange.slice(0, 20).join(" / ") + (strange.length > 20 ? ` ほか${strange.length - 20}件` : "") : "");

console.log("");
if (bad) { console.log(`===== ${bad}件が通らなかった =====\n`); process.exit(1); }
console.log("===== すべて通った =====\n");
