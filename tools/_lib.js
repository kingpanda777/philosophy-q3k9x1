/* ===========================================================
   道具が共通で持つもの（2026-09-21 に切り出した）

   入っているのは4つだけである。
     1. 字数の数え方  L
     2. JSON の読み書き  readJson / writeJson
     3. 哲学者紹介（PHIL_INTRO）の基準値  PHIL
     4. 生没年と引用行の突き合わせ  matchYears

   なぜ切り出したか。**同じ定義が複数の道具に写してあると、片方だけ直したときに
   食い違ったまま気づかれない。** CLAUDE.md の「幅を変えるだけなら失効ではない。
   道具の定数を直して、この表も一緒に直すこと。片方だけ直すと、指針と道具が
   食い違ったまま気づかれない」と同じ型である。
   1 は add_batch.js と check_phil.js に同じ一行が写してあった。
   3 は check_phil.js にしか無く、add_person.js が同じ基準で入力を見るために要る。
   4 は汎用化で add_person.js にも同じ判定ができたので、その場で1つに寄せた
   （2026-09-21。「頃」の許容幅や年の拾い方といった細かい決めごとが2か所に写る）。

   **ここに入れていないもの**（2026-09-21 の判断）:
     入力の検査の枠（add_batch.js の validate）・配列の末尾へ足す処理・差し戻し
     （snapshot/restore）。共通にできるが、add_batch.js の構造に手を入れることになる。
     やるかどうかは別に判断する。CLAUDE.md の「次の作業」に残してある。

   使い方:  const { L, readJson, writeJson, PHIL, matchYears } = require("./_lib.js");
   =========================================================== */

"use strict";
const fs = require("fs");

/* ---- 1. 字数の数え方 ----
   サロゲートペア（絵文字や一部の漢字）を1字として数える。
   String.length は2と数えるので、字数の上限・下限がずれる。
   数え方を2つ持つと、同じ本文が道具のどこで測られたかで違う字数になる。 */
const L = s => [...s].length;

/* ---- 2. JSON の読み書き ----
   字下げは空白1つ、末尾に改行を1つ。keyterms.json・keys_draft.json・
   years_src.json はすべてこの形で保存されている。
   字下げを変えると、1語直しただけでファイル全体が差分に出る。 */
const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1) + "\n", "utf8");

/* ---- 3. 哲学者紹介の基準値 ----
   philosophers.js の冒頭コメントが書いている型を、数字にしたもの。
   check_phil.js（書いたあとの点検）と add_person.js（登録の前の検査）が
   同じものを読む。片方だけ緩めると、登録は通るのに点検で落ちる。 */
const PHIL = {
  INTRO_MIN: 60, INTRO_MAX: 100,
  THOUGHT_MIN: 80, THOUGHT_MAX: 120,
  /* 根拠になる問題が1問しかない人は、書ける中身がそもそも少ない。下限を緩める */
  THOUGHT_MIN_1SRC: 50,
  thoughtMin: src => (Array.isArray(src) && src.length === 1) ? PHIL.THOUGHT_MIN_1SRC : PHIL.THOUGHT_MIN,
  /* 読みはひらがな。長音符と中黒を許す */
  YOMI_RE: /^[ぁ-ゖー・]+$/,
  /* intro と thought は事実だけを書く決まり。ここに挙げた語が出たら書き直す。
     「卓越」は外した。マッキンタイアの徳倫理では術語であり（q470 の正解が
     「固有の卓越性の基準をもつ活動」）、評価語として弾くと本文が書けない */
  NG: ["偉大", "重要", "影響力", "最大の", "画期的", "先駆的", "天才", "有名", "著名",
       "傑作", "不朽", "比類", "決定的", "革命的", "名高い", "切り開", "礎を築"]
};

/* ---- 4. 生没年と引用行の突き合わせ ----
   tools/years_src.json は、生没年を確認した資料の一行を人物ごとに写したもの。
   PHILOSOPHERS.years の端点の数字が、その一行に出てくるかを見る。
   check_phil.js（書いたあとの点検）と add_person.js（登録の前の検査）が同じ判定を使う。

   years  … "1724–1804" "前427–前347" "1946–" "205頃–270" のどれか
   quote  … 引用行の文

   返すもの:
     inQuote … 引用行から拾った年の一覧（古代は二桁の年もある。
               エピクテトス「around 50 C.E.」があるので2桁から拾う）
     合わない … 引用行に出てこなかった端点の文字列。空なら一致している

   「頃」の付く端点は資料と5年までのずれを許す（幅のある推定だから）。 */
const matchYears = (years, quote) => {
  const inQuote = (String(quote).match(/[0-9]{2,4}/g) || []).map(Number);
  const 合わない = [];
  String(years).split("–").map(t => t.trim()).filter(t => t !== "").forEach(t => {
    const m = t.match(/([0-9]+)/);
    if (!m) return;
    const n = +m[1], 約 = t.includes("頃");
    const hit = 約 ? inQuote.some(v => Math.abs(v - n) <= 5) : inQuote.includes(n);
    if (!hit) 合わない.push(t);
  });
  return { inQuote, 合わない };
};

module.exports = { L, readJson, writeJson, PHIL, matchYears };
