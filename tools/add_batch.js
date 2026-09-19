/* 作問と detail 追記を、1つの入力から一続きで適用する固定の道具。
   使い方:
     node tools/add_batch.js <入力.json>            適用して検査まで走る
     node tools/add_batch.js <入力.json> --dry-run  適用・検査したあと必ず差し戻す

   これまで点検のたびに apply2.js / apply2b.js / apply3.js / measure.js / progress.js を
   書き直していたが、同じ失敗を繰り返したので固定の道具にまとめた。理由は CLAUDE.md の
   「作問と追記の道具を毎回書き直さない」の節に書いてある。

   入力の形（スキーマは validate() で実行前に検査し、違えば1問も書かずに止まる）:
   {
     "作問": [ { id, philosophers[], terms[], keys[], question, choices[4],
                 answer(0始まりの番号), explanation, detail, note, refs[], 許可? } ],
                 許可 は、選択肢の長さが「作問の指針」の4つの数字から外れる作問、位置指しが残る作問、
                 detail が上限370字を超える作問を通すときだけ書く理由。
                 書かなければ、その逸脱は「要判断」として報告し、1問も書かずに止める。
                 書けば通し、理由を note に自動で残す（2026-09-19 に足した）。
     "追記": [ { id, 対象?, find, replace, note_add, keys_add[], refs_add?, 許可? } ],
                 対象 は "detail"（既定）か "explanation"。2026-09-18 に足した。
                 explanation にも位置で選択肢を指す句が残っていたため。
                 字数と段落の検査は detail のときだけ働く（explanation に字数の型は無い）。
                 find の一意性の検査と note への自動記録は、どちらの対象でも働く。
                 許可 は、上限370字を超える追記や、3段落にならない追記を通すときだけ書く理由。
                 書かなければ、その逸脱は「要判断」として報告し、1件も書かずに差し戻す。
                 書けば通し、理由を note に自動で残す（2026-09-18 に throw から変えた）。
     "鍵語": {
       "作問由来": { "人物": [ {語, 読み, 追加} ] },
       "追記由来": { "人物": [ {語, 読み, 追加} ] }
     },
     "台帳": {                          点検の結果を台帳へ書き戻す（作問・追記より先に走る）
       "対象": ["人物", …],             扱いと数値を見直す人物
       "刻印": "いつ何で判定したか",      扱いを設定した語の「確認」欄に入る
       "扱い": {
         "主題": { "人物": ["語", …] },  値は主題・説明あり・言及・未登場のどれか
         "理由": { "語": "なぜそう判じたか" }
       },
       "ずれの記録": { "語": "数えすぎ／数え漏らしの型" },
       "改名": { "人物": [ {旧, 新, 読み, 理由} ] },
       "新規登録": { "人物": [ {語, 読み, 付ける先:["qNNN",…], 追加} ] }
     }
   }

   台帳モードだけを走らせることもできる（"作問" と "追記" を空にする）。
   hits／全問は入力に書かない。道具が本文を数えて実測を入れる。
   問題数も同じで、走らせるたびに全員分を数え直して上書きする。
   hits／全問も同じで、対象に載せた人物だけでなく台帳の全語を数え直す。
   この実測は台帳モードだけでなく、作問・追記どのモードでも末尾で必ず走る。

   やること（この順序で、どこかで落ちたら全ファイルを差し戻して終了コード1）:
     0. 入力のスキーマ検査（書き込みの前）
     1. 鍵語の語形が本文に出るかの総点検（書き込みの前。作問由来は草稿の本文、
        追記由来は replace 後の本文で見る）
     1.5 選択肢の長さと位置指しの検査（書き込みの前。作問の指針の4つの数字を見る）
     1.6 作問の detail の字数の検査（書き込みの前。上限370字。追記と同じ数え方で測る）
     2. questions.js へ作問を追記
     3. detail 追記（本文・note・keys・refs）。字数は書き込んだあとに実測して note に足す
     4. keyterms.json / tools/keys_draft.json / index.html の KEY_YOMI へ鍵語を登録
     5. philosophers.js の KEY_OWNER を再生成
     6. node --check → check_keys → check_phil → coverage → progress

   coverage.js は数字を出すだけで合否を終了コードで返さない。ここでも実行はするが、
   落ちたかどうかは見ない（node 自体の実行エラーだけを拾う）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const R = path.join(__dirname, "..");
const P = f => path.join(R, f);
const S = s => JSON.stringify(s);
const L = s => [...s].length;

/* detail の字数は改行を除いて数える。作問の検査（1.6）と追記の検査（3）が同じ関数を使う。
   数え方を2つ持つと、同じ本文が道具のどこで測られたかで違う字数になる。
   2026-09-19 に applyAppends から切り出した。 */
const LIMIT = 370;
const detailLen = s => L(String(s).replace(/\n/g, ""));

const [, , INPUT, ...FLAGS] = process.argv;
const DRY = FLAGS.includes("--dry-run");
if (!INPUT) { console.error("使い方: node tools/add_batch.js <入力.json> [--dry-run]"); process.exit(1); }

/* 差し戻しの対象。gen_key_owner は philosophers.js を、progress は CLAUDE.md を書き換える。 */
const TOUCHED = ["questions.js", "keyterms.json", "index.html", "philosophers.js",
  "CLAUDE.md", path.join("tools", "keys_draft.json")];

const QUESTIONS_OF = src => new Function(src + "\n;return {QUESTIONS};")().QUESTIONS;
const readQ = () => QUESTIONS_OF(fs.readFileSync(P("questions.js"), "utf8"));
const bodyOf = q => [q.question || "", (q.choices || []).join(" / "), q.explanation || "", q.detail || ""].join(" ");

