/* 新規人物の登録（4か所）を一度に作る道具。

   使い方:  node tools/add_person.js tools/_people/<名前>.json
            node tools/add_person.js tools/_people/<名前>.json <ディレクトリ>
              （第2引数はサンドボックスで試すとき。省略するとリポジトリ直下）

   なぜ要るか。add_batch.js は台帳の人物エントリを作らない。
   「鍵語」（作問由来）も「台帳.新規登録」も、keyterms.json にその人物が
   無ければ「台帳にその人物がいない」で止まる。
   さらに作問だけを先に流すと check_keys が2件落ちる
   （①台帳に無い語が q.keys に入る ②その語に読みが無い）。
   だから登録4か所を先に作り、そのあと作問バッチを1回流す。

   触る4ファイル:
     questions.js         … PHILOSOPHERS に1人（一覧の一言・生没年・学派）
     philosophers.js      … PHIL_INTRO に1人（紹介の欄）
     tools/years_src.json … 生没年の引用行（check_phil の項目7が要求する）
     keyterms.json        … 台帳の人物エントリ（鍵語は空。作問バッチが入れる）

   **学派は入力に1回だけ書く。**questions.js と keyterms.json の両方へ道具が入れる。
   二度書かせると、片方だけ直して食い違う。

   入力の形（tools/_people/<名前>.json に置き、登録後もリポジトリに残す）:
   {
     "name": "シジウィック",            PHILOSOPHERS と PHIL_INTRO で同じ綴りになる
     "yomi": "しじうぃっく",            ひらがな
     "years": "1838–1900",              区切りは全角ダッシュ。存命なら "1937–"
     "school": "功利主義と自由主義",     questions.js の SCHOOLS にある18個のどれか
     "note": "…",                       一覧に出る一言
     "years_src": "…",                  生没年を確認した資料の一行
     "place": "ケンブリッジ",            主な活動地。1語
     "intro": "…",                      60〜100字。出身・経歴。事実だけ
     "thought": "…",                    80〜120字（根拠が1問なら下限50）
     "thought_src": ["q792","q793"],    根拠にする問題の id
     "works": [ { "title": "倫理学の方法", "year": 1874 } ],   3冊まで・年代順
     "checked": true
   }

   検査（実行の前に全部見て、1件でも欠ければ4か所とも1文字も書かずに止まる）:
     必須項目と型／既存の人物との重複（4か所とも）／学派の綴り／
     生没年の形と引用行との突き合わせ／読み・活動地／intro と thought の字数／
     評価語／著作の冊数と年代順。
   字数・評価語・読みの基準は tools/_lib.js にあり、check_phil.js と同じものを読む。

   **thought_src の問題が実在するかは見ない。**この道具は作問より前に走るので、
   その時点では問題がまだ無い（形だけ見て、未作成なら数を表示する）。
   実在は add_batch.js の末尾で check_phil が見る。

   **--dry-run は無い。**この道具の直後に check_phil は通らない
   （thought_src の問題がまだ無く、「全員に問題がある」も落ちる）ので、
   書いて検査して戻す形が成り立たない。確かめはサンドボックス（第2引数）で行う。

   **新しい学派に置くときは、先に人が questions.js の SCHOOLS を直すこと。**
   綴りが1字でも違うとどの学派タブからも辿れない人物ができるので、
   この道具は SCHOOLS に無い学派を受け付けない。
*/
"use strict";
const fs = require("fs");
const path = require("path");
/* 読み書きは _lib.js の部品を使う（一時ファイル経由・やり直しつき。2026-09-23 に替えた） */
const { L, readJson, writeJson, PHIL, matchYears, readFileSafe, writeFileSafe } = require("./_lib.js");

const [, , INPUT, DIR] = process.argv;
if (!INPUT) {
  console.error("使い方: node tools/add_person.js <入力.json> [<ディレクトリ>]");
  process.exit(1);
}
const R = DIR || path.join(__dirname, "..");
const P = f => path.join(R, f);
const S = s => JSON.stringify(s);

const p = readJson(INPUT);

/* ================= 読み込み ================= */
const qsrc = readFileSafe(P("questions.js"), "utf8");
const psrc = readFileSafe(P("philosophers.js"), "utf8");
const { SCHOOLS, PHILOSOPHERS, QUESTIONS } =
  new Function(qsrc + ";return {SCHOOLS,PHILOSOPHERS,QUESTIONS};")();
const { PHIL_INTRO } = new Function(psrc + ";return {PHIL_INTRO};")();
const ysrc = readJson(P("tools/years_src.json"));
const kt = readJson(P("keyterms.json"));

