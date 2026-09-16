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
     }
   }

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
  return { saku, tsui, keys };
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
      if (!m) throw new Error("keys 行が無い: " + it.id);
      const line = `    keys: [${q.keys.concat(it.keys_add).map(S).join(", ")}],`;
      src = src.slice(0, start) + block.replace(m[0], line) + src.slice(end);
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
  const { saku, tsui, keys } = validate(input);
  console.log(`■ 入力: 作問${saku.length}問／追記${tsui.length}件／鍵語 ` +
    `作問由来${count(keys["作問由来"])}語・追記由来${count(keys["追記由来"])}語` + (DRY ? "　【dry-run】" : "") + "\n");

  const snap = snapshot();
  auditKeyForms(saku, tsui, keys, readQ());
  try {
    appendQuestions(saku);
    applyAppends(tsui);
    registerKeys(keys, saku, tsui);
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