/* ================= 0. 入力のスキーマ ================= */
function validate(input) {
  const bad = [];
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (!input || typeof input !== "object") bad.push("入力が object でない");
  const saku = input["作問"] || [], tsui = input["追記"] || [], keys = input["鍵語"] || {};
  if (!Array.isArray(saku)) bad.push("「作問」が配列でない");
  if (!Array.isArray(tsui)) bad.push("「追記」が配列でない");
  if (typeof keys !== "object") bad.push("「鍵語」が object でない");

  const seen = new Set();
  saku.forEach((d, i) => {
    const w = m => bad.push(`作問[${i}]${d && d.id ? "（" + d.id + "）" : ""}: ${m}`);
    if (!d || typeof d !== "object") return w("object でない");
    if (typeof d.id !== "string" || !/^q\d+$/.test(d.id)) w("id が q+数字でない");
    if (seen.has(d.id)) w("id が重複している"); else seen.add(d.id);
    if (!Array.isArray(d.philosophers) || !d.philosophers.length) w("philosophers が配列でない（1人でも配列にする）");
    else d.philosophers.forEach(p => { if (typeof p !== "string") w("philosophers に文字列でないものがある"); });
    if (!Array.isArray(d.terms) || !d.terms.length) w("terms が配列でない");
    if (!Array.isArray(d.keys) || !d.keys.length) w("keys が配列でない");
    if (typeof d.question !== "string" || !d.question) w("question が無い");
    if (!Array.isArray(d.choices) || d.choices.length !== 4) w("choices が4つでない");
    else if (new Set(d.choices).size !== 4) w("choices に同じ文が混ざっている");
    /* ここが毎回間違えたところ。answer は選択肢の本文ではなく0始まりの番号。 */
    if (typeof d.answer !== "number" || !Number.isInteger(d.answer) || d.answer < 0 || d.answer > 3)
      w("answer が0〜3の整数でない（選択肢の本文を書いていないか）");
    if (typeof d.explanation !== "string" || !d.explanation) w("explanation が無い");
    if (typeof d.detail !== "string" || !d.detail) w("detail が無い");
    else if (d.detail.split(/\n\n+/).length !== 3) w("detail が3段落でない");
    if (typeof d.note !== "string" || !d.note) w("note が無い");
    if (!Array.isArray(d.refs)) w("refs が配列でない（空でよいが省略はしない）");
    if (d["許可"] !== undefined && (typeof d["許可"] !== "string" || !d["許可"]))
      w("「許可」は理由を書いた文字列にする（選択肢の長さ、または位置指しが指針から外れる作問を通すときだけ書く）");
  });

  const seenT = new Set();
  tsui.forEach((it, i) => {
    const w = m => bad.push(`追記[${i}]${it && it.id ? "（" + it.id + "）" : ""}: ${m}`);
    if (!it || typeof it !== "object") return w("object でない");
    if (typeof it.id !== "string") w("id が無い");
    if (seenT.has(it.id)) w("同じ id への追記が2件ある"); else seenT.add(it.id);
    if (typeof it.find !== "string" || !it.find) w("find が無い");
    if (typeof it.replace !== "string" || !it.replace) w("replace が無い");
    if (it.find === it.replace) w("find と replace が同じ");
    if (typeof it.note_add !== "string" || !it.note_add) w("note_add が無い");
    /* 予定字数は書かせない。書き込んだあとに実測して足す。 */
    if (/→\s*\d+字|余地\s*-?\d+字/.test(it.note_add))
      w("note_add に字数が書かれている（字数は道具が実測して足すので書かない）");
    if (it.keys_add !== undefined && !Array.isArray(it.keys_add)) w("keys_add が配列でない");
    if (it.refs_add !== undefined && typeof it.refs_add !== "string") w("refs_add が文字列でない");
    if (it["許可"] !== undefined && (typeof it["許可"] !== "string" || !it["許可"]))
      w("「許可」は理由を書いた文字列にする（上限を超える追記・3段落にならない追記を通すときだけ書く）");
    if (it["対象"] !== undefined && it["対象"] !== "detail" && it["対象"] !== "explanation")
      w("「対象」は detail か explanation にする（省略すると detail）");
  });

  /* 台帳モード。作問も追記も無く、台帳だけを整える入力もありうる。 */
  const led = input["台帳"];
  if (led !== undefined) {
    const w = m => bad.push(`台帳: ${m}`);
    if (typeof led !== "object" || Array.isArray(led)) w("object でない");
    else {
      if (!Array.isArray(led["対象"]) || !led["対象"].length) w("「対象」が人物名の配列でない");
      if (led["刻印"] !== undefined && typeof led["刻印"] !== "string") w("「刻印」が文字列でない");
      const 扱い = led["扱い"];
      if (扱い !== undefined) {
        if (typeof 扱い !== "object") w("「扱い」が object でない");
        else for (const v of Object.keys(扱い)) {
          if (v === "理由") { if (typeof 扱い[v] !== "object") w("扱い.理由 が object でない"); continue; }
          for (const person of Object.keys(扱い[v]))
            if (!Array.isArray(扱い[v][person])) w(`扱い.${v}.${person} が配列でない`);
        }
      }
      for (const person of Object.keys(led["改名"] || {})) {
        if (!Array.isArray(led["改名"][person])) { w(`改名.${person} が配列でない`); continue; }
        led["改名"][person].forEach((r, i) => {
          for (const k of ["旧", "新", "読み", "理由"])
            if (typeof r[k] !== "string" || !r[k]) w(`改名.${person}[${i}]: 「${k}」が無い`);
          /* 改名は5か所（台帳・読み・q.keys・keys_draft・KEY_YOMI）を揃えて直すので読みが要る */
        });
      }
      for (const person of Object.keys(led["新規登録"] || {})) {
        if (!Array.isArray(led["新規登録"][person])) { w(`新規登録.${person} が配列でない`); continue; }
        led["新規登録"][person].forEach((s, i) => {
          for (const k of ["語", "読み", "追加"])
            if (typeof s[k] !== "string" || !s[k]) w(`新規登録.${person}[${i}]: 「${k}」が無い`);
          if (!Array.isArray(s["付ける先"]) || !s["付ける先"].length)
            w(`新規登録.${person}[${i}]（${s["語"] || "?"}）: 「付ける先」が問題 id の配列でない`);
        });
      }
      for (const person of Object.keys(led["扱いの変更"] || {})) {
        if (!Array.isArray(led["扱いの変更"][person])) { w(`扱いの変更.${person} が配列でない`); continue; }
        led["扱いの変更"][person].forEach((r, i) => {
          for (const k of ["語", "旧", "新", "理由"])
            if (typeof r[k] !== "string" || !r[k]) w(`扱いの変更.${person}[${i}]: 「${k}」が無い`);
        });
      }
      for (const person of Object.keys(led["keysから外す"] || {})) {
        if (!Array.isArray(led["keysから外す"][person])) { w(`keysから外す.${person} が配列でない`); continue; }
        led["keysから外す"][person].forEach((s, i) => {
          for (const k of ["語", "理由"])
            if (typeof s[k] !== "string" || !s[k]) w(`keysから外す.${person}[${i}]: 「${k}」が無い`);
          if (!Array.isArray(s["外す先"]) || !s["外す先"].length)
            w(`keysから外す.${person}[${i}]（${s["語"] || "?"}）: 「外す先」が問題 id の配列でない`);
        });
      }
      if (led["ずれの記録"] !== undefined && typeof led["ずれの記録"] !== "object")
        w("「ずれの記録」が object でない");
    }
  }
  if (!saku.length && !tsui.length && led === undefined)
    bad.push("作問も追記も台帳も無い（何もすることがない）");

  for (const 由来 of ["作問由来", "追記由来"]) {
    const g = keys[由来] || {};
    if (typeof g !== "object") { bad.push(`鍵語.${由来} が object でない`); continue; }
    for (const person of Object.keys(g)) {
      if (!Array.isArray(g[person])) { bad.push(`鍵語.${由来}.${person} が配列でない`); continue; }
      g[person].forEach((s, i) => {
        const w = m => bad.push(`鍵語.${由来}.${person}[${i}]: ${m}`);
        if (typeof s["語"] !== "string" || !s["語"]) w("「語」が無い");
        if (typeof s["読み"] !== "string" || !s["読み"]) w("「読み」が無い");
        if (typeof s["追加"] !== "string" || !s["追加"]) w("「追加」（登録の理由）が無い");
      });
    }
  }
  if (bad.length) {
    console.error("入力が形式に合っていない。1件も書き込んでいない:\n  " + bad.join("\n  "));
    process.exit(1);
  }
  return { saku, tsui, keys, led };
}

/* ================= 1. 鍵語の語形の総点検（書き込みの前） ================= */
function auditKeyForms(saku, tsui, keys, existing) {
  /* 作問由来: その語を持つ草稿の本文に出るか。
     追記由来: 追記後の本文（replace 済み）に出るか。
     どちらも「本人の問題に出るか」まで見る。apply3.js が書き込みの途中で止まっていた検査を、
     書き込みの前へ移したもの。 */
  const ng = [];
  const draftText = {};
  for (const d of saku) draftText[d.id] = { ph: d.philosophers, t: bodyOf(d) };
  const afterAppend = {};
  for (const it of tsui) {
    const q = existing.find(x => x.id === it.id);
    if (!q) { ng.push(`追記先が無い: ${it.id}`); continue; }
    /* 2026-09-18 に対象フィールド（detail／explanation）へ対応させた。
       applyAppends だけを直してこの事前検査を直し忘れ、explanation への追記9件が
       すべて「detail に find が無い」で止まった。対象を見る箇所は2つある。 */
    const fld = it["対象"] || "detail";
    if (typeof q[fld] !== "string" || !q[fld]) { ng.push(`追記先の ${fld} が無い: ${it.id}`); continue; }
    if (q[fld].indexOf(it.find) < 0) { ng.push(`追記先の ${fld} に find が無い: ${it.id}`); continue; }
    if (q[fld].indexOf(it.find) !== q[fld].lastIndexOf(it.find)) { ng.push(`find が一意でない: ${it.id}`); continue; }
    const nd = q[fld].replace(it.find, it.replace);
    afterAppend[it.id] = { ph: q.philosophers || [], t: bodyOf(Object.assign({}, q, { [fld]: nd })), detail: fld === "detail" ? nd : q.detail };
  }

  const rows = [];
  for (const 由来 of ["作問由来", "追記由来"]) {
    const g = (keys[由来] || {});
    for (const person of Object.keys(g)) for (const spec of g[person]) {
      const w = spec["語"];
      let where = [];
      if (由来 === "作問由来") {
        for (const id of Object.keys(draftText))
          if (draftText[id].ph.includes(person) && draftText[id].t.includes(w)) where.push(id);
      } else {
        for (const id of Object.keys(afterAppend))
          if (afterAppend[id].ph.includes(person) && afterAppend[id].t.includes(w)) where.push(id);
      }
      /* 既に本文にある場合（既存問題で使われている語）も拾う */
      if (!where.length)
        for (const q of existing)
          if ((q.philosophers || []).includes(person) && bodyOf(q).includes(w)) { where.push(q.id + "(既存)"); break; }
      rows.push([由来, person, w, where]);
      if (!where.length) ng.push(`本文に語が無い: ${person}／${w}（${由来}）`);
    }
  }
  console.log("■ 鍵語の語形の総点検（書き込みの前）");
  for (const [由来, person, w, where] of rows)
    console.log(`  ${where.length ? "○" : "★"} ${person}／${w}　${由来}　${where.length ? where.join("・") : "どこにも出ない"}`);
  if (ng.length) { console.error("\n書き込みを始めていない。直してからやり直す:\n  " + ng.join("\n  ")); process.exit(1); }
  console.log(`  → ${rows.length}語すべてが本文に出る\n`);
  return { afterAppend };
}