/* ================= 検査（書き込みの前） ================= */
const bad = [];
const w = m => bad.push(m);
const str = (k, label) => {
  if (typeof p[k] !== "string" || !p[k]) { w(`「${k}」（${label}）が無い、または文字列でない`); return false; }
  return true;
};

/* --- 必須項目と型 --- */
const okName = str("name", "名前");
str("note", "一覧に出る一言");
const okYomi = str("yomi", "読み");
const okYears = str("years", "生没年");
const okSchool = str("school", "学派");
const okYsrc = str("years_src", "生没年の引用行");
const okPlace = str("place", "主な活動地");
const okIntro = str("intro", "経歴");
const okThought = str("thought", "中心の問い");
if (p.checked !== true)
  w("「checked」が true でない（false のものは画面に出ず、check_phil も落ちる）");

/* --- 既存の人物との重複。4か所とも見る --- */
if (okName) {
  if (PHILOSOPHERS.some(x => x.name === p.name)) w(`PHILOSOPHERS に「${p.name}」が既にいる`);
  if (PHIL_INTRO.some(x => x.name === p.name)) w(`PHIL_INTRO に「${p.name}」が既にいる`);
  if (ysrc[p.name]) w(`tools/years_src.json に「${p.name}」が既にいる`);
  if (kt[p.name]) w(`keyterms.json（台帳）に「${p.name}」が既にいる`);
}

/* --- 学派の綴り。SCHOOLS に完全一致するものだけを通す --- */
if (okSchool && !SCHOOLS.includes(p.school))
  w(`学派「${p.school}」が questions.js の SCHOOLS に無い。`
    + `綴りが違うと、どの学派タブからも辿れない人物になる。\n`
    + `       新しい学派に置くなら、先に SCHOOLS を人が直すこと（CLAUDE.md「学派（棚）の決め方」）。\n`
    + `       いまある18個: ${SCHOOLS.join("／")}`);

/* --- 生没年の形。区切りは全角ダッシュ（–, U+2013）。ハイフンと見分けがつかない --- */
const YEARS_RE = /^前?[0-9]+頃?–(前?[0-9]+頃?)?$/;
if (okYears && !YEARS_RE.test(p.years)) {
  const 紛れ = ["-", "‐", "―", "ー", "〜", "~"].filter(c => p.years.includes(c));
  w(`生没年「${p.years}」が形に合っていない（例: 1838–1900／前469–前399／205頃–270／1937–）`
    + (紛れ.length ? `\n       区切りに ${紛れ.map(c => `「${c}」`).join("")} が混ざっている。正しいのは全角ダッシュ「–」` : ""));
}

/* --- 生没年と引用行の突き合わせ。check_phil の項目7と同じ判定を前倒しで行う。
       判定そのものは _lib.js の matchYears にあり、check_phil.js と同じものを読む --- */
if (okYears && okYsrc && YEARS_RE.test(p.years)) {
  const { inQuote, 合わない } = matchYears(p.years, p.years_src);
  if (合わない.length)
    w(`生没年の ${合わない.join("・")} が引用行に出てこない`
      + `（引用行の年: ${inQuote.join(",") || "なし"}）。check_phil の項目7が同じ判定で落とす`);
}

/* --- 読みと活動地 --- */
if (okYomi && !PHIL.YOMI_RE.test(p.yomi))
  w(`読み「${p.yomi}」がひらがなでない（カタカナ・漢字・英字は入れない。長音符と中黒は使える）`);
if (okPlace && /\s/.test(p.place))
  w(`活動地「${p.place}」に空白が入っている（1語で書く）`);

/* --- 字数。基準は _lib.js。check_phil と同じものを読む --- */
if (okIntro && (L(p.intro) < PHIL.INTRO_MIN || L(p.intro) > PHIL.INTRO_MAX))
  w(`intro が${L(p.intro)}字（${PHIL.INTRO_MIN}〜${PHIL.INTRO_MAX}字に収める）`);
const srcOk = Array.isArray(p.thought_src) && p.thought_src.length > 0;
if (okThought) {
  const 下限 = PHIL.thoughtMin(p.thought_src);
  if (L(p.thought) < 下限 || L(p.thought) > PHIL.THOUGHT_MAX)
    w(`thought が${L(p.thought)}字（下限${下限}・上限${PHIL.THOUGHT_MAX}に収める`
      + `${srcOk && p.thought_src.length === 1 ? "。根拠が1問なので下限は緩めてある" : ""}）`);
}

/* --- 評価語。事実だけを書く決まり --- */
["intro", "thought"].forEach(k => {
  if (typeof p[k] !== "string") return;
  const hit = PHIL.NG.filter(ng => p[k].includes(ng));
  if (hit.length) w(`${k} に評価語が入っている: ${hit.join("、")}（事実だけを書く）`);
});

