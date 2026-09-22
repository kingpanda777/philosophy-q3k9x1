/* ===========================================================
   道具が共通で持つもの（2026-09-21 に切り出した）

   入っているのは5つである。
     1. 字数の数え方  L
     2. JSON の読み書き  readJson / writeJson
     3. 哲学者紹介（PHIL_INTRO）の基準値  PHIL
     4. 生没年と引用行の突き合わせ  matchYears
     5. ファイルの読み書き（やり直しつき・一時ファイル経由）  readFileSafe / writeFileSafe / diagnose
        （2026-09-23 に足した。下の「5.」の節）

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

   使い方:  const { L, readJson, writeJson, PHIL, matchYears,
                    readFileSafe, writeFileSafe, diagnose } = require("./_lib.js");
   =========================================================== */

"use strict";
const fs = require("fs");
const path = require("path");

/* ---- 5. ファイルの読み書き（2026-09-23 に足した） ----
   なぜ足したか。2026-09-23 の add_batch.js 本番で、書き込みの途中で questions.js を
   開けずに落ち、差し戻しも同じファイルを開けずに落ちた（code UNKNOWN、errno -4094、syscall open）。
   questions.js は途中まで書き換わったまま残り、手でバックアップから戻した。
   書き込みが fs.writeFileSync の直書きで、開いた瞬間に中身を空にするため、
   途中で止まると壊れた中身が残る作りだった。

   直し方は2つ。
     ・書き込みは同じフォルダの一時ファイル（<名前>.tmp-<pid>）に書いてから置き換える。
       置き換えに失敗しても元のファイルは1バイトも変わらない
     ・開けない／置き換えられないときは、間を空けて最大6回試す（待ちは計3.1秒）

   やり直すのは、他のプロセスがファイルを握っているときに出るコードだけ。
   ENOENT（ファイルが無い）や EISDIR のような、待っても直らないものはすぐ投げる。
   原因の見立ては diagnose() が書く。 */
const RETRY_CODES = new Set(["EBUSY", "EPERM", "EACCES", "UNKNOWN", "EAGAIN", "EMFILE", "ENFILE"]);
const WAITS = [100, 200, 400, 800, 1600];
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function retry(what, f, fn) {
  const codes = [];
  for (let i = 0; ; i++) {
    try {
      const r = fn();
      if (codes.length)
        console.error(`  （${path.basename(f)} の${what}を${codes.length}回やり直して通った: ${codes.join("・")}）`);
      return r;
    } catch (e) {
      if (!RETRY_CODES.has(e.code) || i >= WAITS.length) {
        e.tries = codes.concat(e.code || "?");
        throw e;
      }
      codes.push(e.code);
      sleep(WAITS[i]);
    }
  }
}
const readFileSafe = (f, enc) => retry("読み込み", f, () => fs.readFileSync(f, enc));
function writeFileSafe(f, data, enc) {
  const tmp = `${f}.tmp-${process.pid}`;
  try {
    retry("一時ファイルへの書き込み", f, () => fs.writeFileSync(tmp, data, enc));
    retry("置き換え", f, () => fs.renameSync(tmp, f));
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* 一時ファイルが無ければそれでよい */ }
    e.message = `${f} を書き換えられなかった（${(e.tries || [e.code]).join("→")}。` +
      `元のファイルは置き換えていない）: ${e.message}`;
    throw e;
  }
}
/* エラーコードから原因の見立てを返す。Windows の libuv の対応表による。 */
function diagnose(code) {
  switch (code) {
    case "EBUSY": return "EBUSY: 別のプロセス（エディタ・ウイルス対策の検査・検索インデクサ・同期ソフトなど）がファイルを開いたまま、共有を許していない。";
    case "EPERM": case "EACCES": return `${code}: 読み取り専用の属性か権限の問題、または置き換え先を別のプロセスが「削除を許さない」形で開いている。`;
    case "UNKNOWN": return "UNKNOWN（errno -4094）: libuv が名前を付けていない Windows のエラー。書き込みで開くときに出るのは、" +
      "多くが ERROR_USER_MAPPED_FILE（1224。別のプロセスがファイルをメモリに割り当てて開いている）で、" +
      "エディタや、ウイルス対策・検索インデクサが書き込み直後のファイルを読みに来たときに起きる。";
    case "EMFILE": case "ENFILE": return `${code}: 開いているファイルが多すぎる。`;
    default: return `${code || "?"}: 見立てのない種類。`;
  }
}

/* ---- 1. 字数の数え方 ----
   サロゲートペア（絵文字や一部の漢字）を1字として数える。
   String.length は2と数えるので、字数の上限・下限がずれる。
   数え方を2つ持つと、同じ本文が道具のどこで測られたかで違う字数になる。 */
const L = s => [...s].length;

/* ---- 2. JSON の読み書き ----
   字下げは空白1つ、末尾に改行を1つ。keyterms.json・keys_draft.json・
   years_src.json はすべてこの形で保存されている。
   字下げを変えると、1語直しただけでファイル全体が差分に出る。 */
const readJson = f => JSON.parse(readFileSafe(f, "utf8"));
const writeJson = (f, o) => writeFileSafe(f, JSON.stringify(o, null, 1) + "\n", "utf8");

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

module.exports = { L, readJson, writeJson, PHIL, matchYears, readFileSafe, writeFileSafe, diagnose };