/* ================= 1.1 keys 全部の語形の検査（書き込みの前） =================
   上の総点検は「その実行で新しく登録する語」しか見ない。だから既存の語を keys に足すと
   検査の対象外になり、CLAUDE.md③（語が本文に無いまま keys に付けない）に触れていても通る。

   2026-09-19 の二十世紀の政治哲学の点検・第2回で、草案の q765 に「感性的なものの分割」、
   q766 に「出来事への忠実」を付けていた。どちらも既存の語で、その問題の本文には無い。
   道具は素通りし、書き手が手で数えて拾った。実測すると、既存761問でも
   keys 延べ1457件のうち50件（45問・49語）が同じ状態にある。

   だから対象を「その実行で書き込む問題の keys 全部」に広げる。
   作問は d.keys の全件、追記は keys_add の全件を、その問題の本文と突き合わせる。
   逸脱は throw ではなく「要判断」で一覧報告し、1件も書かずに止める。
   入力に「許可」欄があるときだけ通し、理由を note へ自動で書き込む。
   選択肢の長さ・位置指しとまったく同じ扱いである。

   既存の50件はこの検査では止まらない。書き込む問題だけを見るためで、
   全問を対象にする項目は check_keys の側に置く（50件を片づけてから有効にする）。 */
function auditKeysInBody(saku, tsui, afterAppend) {
  if (!saku.length && !tsui.length) return;
  const 要判断 = [];
  let 例外 = 0, 件数 = 0;
  console.log("■ keys の語が本文に出るかの検査（書き込みの前）");
  const 見る = (obj, id, keys, text, 種別) => {
    const 欠け = (keys || []).filter(k => !text.includes(k));
    件数 += (keys || []).length;
    const mark = 欠け.length ? (obj["許可"] ? "△" : "★") : "○";
    console.log(`  ${mark} ${id}　${種別}　${(keys || []).length}語` +
      (欠け.length ? `／本文に無い: ${欠け.join("・")}` : "") +
      (欠け.length && obj["許可"] ? "　許可つきで通す" : ""));
    if (!欠け.length) return;
    if (!obj["許可"]) { 要判断.push(`${id}: ${欠け.join("・")} が本文に無い`); return; }
    例外++;
    const 文 = ` 型の例外として通した（keys に本文へ出ない語: ${欠け.join("・")}）。理由: ${obj["許可"]}`;
    if (種別 === "作問") obj.note = obj.note + 文; else obj.note_add = obj.note_add + 文;
  };
  for (const d of saku) 見る(d, d.id, d.keys, bodyOf(d), "作問");
  for (const it of tsui) {
    if (!it.keys_add || !it.keys_add.length) continue;
    const a = afterAppend && afterAppend[it.id];
    if (!a) continue;   /* 追記先が無い等は上の総点検が既に止めている */
    見る(it, it.id, it.keys_add, a.t, "追記");
  }
  if (要判断.length) {
    console.error("\n要判断（1件も書いていない）:\n  " + 要判断.join("\n  ") +
      "\n  語が本文に無いまま keys に付けない（CLAUDE.md③）。" +
      "\n  どちらかを選ぶ: その語を keys から外すか、初出併記などで本文に出すか、" +
      "\n  内容の側に理由があるなら「許可」欄（理由）を足して通す。");
    process.exit(1);
  }
  console.log(例外
    ? `  → ${件数}語を検査し、${例外}件は許可つきで通した（本文に出ない語が残っている）\n`
    : `  → ${件数}語すべてが、その問題の本文に出る\n`);
}

/* ================= 1.2 選択肢の長さの検査（書き込みの前） =================
   CLAUDE.md の「作問の指針（選択肢の長さ）」の4つの数字を、道具の側で見る。
   2026-09-19 に足した。それまで道具が見ていたのは detail の字数と段落だけで、
   選択肢の均衡は4つとも書き手の手計算に頼っていた。q727 が「2位との差5字」のまま
   dry-run を通り、書き手が別に数えていたから拾えた、という一件が直接のきっかけである。

   4つを同時に足した理由。一つだけ足すと「道具が見てくれている」という誤解が残り、
   残り3つの取りこぼしは、その誤解のぶんだけ見つかりにくくなる。

   逸脱は throw ではなく「要判断」として一覧で報告し、1問も書かずに止める。
   入力にその作問の「許可」欄（理由）があるときだけ通し、理由を note へ自動で書き込む。
   追記の上限370字とまったく同じ扱いである。

   「32字前後」と「0.8倍」には幅が要る。指針は幅を書いていないので、ここで決めた。
   下の2つは指針がそのまま上限を書いているので、幅を足さずにその数字で見る。 */
const ANS_MIN = 28, ANS_MAX = 36, AVG_LO = 0.7, AVG_HI = 0.9, GAP_MAX = 4, RATIO_MAX = 1.3;
function auditChoiceBalance(saku) {
  if (!saku.length) return;
  const 要判断 = [];
  let 例外 = 0;
  console.log("■ 選択肢の長さの検査（書き込みの前）");
  for (const d of saku) {
    const ans = L(d.choices[d.answer]);
    const wrong = d.choices.filter((_, i) => i !== d.answer).map(L);
    const avg = wrong.reduce((a, b) => a + b, 0) / wrong.length;
    const second = Math.max(...wrong);
    const gap = ans - second, ratio = ans / avg;
    const 逸脱 = [];
    if (ans < ANS_MIN || ans > ANS_MAX)
      逸脱.push(`正解が${ans}字（目安32字前後・${ANS_MIN}〜${ANS_MAX}字）`);
    if (avg < ans * AVG_LO || avg > ans * AVG_HI)
      逸脱.push(`誤答平均が正解の${(avg / ans).toFixed(2)}倍（目安0.8倍・${AVG_LO}〜${AVG_HI}倍）`);
    if (gap > GAP_MAX) 逸脱.push(`2位との差が${gap}字（上限${GAP_MAX}字）`);
    if (ratio > RATIO_MAX) 逸脱.push(`比率が${ratio.toFixed(2)}倍（上限${RATIO_MAX}倍）`);
    const mark = 逸脱.length ? (d["許可"] ? "△" : "★") : "○";
    console.log(`  ${mark} ${d.id}　正解${ans}字／誤答平均${avg.toFixed(1)}字（${(avg / ans).toFixed(2)}倍）` +
      `／2位との差${gap}字／比率${ratio.toFixed(2)}倍` +
      (逸脱.length && d["許可"] ? "　許可つきで通す" : ""));
    if (逸脱.length) {
      if (!d["許可"]) 要判断.push(`${d.id}: ${逸脱.join("・")}`);
      else { 例外++; d.note = d.note + ` 型の例外として通した（${逸脱.join("・")}）。理由: ${d["許可"]}`; }
    }
  }
  if (要判断.length) {
    console.error("\n要判断（1問も書いていない）:\n  " + 要判断.join("\n  ") +
      "\n  どちらかを選ぶ: 選択肢を書き直して型に収めるか、その作問に「許可」欄（理由）を足して通す。" +
      "\n  型は結果として揃ったものであって、内容より優先される規則ではない。");
    process.exit(1);
  }
  console.log(例外
    ? `  → ${saku.length}問を検査し、${例外}問は許可つきで通した（指針の外側のまま通っている）
`
    : `  → ${saku.length}問すべてが指針の内側
`);
}