/* --- 根拠の id。形だけ見る。実在はこの時点では見られない --- */
if (!srcOk) w("「thought_src」が問題 id の配列でない（1件でも配列にする）");
else p.thought_src.forEach(id => {
  if (typeof id !== "string" || !/^q[0-9]+$/.test(id)) w(`thought_src の「${id}」が q+数字でない`);
});

/* --- 著作 --- */
if (!Array.isArray(p.works) || !p.works.length) w("「works」が配列でない（1冊でも配列にする）");
else {
  if (p.works.length > 3) w(`works が${p.works.length}冊（3冊まで）`);
  p.works.forEach((b, i) => {
    if (!b || typeof b !== "object") return w(`works[${i}] が object でない`);
    if (typeof b.title !== "string" || !b.title) w(`works[${i}]: 「title」が無い`);
    if (b.year !== undefined && !Number.isInteger(b.year)) w(`works[${i}]（${b.title}）: 「year」が整数でない`);
  });
  const ys = p.works.filter(b => b && b.year).map(b => b.year);
  if (ys.some((y, i) => i && y < ys[i - 1])) w(`works が年代順でない（${ys.join("→")}）`);
}

if (bad.length) {
  console.error(`入力が形式に合っていない。4か所とも1文字も書き込んでいない:\n  ` + bad.join("\n  "));
  process.exit(1);
}

/* ================= 組み立て（まだ書かない） =================
   4か所とも先に文字列を作り、最後にまとめて書く。
   途中で位置が見つからずに止まったとき、半分だけ書かれた状態にしないため。 */

/* 配列の末尾へ1件足す。`const 名前 = [ … \n];` の最後の要素の後ろに「,」と改行で継ぐ。
   差し込み位置を既存の行の文字列で探すと、その行が直されたとたんに止まる。 */
function appendToArray(src, 名前, 追加, ラベル) {
  const m = src.match(new RegExp("const " + 名前 + " = \\[[\\s\\S]*?\\n\\];"));
  if (!m) throw new Error(`${ラベル} が見つからない`);
  const block = m[0];
  const closed = block.slice(0, block.lastIndexOf("\n];"));
  return src.replace(block, closed + ",\n" + 追加 + "\n];");
}

/* ---- 1. questions.js の PHILOSOPHERS ---- */
const 一覧行 = `  { name: ${S(p.name)}, years: ${S(p.years)}, note: ${S(p.note)}, school: ${S(p.school)} }`;
const qOut = appendToArray(qsrc, "PHILOSOPHERS", 一覧行, "PHILOSOPHERS");

/* ---- 2. philosophers.js の PHIL_INTRO ---- */
const 著作行 = p.works.map(b =>
  `      { title: ${S(b.title)}${b.year !== undefined ? `, year: ${b.year}` : ""} }`).join(",\n");
const 紹介 = `  {
    name: ${S(p.name)},
    yomi: ${S(p.yomi)},
    place: ${S(p.place)},
    intro: ${S(p.intro)},
    thought: ${S(p.thought)},
    thought_src: [${p.thought_src.map(S).join(",")}],
    works: [
${著作行}
    ],
    checked: true
  }`;
const pOut = appendToArray(psrc, "PHIL_INTRO", 紹介, "PHIL_INTRO");

/* ---- 3. tools/years_src.json の引用行 ---- */
ysrc[p.name] = p.years_src;

/* ---- 4. keyterms.json の人物エントリ（器だけ。鍵語は作問バッチが入れる） ----
   学派は入力の1か所から入れる。問題数は add_batch.js が数え直すので 0 でよい。 */
kt[p.name] = { "学派": p.school, "問題数": 0, "鍵語": [] };

/* ================= 書き込み ================= */
writeFileSafe(P("questions.js"), qOut, "utf8");
console.log(`○ questions.js の PHILOSOPHERS に追加（${p.name}／${p.school}）`);
writeFileSafe(P("philosophers.js"), pOut, "utf8");
console.log(`○ philosophers.js の PHIL_INTRO に追加（紹介の欄。intro ${L(p.intro)}字／thought ${L(p.thought)}字）`);
writeJson(P("tools/years_src.json"), ysrc);
console.log("○ tools/years_src.json に引用行を追加");
writeJson(P("keyterms.json"), kt);
console.log("○ keyterms.json に人物エントリを追加（鍵語は空）");

/* 作問より前に走るので、thought_src の問題はまだ無いのが普通。数だけ出す。 */
const 未作成 = p.thought_src.filter(id => !QUESTIONS.some(q => q.id === id));
if (未作成.length)
  console.log(`\n  （thought_src の ${未作成.join("・")} はまだ作られていない。`
    + `このあとの作問バッチで作ること。実在は check_phil が見る）`);

console.log("\n→ 4か所とも入った。このあと add_batch.js を走らせる。");
