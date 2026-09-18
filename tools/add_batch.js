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
                 answer(0始まりの番号), explanation, detail, note, refs[] } ],
     "追記": [ { id, find, replace, note_add, keys_add[], refs_add? } ],
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
    if (q.detail.indexOf(it.find) < 0) { ng.push(`追記先の detail に find が無い: ${it.id}`); continue; }
    if (q.detail.indexOf(it.find) !== q.detail.lastIndexOf(it.find)) { ng.push(`find が一意でない: ${it.id}`); continue; }
    const nd = q.detail.replace(it.find, it.replace);
    afterAppend[it.id] = { ph: q.philosophers || [], t: bodyOf(Object.assign({}, q, { detail: nd })), detail: nd };
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

/* ================= 1.5 台帳モード =================
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
      const nokori = readQ().filter(q => bodyText(q).includes(r["旧"]));
      if (nokori.length && !r["部分文字列の残留を許す"])
        throw new Error("本文に旧語形が残っている: " + r["旧"] + "（" + nokori.map(q => q.id).join("・") + "）");
      if (nokori.length)
        log.push("  ※ 旧語形が本文に残る（別の意味の部分文字列として承知のうえ）: " + r["旧"] +
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
        if ((q.keys || []).includes(w)) throw new Error("既に keys にある: " + id + "／" + w);
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
      if (html.includes('"' + w + '":')) throw new Error("KEY_YOMI に既にある: " + w);
      yomiLines.push(`  ${S(w)}:${S(spec["読み"])},`);
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
const LIMIT = 370;
function applyAppends(tsui) {
  if (!tsui.length) return;
  console.log("■ detail の追記");
  for (const it of tsui) {
    /* 置換のたびにファイルを読み直す。src を使い回すと、2件目以降が古い文字列で
       置換され、表示だけ成功して実ファイルが変わらない。2026-09-17 にこれで二度失敗した。 */
    let src = fs.readFileSync(P("questions.js"), "utf8");
    let q = QUESTIONS_OF(src).find(x => x.id === it.id);
    if (!q) throw new Error("問題が無い: " + it.id);
    const before = L(q.detail.replace(/\n/g, ""));

    /* --- detail --- */
    if (q.detail.indexOf(it.find) < 0) throw new Error("detail に find が無い: " + it.id);
    if (q.detail.indexOf(it.find) !== q.detail.lastIndexOf(it.find)) throw new Error("find が一意でない: " + it.id);
    const newDetail = q.detail.replace(it.find, it.replace);
    if (src.indexOf(S(q.detail)) !== src.lastIndexOf(S(q.detail))) throw new Error("detail リテラルが一意でない: " + it.id);
    src = src.replace(S(q.detail), S(newDetail));
    fs.writeFileSync(P("questions.js"), src, "utf8");

    /* --- 字数はここで実測する。予定値は使わない --- */
    src = fs.readFileSync(P("questions.js"), "utf8");
    q = QUESTIONS_OF(src).find(x => x.id === it.id);
    const after = L(q.detail.replace(/\n/g, ""));
    const par = q.detail.split(/\n\n+/).length;
    if (par !== 3) throw new Error(`追記で段落が ${par} になった: ${it.id}`);
    if (after > LIMIT) throw new Error(`追記で上限${LIMIT}字を超えた: ${it.id}（${after}字）。replace を短くする`);

    /* --- note（実測した字数と余地を道具が足す） --- */
    const measured = `（${before}→${after}字。上限${LIMIT}字に対して余地${LIMIT - after}字）`;
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
    console.log(`  ${it.id}: detail ${before}→${after}字（余地${LIMIT - after}字）／段落${fin.detail.split(/\n\n+/).length}` +
      (it.keys_add ? `／keys +${it.keys_add.join("・")}` : "") +
      (it.refs_add ? `／refs ${fin.source.refs.length}件` : ""));
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
      if (html.includes('"' + spec["語"] + '":')) throw new Error("KEY_YOMI に既にある: " + spec["語"]);
      lines.push(`  ${S(spec["語"])}:${S(spec["読み"])},`);
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
  auditKeyForms(saku, tsui, keys, readQ());
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