/* ================= 1.3 位置指しの検出（書き込みの前） =================
   detail と explanation が、選択肢を位置で指していないかを見る。
   2026-09-19 に足した。プラグマティズムの点検で作った12問が12問とも
   「一番目は…」「三番目と四番目は…」の形で書かれていて、人の目では止まらなかった。

   なぜ止めるか。出題側は選択肢をシャッフルするので、位置で指すと指す先が変わる。
   本文が別の選択肢を説明することになり、解説そのものが誤りになる。
   中身を主語にして書けば、並びが変わっても壊れない。

   引っかからない場合（数える前に書き出す）。
     ・番号を使わない位置指し（「はじめの選択肢」「残りの二つ」）。前者だけ拾う
     ・「前者」「後者」。比較問題で人物を指すぶんには正しい用法なので、あえて外した

   引っかかりすぎる場合。
     ・内容としての序数。q071 の「イデアから数えて三番目」、魂の三分説の順序など。
       この型のために許可欄を置く。逸脱は throw ではなく「要判断」で報告し、
       1問も書かずに差し戻す。選択肢の長さの検査とまったく同じ扱いである。 */
const POS_RE = /[一二三四１２３４1234]番目|はじめの選択肢|最初の選択肢/g;
function auditPositional(saku) {
  if (!saku.length) return;
  const 要判断 = [];
  let 例外 = 0;
  console.log("■ 位置指しの検査（書き込みの前）");
  for (const d of saku) {
    const hits = [];
    for (const fld of ["detail", "explanation"]) {
      const m = String(d[fld] || "").match(POS_RE);
      if (m) hits.push(`${fld}: ${[...new Set(m)].join("・")}`);
    }
    const mark = hits.length ? (d["許可"] ? "△" : "★") : "○";
    console.log(`  ${mark} ${d.id}　${hits.length ? hits.join("／") : "位置指しなし"}`);
    if (hits.length) {
      if (!d["許可"]) 要判断.push(`${d.id}: ${hits.join("／")}`);
      else {
        例外++;
        d.note = d.note + ` 型の例外として通した（位置指し: ${hits.join("／")}）。理由: ${d["許可"]}`;
      }
    }
  }
  if (要判断.length) {
    console.error("\n要判断（1問も書いていない）:\n  " + 要判断.join("\n  ") +
      "\n  出題側は選択肢をシャッフルするので、位置で指すと指す先が変わる。" +
      "\n  どちらかを選ぶ: 選択肢の中身を主語にして書き直すか、内容としての序数なら「許可」欄（理由）を足して通す。");
    process.exit(1);
  }
  console.log(例外
    ? `  → ${saku.length}問を検査し、${例外}問は許可つきで通した（位置指しが残っている）\n`
    : `  → ${saku.length}問とも位置指しなし\n`);
}

/* ================= 1.6 作問の detail の字数（書き込みの前） =================
   detail が上限370字を超えていないかを見る。2026-09-19 に足した。

   なぜ足したか。「功利主義と自由主義」の点検で作った10問のうち、
   q779 が410字、q785 が396字で上限を超えていたのに dry-run が素通りした。
   それまで字数を見ていたのは追記側だけで、作問の detail は誰も測っていなかった。
   書き手が別に数えて拾ったが、q727 の選択肢の均衡とまったく同じ型である。
   検査があると思われている場所に穴があると、そのぶん見つかりにくくなる。

   数え方は追記の検査と同じ detailLen を使う（改行を除いた文字数）。
   数え方を2つ持つと、同じ本文が道具のどこで測られたかで違う字数になる。

   段落数は validate() が既に3段落で止めているので、ここでは見ない。
   既存の問題には遡らない。見るのは入力にある作問の detail だけである。

   逸脱は throw ではなく「要判断」として一覧で報告し、1問も書かずに止める。
   入力にその作問の「許可」欄があるときだけ通し、理由を note へ自動で書き込む。
   選択肢の長さ・位置指し・追記の上限とまったく同じ扱いである。 */
function auditDetailLength(saku) {
  if (!saku.length) return;
  const 要判断 = [];
  let 例外 = 0;
  console.log("■ 作問の detail の字数の検査（書き込みの前）");
  for (const d of saku) {
    const n = detailLen(d.detail);
    const 逸脱 = n > LIMIT ? [`${n}字で上限${LIMIT}字を超える`] : [];
    const mark = 逸脱.length ? (d["許可"] ? "△" : "★") : "○";
    console.log(`  ${mark} ${d.id}　${n}字（上限${LIMIT}字に対して余地${LIMIT - n}字）` +
      (逸脱.length && d["許可"] ? "　許可つきで通す" : ""));
    if (逸脱.length) {
      if (!d["許可"]) 要判断.push(`${d.id}: ${逸脱.join("・")}`);
      else { 例外++; d.note = d.note + ` 型の例外として通した（${逸脱.join("・")}）。理由: ${d["許可"]}`; }
    }
  }
  if (要判断.length) {
    console.error("\n要判断（1問も書いていない）:\n  " + 要判断.join("\n  ") +
      "\n  どちらかを選ぶ: detail を詰めて型に収めるか、その作問に「許可」欄（理由）を足して通す。" +
      "\n  型は結果として揃ったものであって、内容より優先される規則ではない。");
    process.exit(1);
  }
  console.log(例外
    ? `  → ${saku.length}問を検査し、${例外}問は許可つきで通した（上限を超えたまま通っている）\n`
    : `  → ${saku.length}問とも上限${LIMIT}字の内側\n`);
}

/* ================= 1.7 台帳モード =================
   点検の結果を台帳へ書き戻す。作問・追記より先に走らせる。
   改名で語形が変わると数え直しの対象も変わるので、改名 → 扱いと数値 → 新規登録 の順。

   鍵語は keyterms.json・q.keys・tools/keys_draft.json・index.html の KEY_YOMI の4か所に散在し、
   改名はそれに「読み」を加えた5つを揃えて直す必要がある。台帳だけ直すと check_keys が落ちる。
   2026-09-17 の「十九世紀の反逆」の点検で、この4か所を1つずつ踏んで4回止まったので道具にした。 */
