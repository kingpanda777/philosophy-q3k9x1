/* 新規人物の登録（4か所）を一度に作る道具。

   使い方:  node tools/add_person.js            （対象はリポジトリ直下）
            node tools/add_person.js <ディレクトリ>  （サンドボックスで試すとき）

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

   いまはシジウィック固定である。
   人物データを入力 JSON で受ける形への一般化は次の作業とし、
   そのとき「シジウィックの入力で同じ結果になるか」をサンドボックスで確かめること。
*/
"use strict";
const fs = require("fs");
const path = require("path");
const R = process.argv[2] || path.join(__dirname, "..");
const P = f => path.join(R, f);

/* ---- 1. questions.js の PHILOSOPHERS ---- */
{
  const f = P("questions.js");
  let s = fs.readFileSync(f, "utf8");
  const anchor = `  { name: "モンテスキュー", years: "1689–1755", note: "権力は権力によって抑えよ", school: "社会契約と政治" }`;
  if (!s.includes(anchor)) throw new Error("PHILOSOPHERS の差し込み位置が見つからない");
  if (s.includes(`name: "シジウィック"`)) throw new Error("PHILOSOPHERS に既にいる");
  const add = anchor + `,\n  { name: "シジウィック", years: "1838–1900", note: "自分の幸福を求める理性と全体の幸福を求める理性が、和解しない", school: "功利主義と自由主義" }`;
  s = s.replace(anchor, add);
  fs.writeFileSync(f, s, "utf8");
  console.log("○ questions.js の PHILOSOPHERS に追加");
}

/* ---- 2. philosophers.js の PHIL_INTRO ---- */
{
  const f = P("philosophers.js");
  let s = fs.readFileSync(f, "utf8");
  if (s.includes(`name: "シジウィック"`)) throw new Error("PHIL_INTRO に既にいる");
  const entry = `  {
    name: "シジウィック",
    yomi: "しじうぃっく",
    place: "ケンブリッジ",
    intro: "ヨークシャーに生まれ、ラグビー校からトリニティ・コレッジへ進んだ。1869年に信仰上の理由でフェローを辞し、71年にのちのニューナム・コレッジとなる寄宿舎を開き、83年に道徳哲学の講座に就いた。",
    thought: "何をなすべきかに理性はどう答えるのかを問い、自分の幸福を求める理性と全体の幸福を求める理性が、ともに自明でありながら衝突すると答えた。人口についても、平均ではなく人数と平均の幸福の積が最大になる点までとした。",
    thought_src: ["q792","q793"],
    works: [
      { title: "倫理学の方法", year: 1874 },
      { title: "経済学原理",   year: 1883 },
      { title: "政治学要論",   year: 1891 }
    ],
    checked: true
  }`;
  const m = s.match(/const PHIL_INTRO = \[[\s\S]*?\n\];/);
  if (!m) throw new Error("PHIL_INTRO が見つからない");
  const block = m[0];
  const closed = block.slice(0, block.lastIndexOf("\n];"));
  s = s.replace(block, closed + ",\n" + entry + "\n];");
  fs.writeFileSync(f, s, "utf8");
  console.log("○ philosophers.js の PHIL_INTRO に追加（紹介の欄）");
}

/* ---- 3. tools/years_src.json の引用行 ---- */
{
  const f = P("tools/years_src.json");
  const y = JSON.parse(fs.readFileSync(f, "utf8"));
  if (y["シジウィック"]) throw new Error("years_src に既にいる");
  y["シジウィック"] = "Wikipedia「Henry Sidgwick (31 May 1838 – 28 August 1900)」";
  fs.writeFileSync(f, JSON.stringify(y, null, 1) + "\n", "utf8");
  console.log("○ tools/years_src.json に引用行を追加");
}

/* ---- 4. keyterms.json の人物エントリ（器だけ。鍵語は作問バッチが入れる） ---- */
{
  const f = P("keyterms.json");
  const kt = JSON.parse(fs.readFileSync(f, "utf8"));
  if (kt["シジウィック"]) throw new Error("台帳に既にいる");
  kt["シジウィック"] = { "学派": "功利主義と自由主義", "問題数": 0, "鍵語": [] };
  fs.writeFileSync(f, JSON.stringify(kt, null, 1) + "\n", "utf8");
  console.log("○ keyterms.json に人物エントリを追加（鍵語は空）");
}

console.log("\n→ 4か所とも入った。このあと add_batch.js を走らせる。");
