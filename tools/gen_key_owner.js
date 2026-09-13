/* ===========================================================
   鍵語 → 登録人物の対応表（KEY_OWNER）を書き出す

   使い方:  node tools/gen_key_owner.js
            （philosophers.js の末尾の生成ブロックを書き換える）

   なぜ要るか。
   紹介シートの「この人の鍵語」を、その人の問題の keys から集めると、
   比較問題の相手側の語まで混ざる。カントのシートに一般意志・原初状態・
   純粋持続・他者危害原則が出ていたのがそれで、いずれも相手の語である。
   台帳（keyterms.json）は語を人物ごとに登録しているので、
   「その人の問題の keys」∩「台帳でその人に登録された語」で絞ればよい。

   アプリは keyterms.json を読まない決まりなので、KEY_YOMI と同じく写しを置く。
   ただし KEY_YOMI は手で写しているのに対し、こちらは語数が多いので生成する。
   手で直さないこと。台帳を直したらこれを走らせ、check_keys.js を通す。

   規則3の二人語（贈与・真正性など）は両方の人物が入る。配列にしてあるのはそのため。
   =========================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const R = path.join(__dirname, "..");
const P = path.join(R, "philosophers.js");

const kt = JSON.parse(fs.readFileSync(path.join(R, "keyterms.json"), "utf8"));

const owner = {};
Object.entries(kt).forEach(([ph, v]) => {
  if (ph === "_meta") return;
  (v["鍵語"] || []).forEach(t => {
    (owner[t["語"]] = owner[t["語"]] || []).push(ph);
  });
});

const words = Object.keys(owner).sort();
const body = words
  .map(w => "  " + JSON.stringify(w) + ": " + JSON.stringify(owner[w]) + ",")
  .join("\n");

const BEGIN = "/* ---------- ここから下は tools/gen_key_owner.js が書き出す。手で直さない ---------- */";
const END = "/* ---------- 生成ブロックここまで ---------- */";

const block = [
  BEGIN,
  "/* 鍵語 → 台帳でその語を登録している人物。keyterms.json の写し。",
  "   紹介シートが「この人の鍵語」を絞るのに使う。",
  "   台帳を直したら node tools/gen_key_owner.js を走らせ直すこと。 */",
  "const KEY_OWNER = {",
  body,
  "};",
  END
].join("\n");

let s = fs.readFileSync(P, "utf8");
const i = s.indexOf(BEGIN);
if (i >= 0) {
  const j = s.indexOf(END, i);
  if (j < 0) throw new Error("生成ブロックの終わりが見つからない");
  s = s.slice(0, i) + block + s.slice(j + END.length);
} else {
  s = s.replace(/\s*$/, "") + "\n\n" + block + "\n";
}
fs.writeFileSync(P, s, "utf8");
console.log("KEY_OWNER を書き出した：" + words.length + "語 / 二人語 " +
  words.filter(w => owner[w].length > 1).length + "語");