function applyLedger(led) {
  if (!led) return null;
  const kt = JSON.parse(fs.readFileSync(P("keyterms.json"), "utf8"));
  const bodyText = q => bodyOf(q);
  const measure = (person, word) => {
    const qs = readQ();
    return {
      hits: qs.filter(q => (q.philosophers || []).includes(person) && bodyText(q).includes(word)).length,
      all: qs.filter(q => bodyText(q).includes(word)).length
    };
  };
  const log = [];
  let setc = 0, fixc = 0, renc = 0, addc = 0, chgc = 0, delc = 0;
  const STAMP = led["刻印"] || "";

  /* --- 改名（5か所を揃えて直す） --- */
  let qsrc = fs.readFileSync(P("questions.js"), "utf8");
  let html = fs.readFileSync(P("index.html"), "utf8");
  const kd = JSON.parse(fs.readFileSync(P("tools/keys_draft.json"), "utf8"));
  for (const person of Object.keys(led["改名"] || {})) {
    for (const r of led["改名"][person]) {
      const t = (kt[person] || { "鍵語": [] })["鍵語"].find(x => x["語"] === r["旧"]);
      if (!t) throw new Error("改名対象が台帳に無い: " + person + "／" + r["旧"]);
      if (kt[person]["鍵語"].some(x => x["語"] === r["新"])) throw new Error("改名先が既にある: " + r["新"]);
      const m = measure(person, r["新"]);
      if (m.hits === 0) throw new Error("改名先の語形が本人の本文に無い: " + person + "／" + r["新"]);
      /* 旧語形が新語形の一部であるとき（先頭や末尾が重なる改名）、本文にある新語形が
         そのまま旧語形の出現として数えられ、残留チェックが原理的に通らない。
         新語形を取り除いてから探すと、裸の旧語形だけが残る。重なっているだけなら残留ではない。
         2026-09-19 に「通約不可能 → 通約不可能性」で踏んだ。本文4か所すべてが新語形で、
         性を伴わない旧語形は0件だったのに、改名が通らなかった。
         「部分文字列の残留を許す」は本来の型（別の語にたまたま含まれる場合）のために残す。 */
      const bareText = q => bodyText(q).split(r["新"]).join("");
      const nokori = readQ().filter(q => bareText(q).includes(r["旧"]));
      if (nokori.length && !r["部分文字列の残留を許す"])
        throw new Error("本文に旧語形が残っている: " + r["旧"] + "（" + nokori.map(q => q.id).join("・") + "）");
      if (nokori.length)
        log.push("  ※ 新語形の一部ではない旧語形が本文に残る（別の語として承知のうえ）: " + r["旧"] +
          " → " + nokori.map(q => q.id).join("・") + "／理由: " + (r["残留の理由"] || r["理由"]));
      t["語"] = r["新"];
      t["読み"] = r["読み"];
      t["hits"] = m.hits; t["全問"] = m.all; t["hits_全問"] = m.all;
      t["改名"] = (t["改名"] ? t["改名"] + " " : "") + r["理由"];
      /* q.keys（本文に旧語形は無いので、keys 配列の中だけが残っている） */
      const n = qsrc.split(S(r["旧"])).length - 1;
      qsrc = qsrc.split(S(r["旧"])).join(S(r["新"]));
      /* keys_draft */
      for (const id of Object.keys(kd))
        if (kd[id].includes(r["旧"])) kd[id] = kd[id].map(k => k === r["旧"] ? r["新"] : k);
      /* KEY_YOMI。開き引用符まで含めて拾う（外すと二重の引用符になり index.html が壊れる） */
      const re = new RegExp('"' + r["旧"].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '":"[^"]*",');
      if (!re.test(html)) throw new Error("KEY_YOMI に旧語形が無い: " + r["旧"]);
      html = html.replace(re, `${S(r["新"])}:${S(r["読み"])},`);
      renc++;
      log.push(`  改名　　　${person}／${r["旧"]} → ${r["新"]}（hits ${m.hits}／全問 ${m.all}・q.keys ${n}か所・読みと KEY_YOMI も）`);
    }
  }
  fs.writeFileSync(P("questions.js"), qsrc, "utf8");
  /* --- 扱いの変更（すでに扱いがある語を、旧を確かめてから書き換える） ---
     2026-09-17 に追加。「扱いの設定」は未設定の語にしか効かないので、
     言及→主題のような直しが道具を通らず、古代ギリシアの点検で止まった。 */
  for (const person of Object.keys(led["扱いの変更"] || {})) {
    for (const r of led["扱いの変更"][person]) {
      const t = (kt[person] || { "鍵語": [] })["鍵語"].find(x => x["語"] === r["語"]);
      if (!t) throw new Error("変更対象が台帳に無い: " + person + "／" + r["語"]);
      if ((t["扱い"] || "未設定") !== r["旧"])
        throw new Error("扱いが「" + r["旧"] + "」でない: " + person + "／" + r["語"] + " = " + (t["扱い"] || "未設定"));
      t["扱い"] = r["新"];
      t["確認"] = (t["確認"] ? t["確認"] + " " : "") + STAMP + " " + r["理由"];
      chgc++;
      log.push("  扱い変更　" + person + "／" + r["語"] + "　" + r["旧"] + " → " + r["新"]);
    }
  }


  /* --- 扱いの設定と、hits／全問の実測反映 --- */
  const 扱い = led["扱い"] || {}, 理由 = (扱い["理由"] || {}), ずれ = led["ずれの記録"] || {};
  const 値 = Object.keys(扱い).filter(k => k !== "理由");
  for (const person of (led["対象"] || [])) {
    if (!kt[person]) throw new Error("台帳にその人物がいない: " + person);
    for (const t of kt[person]["鍵語"]) {
      const w = t["語"];
      for (const v of 値) {
        if ((扱い[v][person] || []).includes(w)) {
          if (t["扱い"]) throw new Error("すでに扱いがある: " + person + "／" + w + " = " + t["扱い"]);
          t["扱い"] = v;
          t["確認"] = STAMP + (理由[w] ? " " + 理由[w] : "");
          setc++;
          log.push(`  扱い設定　${person}／${w} → ${v}${理由[w] ? "（注記つき）" : ""}`);
        }
      }
      const m = measure(person, w);
      if (t["hits"] !== m.hits || t["全問"] !== m.all) {
        const old = `${t["hits"]}/${t["全問"]}`;
        t["hits"] = m.hits; t["全問"] = m.all; t["hits_全問"] = m.all;
        t["備考"] = (t["備考"] ? t["備考"] + " " : "") +
          `${STAMP ? "" : ""}hits／全問を実測に直した（旧 ${old} → ${m.hits}/${m.all}）。` + (ずれ[w] || "");
        fixc++;
        log.push(`  数値修正　${person}／${w}  ${old} → ${m.hits}/${m.all}${ずれ[w] ? "（型を記録）" : ""}`);
      }
    }
  }

  /* --- 新規登録（台帳・q.keys・keys_draft・KEY_YOMI） --- */
  const yomiLines = [];
  for (const person of Object.keys(led["新規登録"] || {})) {
    for (const spec of led["新規登録"][person]) {
      const w = spec["語"];
      if (!kt[person]) throw new Error("台帳にその人物がいない: " + person);
      if (kt[person]["鍵語"].some(x => x["語"] === w)) throw new Error("既に台帳にある: " + person + "／" + w);
      const m = measure(person, w);
      if (m.hits === 0) throw new Error("本人の本文に語が無い: " + person + "／" + w);
      for (const id of (spec["付ける先"] || [])) {
        let src = fs.readFileSync(P("questions.js"), "utf8");
        const q = QUESTIONS_OF(src).find(x => x.id === id);
        if (!q) throw new Error("問題が無い: " + id);
        if (!bodyText(q).includes(w)) throw new Error("その問題の本文に語が無い: " + id + "／" + w);
        /* 規則3の二人語で、二人目をあとから足すとき。その問題には既に語が付いているので、
           付け足しを飛ばすだけでよい（台帳と KEY_YOMI の側は下で続けて処理する）。
           2026-09-19 まで throw していたため、一人目が登録済みの語は二人目を足せなかった。 */
        if ((q.keys || []).includes(w)) { log.push(`  ※ keys に既にある（付け足しを飛ばす）: ${id}／${w}`); continue; }
        const start = src.indexOf(`    id: ${S(id)},`);
        if (start < 0) throw new Error("エントリが見つからない: " + id);
        const end = src.indexOf("\n  },", start);
        const block = src.slice(start, end);
        const mm = block.match(/    keys: \[[^\]]*\],/);
        const line = `    keys: [${(q.keys || []).concat([w]).map(S).join(", ")}],`;
        if (mm) src = src.slice(0, start) + block.replace(mm[0], line) + src.slice(end);
        else {
          /* keys フィールドそのものが無い問題が42問ある */
          const tm = block.match(/    philosophers: \[[^\]]*\], terms: \[[^\]]*\], type: "[^"]*",/);
          if (!tm) throw new Error("keys を作る位置が見つからない: " + id);
          src = src.slice(0, start) + block.replace(tm[0], tm[0] + "\n" + line) + src.slice(end);
        }
        fs.writeFileSync(P("questions.js"), src, "utf8");
        kd[id] = readQ().find(x => x.id === id).keys;
      }
      kt[person]["鍵語"].push({
        "語": w, "読み": spec["読み"], "出典": "手動追加", "登録済み": false,
        "hits": m.hits, "全問": m.all, "必須": true, "扱い": "主題",
        "hits_全問": m.all, "機械判定": "主題候補", "追加": spec["追加"]
      });
      /* 規則3の二人語で、一人目が先に KEY_YOMI へ入っているとき。読みが一致するなら通し、
         行は足さない（1行のままにする）。違うときは従来どおり止める（2026-09-19）。 */
      const 既存の読み = (html.match(
        new RegExp('"' + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '":"([^"]*)",')) || [])[1];
      if (既存の読み !== undefined && 既存の読み !== spec["読み"])
        throw new Error("KEY_YOMI に違う読みで既にある: " + w +
          "（" + 既存の読み + " と " + spec["読み"] + "）");
      /* 規則3の二人語は同じ語を2人に登録するが、読みの行は1行でよい（既存15語はすべて1行）。
         見張りが html（ループ前の状態）しか見ていなかったので、同じ実行の中で2人ぶん積むと
         2行になっていた。2026-09-19 に、積んだぶんも見るようにした。
         「イコン」（パース・マリオン）で踏み、index.html を手で1行に直している。 */
      const yomiLine = `  ${S(w)}:${S(spec["読み"])},`;
      const 既出 = yomiLines.find(l => l.startsWith("  " + S(w) + ":"));
      if (既出 && 既出 !== yomiLine)
        throw new Error("同じ語に違う読みを登録しようとしている: " + w +
          "（" + 既出.trim() + " と " + yomiLine.trim() + "）");
      if (!既出 && 既存の読み === undefined) yomiLines.push(yomiLine);
      addc++;
      log.push(`  新規登録　${person}／${w}（hits ${m.hits}／全問 ${m.all}）→ ${(spec["付ける先"] || []).join("・")}`);
    }
  }
  /* --- keys から外す（q.keys・keys_draft、指定があれば台帳と KEY_YOMI も） ---
     2026-09-17 に追加。方針に合わない語を keys から抜く操作が無く、手作業になっていた。 */
  for (const person of Object.keys(led["keysから外す"] || {})) {
    for (const spec of led["keysから外す"][person]) {
      const w = spec["語"];
      const t = (kt[person] || { "鍵語": [] })["鍵語"].find(x => x["語"] === w);
      if (!t) throw new Error("外す対象が台帳に無い: " + person + "／" + w);
      for (const id of (spec["外す先"] || [])) {
        let src = fs.readFileSync(P("questions.js"), "utf8");
        const q = QUESTIONS_OF(src).find(x => x.id === id);
        if (!q) throw new Error("問題が無い: " + id);
        if (!(q.keys || []).includes(w)) throw new Error("その問題の keys に無い: " + id + "／" + w);
        const start = src.indexOf("    id: " + S(id) + ",");
        if (start < 0) throw new Error("エントリが見つからない: " + id);
        const end = src.indexOf("\n  },", start);
        const block = src.slice(start, end);
        const mm = block.match(/    keys: \[[^\]]*\],/);
        if (!mm) throw new Error("keys の行が見つからない: " + id);
        const rest = (q.keys || []).filter(k => k !== w);
        const line = "    keys: [" + rest.map(S).join(", ") + "],";
        src = src.slice(0, start) + block.replace(mm[0], line) + src.slice(end);
        fs.writeFileSync(P("questions.js"), src, "utf8");
        kd[id] = rest;
      }
      if (spec["台帳からも削除"]) {
        if (readQ().some(q => (q.keys || []).includes(w)))
          throw new Error("まだ q.keys に残っている語は台帳から削除できない: " + w);
        const needle = S(w) + ":" + S(t["読み"]) + ",";
        if (!html.includes(needle)) throw new Error("KEY_YOMI にその語が無い: " + w);
        html = html.includes("\n  " + needle)
          ? html.split("\n  " + needle).join("")
          : html.split(needle).join("");
        kt[person]["鍵語"] = kt[person]["鍵語"].filter(x => x["語"] !== w);
        kt["_meta"]["削除した語"].push({
          "哲学者": person, "語": w, "理由": spec["理由"], "削除日": spec["削除日"] || STAMP
        });
      }
      delc++;
      log.push("  keys から外す　" + person + "／" + w + "（" + (spec["外す先"] || []).join("・") +
        (spec["台帳からも削除"] ? "・台帳と KEY_YOMI からも削除" : "") + "）");
    }
  }

  if (yomiLines.length) {
    const anchor = "const KEY_YOMI = {\n";
    if (!html.includes(anchor)) throw new Error("KEY_YOMI が見つからない");
    html = html.replace(anchor, anchor + yomiLines.join("\n") + "\n");
  }
  fs.writeFileSync(P("index.html"), html, "utf8");
  fs.writeFileSync(P("tools/keys_draft.json"), JSON.stringify(kd, null, 1) + "\n", "utf8");
  fs.writeFileSync(P("keyterms.json"), JSON.stringify(kt, null, 1) + "\n", "utf8");

  /* --- 未登場掃き（全人物） --- */
  const used = new Set();
  for (const q of readQ()) for (const k of (q.keys || [])) used.add(k);
  const sweep = [];
  for (const p of Object.keys(kt)) {
    if (p === "_meta") continue;
    for (const t of (kt[p]["鍵語"] || []))
      if (t["扱い"] === "未登場" && used.has(t["語"])) sweep.push(`${p}／${t["語"]}`);
  }

  console.log("■ 台帳の整備");
  console.log(log.join("\n"));
  console.log(`  → 扱いを設定 ${setc}語／数値を修正 ${fixc}語／改名 ${renc}語／新規登録 ${addc}語`);
  console.log(`  → keys に付いているのに扱いが未登場: ${sweep.length ? sweep.join("、") : "0件"}\n`);
  console.log("  → 扱いを変更 " + chgc + "語／keys から外す " + delc + "語");
  return { setc, fixc, renc, addc, chgc, delc, sweep };
}

/* ================= 1.6 hits と問題数の実測（どのモードでも走る） =================
   2026-09-18 に applyLedger の外へ出した。
   もとは台帳モードの中にあったので、作問だけ・追記だけの実行では走らなかった。
   実際、位置指しの書き換えで q590 から一文が落ち、ロールズ「格差原理」の
   全問が 6 から 5 へずれたのに気づかないまま push した（6038b7e で直した）。
   「本文を書き換えたら台帳モードも通す」という運用は人が忘れる。道具の側で必ず走らせる。

   呼ぶ位置は registerKeys の直後・checks の直前。
   作問・追記・鍵語登録がすべて終わったあとの本文を数える必要があり、
   registerKeys も keyterms.json を書くので、そのあとで読み直して上書きする。 */
function refreshCounts() {
  const kt = JSON.parse(fs.readFileSync(P("keyterms.json"), "utf8"));
  const qs = readQ();
  const hitsFixed = [], countFixed = [];
  for (const p of Object.keys(kt)) {
    if (p === "_meta") continue;
    for (const t of (kt[p]["鍵語"] || [])) {
      const w = t["語"];
      const mine = qs.filter(q => (q.philosophers || []).includes(p) && bodyOf(q).includes(w)).length;
      const whole = qs.filter(q => bodyOf(q).includes(w)).length;
      if (t["hits"] !== mine || t["全問"] !== whole) {
        hitsFixed.push(`${p}／${w}(${t["hits"]}/${t["全問"]}→${mine}/${whole})`);
        t["hits"] = mine; t["全問"] = whole; t["hits_全問"] = whole;
      }
    }
    const real = qs.filter(q => (q.philosophers || []).includes(p)).length;
    if (kt[p]["問題数"] !== real) {
      countFixed.push(`${p}(${kt[p]["問題数"]}→${real})`);
      kt[p]["問題数"] = real;
    }
  }
  fs.writeFileSync(P("keyterms.json"), JSON.stringify(kt, null, 1) + "\n", "utf8");
  console.log("■ 実測の反映");
  console.log("  → hits を実測に直した: " + (hitsFixed.length ? hitsFixed.length + "語（" + hitsFixed.join("・") + "）" : "0語"));
  console.log("  → 問題数を実測に直した: " + (countFixed.length ? countFixed.length + "人（" + countFixed.join("・") + "）" : "0人") + "\n");
  return { hitsFixed, countFixed };
}

/* ================= 2. 作問を questions.js へ ================= */
function appendQuestions(saku) {
  if (!saku.length) return;
  let qjs = fs.readFileSync(P("questions.js"), "utf8");
  for (const d of saku) if (qjs.includes(`id: ${S(d.id)}`)) throw new Error("すでにある: " + d.id);
  const blocks = saku.map(d => [
    "  {",
    `    id: ${S(d.id)},`,
    `    philosophers: [${d.philosophers.map(S).join(", ")}], terms: [${d.terms.map(S).join(", ")}], type: ${S(d.type || "single")},`,
    `    keys: [${d.keys.map(S).join(", ")}],`,
    `    question: ${S(d.question)},`,
    "    choices: [",
    d.choices.map(c => `      ${S(c)}`).join(",\n"),
    "    ],",
    `    answer: ${d.answer},`,
    `    explanation: ${S(d.explanation)},`,
    `    detail: ${S(d.detail)},`,
    "    source: {",
    '      kind: "ai_web", label: "ウェブ照合済み",',
    '      choicesOk: "ok",',
    `      note: ${S(d.note)},`,
    "      refs: [",
    d.refs.map(r => `        ${S(r)}`).join(",\n"),
    "      ]",
    "    }",
    "  }"
  ].join("\n"));
  const tail = "\n];";
  const hadNL = qjs.endsWith(tail + "\n");
  if (!qjs.endsWith(tail) && !hadNL) throw new Error("questions.js の末尾が想定と違う");
  qjs = qjs.slice(0, qjs.lastIndexOf(tail)) + ",\n" + blocks.join(",\n") + tail + (hadNL ? "\n" : "");
  fs.writeFileSync(P("questions.js"), qjs, "utf8");
  console.log(`■ questions.js に ${saku.length}問を追記した`);
  for (const d of saku) console.log(`  ${d.id}（${d.philosophers.join("・")}）keys: ${d.keys.join("・")}`);
  console.log("");
}

/* ================= 3. detail 追記（字数は書き込んだあとに実測） ================= */
function applyAppends(tsui) {
  if (!tsui.length) return;
  console.log("■ 本文の追記");
  const 要判断 = [];
  for (const it of tsui) {
    /* 置換のたびにファイルを読み直す。src を使い回すと、2件目以降が古い文字列で
       置換され、表示だけ成功して実ファイルが変わらない。2026-09-17 にこれで二度失敗した。 */
    let src = fs.readFileSync(P("questions.js"), "utf8");
    let q = QUESTIONS_OF(src).find(x => x.id === it.id);
    if (!q) throw new Error("問題が無い: " + it.id);
    /* 2026-09-18 に対象を選べるようにした。explanation にも位置で選択肢を指す句が残っていたため。 */
    const FLD = it["対象"] || "detail";
    if (typeof q[FLD] !== "string" || !q[FLD]) throw new Error(FLD + " が無い: " + it.id);
    const before = detailLen(q[FLD]);

    /* --- 本文（detail か explanation） --- */
    if (q[FLD].indexOf(it.find) < 0) throw new Error(FLD + " に find が無い: " + it.id);
    if (q[FLD].indexOf(it.find) !== q[FLD].lastIndexOf(it.find)) throw new Error("find が一意でない: " + it.id);
    const newBody = q[FLD].replace(it.find, it.replace);
    if (src.indexOf(S(q[FLD])) !== src.lastIndexOf(S(q[FLD]))) throw new Error(FLD + " リテラルが一意でない: " + it.id);
    src = src.replace(S(q[FLD]), S(newBody));
    fs.writeFileSync(P("questions.js"), src, "utf8");

    /* --- 字数はここで実測する。予定値は使わない --- */
    src = fs.readFileSync(P("questions.js"), "utf8");
    q = QUESTIONS_OF(src).find(x => x.id === it.id);
    const after = detailLen(q[FLD]);
    const par = FLD === "detail" ? q.detail.split(/\n\n+/).length : 0;
    /* 2026-09-18 に throw をやめた。CLAUDE.md の「字数は目安であって、内容より優先されない」と
       食い違っており、内容が要求する追記を道具の側が一律に拒んでいたため。
       逸脱は要判断として集め、入力に「許可」欄があるときだけ通す。 */
    const 逸脱 = [];
    if (FLD === "detail") {
      /* 字数と段落の型は detail のものなので、explanation では見ない。 */
      if (par !== 3) 逸脱.push(`段落が${par}になる`);
      if (after > LIMIT) 逸脱.push(`${after}字で上限${LIMIT}字を超える`);
    }
    if (逸脱.length && !it["許可"]) 要判断.push(`${it.id}: ${逸脱.join("・")}`);

    /* --- note（実測した字数と余地を道具が足す） --- */
    const measured = (FLD === "detail"
      ? `（${before}→${after}字。上限${LIMIT}字に対して余地${LIMIT - after}字）`
      : `（explanation を${before}→${after}字に書き換えた）`) +
      (逸脱.length && it["許可"] ? ` 型の例外として通した（${逸脱.join("・")}）。理由: ${it["許可"]}` : "");
    const oldNote = q.source.note;
    const newNote = oldNote + it.note_add + measured;
    if (src.indexOf(S(oldNote)) !== src.lastIndexOf(S(oldNote))) throw new Error("note リテラルが一意でない: " + it.id);
    src = src.replace(S(oldNote), S(newNote));
    fs.writeFileSync(P("questions.js"), src, "utf8");

    /* --- keys --- */
    if (it.keys_add && it.keys_add.length) {
      src = fs.readFileSync(P("questions.js"), "utf8");
      q = QUESTIONS_OF(src).find(x => x.id === it.id);
      const start = src.indexOf(`    id: ${S(it.id)},`);
      if (start < 0) throw new Error("エントリが見つからない: " + it.id);
      const end = src.indexOf("\n  },", start);
      const block = src.slice(start, end);
      const m = block.match(/    keys: \[[^\]]*\],/);
      const line = `    keys: [${(q.keys || []).concat(it.keys_add).map(S).join(", ")}],`;
      if (m) {
        src = src.slice(0, start) + block.replace(m[0], line) + src.slice(end);
      } else {
        /* keys フィールドそのものが無い問題が42問ある（q133・q142・q211 など）。
           refs の「無い」と「空」の区別と同じ型で、`q.keys || []` で読むと空配列に見えるが
           ソース上は行が存在しない。その場合は philosophers/terms/type の行の直後に作る。
           2026-09-17 に「十九世紀の反逆」の台帳整備で踏んだ。 */
        const tm = block.match(/    philosophers: \[[^\]]*\], terms: \[[^\]]*\], type: "[^"]*",/);
        if (!tm) throw new Error("keys を作る位置が見つからない: " + it.id);
        src = src.slice(0, start) + block.replace(tm[0], tm[0] + "\n" + line) + src.slice(end);
      }
      fs.writeFileSync(P("questions.js"), src, "utf8");
    }

    /* --- refs（「refs が無い」と「refs が空」は別。q395 で踏んだ） --- */
    if (it.refs_add) {
      src = fs.readFileSync(P("questions.js"), "utf8");
      const start = src.indexOf(`    id: ${S(it.id)},`);
      const end = src.indexOf("\n  },", start);
      const block = src.slice(start, end);
      let nb;
      if (/refs: \[\]/.test(block)) {
        nb = block.replace("refs: []", `refs: [\n        ${S(it.refs_add)}\n      ]`);
      } else if (/refs: \[/.test(block)) {
        const i = block.lastIndexOf("\n      ]");
        if (i < 0) throw new Error("refs の閉じが見つからない: " + it.id);
        nb = block.slice(0, i) + `,\n        ${S(it.refs_add)}` + block.slice(i);
      } else {
        /* refs フィールドそのものが無い問題が81件ある。note の後ろに作る。 */
        const i = block.lastIndexOf("\n    }");
        if (i < 0) throw new Error("source の閉じが見つからない: " + it.id);
        nb = block.slice(0, i) + `,\n      refs: [\n        ${S(it.refs_add)}\n      ]` + block.slice(i);
      }
      src = src.slice(0, start) + nb + src.slice(end);
      fs.writeFileSync(P("questions.js"), src, "utf8");
    }

    const fin = readQ().find(x => x.id === it.id);
    console.log(`  ${it.id}: ${FLD} ${before}→${after}字` +
      (FLD === "detail" ? `（余地${LIMIT - after}字）／段落${fin.detail.split(/\n\n+/).length}` : "") +
      (it.keys_add ? `／keys +${it.keys_add.join("・")}` : "") +
      (it.refs_add ? `／refs ${fin.source.refs.length}件` : "") +
      (逸脱.length && it["許可"] ? `／許可つきで通した（${逸脱.join("・")}）` : ""));
  }
  if (要判断.length) {
    throw new Error("要判断（1件も書かずに差し戻した）:\n  " + 要判断.join("\n  ") +
      "\n  どちらかを選ぶ: replace を詰めて型に収めるか、その追記に「許可」欄（理由）を足して通す。" +
      "\n  型は結果として揃ったものであって、内容より優先される規則ではない。");
  }
  console.log("");
}

/* ================= 4. 鍵語の登録 ================= */
function registerKeys(keys, saku, tsui) {
  const kt = JSON.parse(fs.readFileSync(P("keyterms.json"), "utf8"));
  const qs = readQ();
  let added = 0;
  console.log("■ 鍵語の登録");
  for (const 由来 of ["作問由来", "追記由来"]) {
    const g = keys[由来] || {};
    for (const person of Object.keys(g)) for (const spec of g[person]) {
      const w = spec["語"];
      if (!kt[person]) throw new Error("台帳にその人物がいない: " + person);
      if (kt[person]["鍵語"].some(t => t["語"] === w)) throw new Error("既に台帳にある: " + person + "／" + w + "（既存語は別に扱う）");
      const mine = qs.filter(q => (q.philosophers || []).includes(person) && bodyOf(q).includes(w)).length;
      const all = qs.filter(q => bodyOf(q).includes(w)).length;
      if (mine === 0) throw new Error("本人の本文に語が無い: " + person + "／" + w);
      kt[person]["鍵語"].push({
        "語": w, "読み": spec["読み"], "出典": "手動追加", "登録済み": false,
        "hits": mine, "全問": all, "必須": true, "扱い": "主題",
        "hits_全問": all, "機械判定": "主題候補", "追加": spec["追加"]
      });
      added++;
      console.log(`  ${person}／${w}（hits ${mine}／全問 ${all}・${由来}）`);
    }
  }
  fs.writeFileSync(P("keyterms.json"), JSON.stringify(kt, null, 1) + "\n", "utf8");

  /* keys_draft.json は q.keys と同じ中身でなければならない（check_keys の項目2） */
  const kd = JSON.parse(fs.readFileSync(P("tools/keys_draft.json"), "utf8"));
  for (const d of saku) {
    if (kd[d.id]) throw new Error("keys_draft に既にある: " + d.id);
    kd[d.id] = d.keys;
  }
  for (const it of tsui) {
    if (!it.keys_add || !it.keys_add.length) continue;
    kd[it.id] = readQ().find(x => x.id === it.id).keys;
  }
  fs.writeFileSync(P("tools/keys_draft.json"), JSON.stringify(kd, null, 1) + "\n", "utf8");

  /* index.html の KEY_YOMI */
  let html = fs.readFileSync(P("index.html"), "utf8");
  const anchor = "const KEY_YOMI = {\n";
  if (!html.includes(anchor)) throw new Error("KEY_YOMI が見つからない");
  const lines = [];
  for (const 由来 of ["作問由来", "追記由来"]) {
    const g = keys[由来] || {};
    for (const person of Object.keys(g)) for (const spec of g[person]) {
      /* 新規登録と同じ扱いにする。先に登録済みの二人語は、読みが一致するなら通して行は足さず、
         違うときだけ止める（2026-09-19）。新規登録だけ直すと、ここに同じ穴が残る。 */
      const 既存の読み = (html.match(
        new RegExp('"' + spec["語"].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '":"([^"]*)",')) || [])[1];
      if (既存の読み !== undefined && 既存の読み !== spec["読み"])
        throw new Error("KEY_YOMI に違う読みで既にある: " + spec["語"] +
          "（" + 既存の読み + " と " + spec["読み"] + "）");
      /* 新規登録と同じ理由で、同じ実行の中で積んだぶんも見る（2026-09-19）。
         作問由来・追記由来でも、規則3の二人語を2人ぶん書けば同じことが起きる。
         新規登録だけ直すと、こちらに同じ穴が残る。 */
      const yomiLine = `  ${S(spec["語"])}:${S(spec["読み"])},`;
      const 既出 = lines.find(l => l.startsWith("  " + S(spec["語"]) + ":"));
      if (既出 && 既出 !== yomiLine)
        throw new Error("同じ語に違う読みを登録しようとしている: " + spec["語"]);
      if (!既出 && 既存の読み === undefined) lines.push(yomiLine);
    }
  }
  if (lines.length) {
    html = html.replace(anchor, anchor + lines.join("\n") + "\n");
    fs.writeFileSync(P("index.html"), html, "utf8");
  }
  console.log(`  → 台帳 ${added}語／keys_draft ${saku.length + tsui.filter(t => t.keys_add && t.keys_add.length).length}件／KEY_YOMI ${lines.length}語\n`);
}

/* ================= 5〜6. 再生成と検査 ================= */
function run(label, file, args, opts) {
  process.stdout.write(`  ${label} … `);
  try {
    const out = execFileSync(process.execPath, [file].concat(args || []), { cwd: R, encoding: "utf8" });
    console.log("通った");
    return out;
  } catch (e) {
    console.log("落ちた");
    if (opts && opts.soft) { console.log("    （合否は見ない道具なので続ける）"); return ""; }
    const tail = String(e.stdout || "").split("\n").slice(-25).join("\n");
    throw new Error(`${label} が落ちた\n${tail}\n${String(e.stderr || "").slice(0, 800)}`);
  }
}
function checks() {
  console.log("■ 再生成と検査");
  run("KEY_OWNER の再生成", P("tools/gen_key_owner.js"));
  run("node --check questions.js", P("questions.js"), null, { check: true });
  run("check_keys", P("tools/check_keys.js"));
  run("check_phil", P("tools/check_phil.js"));
  /* coverage.js は数字を出すだけで合否を終了コードで返さない。実行だけして合否は見ない。 */
  run("coverage（合否は見ない）", P("coverage.js"), null, { soft: true });
  run("進捗表の更新", path.join(__dirname, "progress_table.js"), [R]);
  console.log("");
}

/* ================= 差し戻し ================= */
function snapshot() {
  const m = {};
  for (const f of TOUCHED) m[f] = fs.readFileSync(P(f));
  return m;
}
function restore(m, why) {
  for (const f of TOUCHED) fs.writeFileSync(P(f), m[f]);
  console.log(`\n■ ${why}ので、${TOUCHED.length}ファイルを元に戻した`);
  for (const f of TOUCHED) console.log(`  ${f}`);
}

/* ================= 本体 ================= */
function main() {
  const input = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const { saku, tsui, keys, led } = validate(input);
  console.log(`■ 入力: 作問${saku.length}問／追記${tsui.length}件／鍵語 ` +
    `作問由来${count(keys["作問由来"])}語・追記由来${count(keys["追記由来"])}語` +
    (led ? `／台帳 ${led["対象"].length}人・改名${count(led["改名"] || {})}語・登録${count(led["新規登録"] || {})}語` : "") +
    (DRY ? "　【dry-run】" : "") + "\n");

  const snap = snapshot();
  const { afterAppend } = auditKeyForms(saku, tsui, keys, readQ());
  /* keys 全部の語形は、総点検のあとで見る。総点検が追記の find の一意性まで確かめており、
     その結果（追記後の本文）をそのまま使えるため。2026-09-19 に足した。 */
  auditKeysInBody(saku, tsui, afterAppend);
  auditChoiceBalance(saku);
  auditPositional(saku);
  auditDetailLength(saku);
  try {
    /* 台帳が先。改名で語形が変わると数え直しの対象も変わるため。 */
    applyLedger(led);
    appendQuestions(saku);
    applyAppends(tsui);
    registerKeys(keys, saku, tsui);
    refreshCounts();
    checks();
  } catch (e) {
    restore(snap, "途中で落ちた");
    console.error("\n" + e.message);
    process.exit(1);
  }

  const q = readQ();
  const kt = JSON.parse(fs.readFileSync(P("keyterms.json"), "utf8"));
  let terms = 0;
  for (const p of Object.keys(kt)) if (p !== "_meta") terms += (kt[p]["鍵語"] || []).length;
  console.log(`■ 結果: 問題 ${q.length}問／台帳 ${terms}語`);

  if (DRY) restore(snap, "dry-run な");
  else console.log("\n  （コミットはしていない。git status で確かめてから commit すること）");
}
const count = g => Object.values(g || {}).reduce((a, v) => a + v.length, 0);
main();
