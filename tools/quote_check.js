// 引用が原文にあるかを確かめる道具（2026年9月24日、フランクフルト学派の回で作った）。
// 使い方: node tools/quote_check.js <list.json>
//   list.json = [[URL, "引用の一部", "引用の一部", ...], ...]
// ページは curl（既定の設定。User-Agent は偽らない）で取り、tools/_sources/quote_cache/ にキャッシュする（gitignore 済み）。
// HTML は文字だけにし、空白・引用符・よく使う文字実体を寄せ、大文字小文字を区別せずに比べる。
// ○ は原文にある、× は無い。× が出たら、短く切って引き直し（引用符や改行の違いのことが多い）、それでも無ければその引用は使わない。
// 取得できた文字が2000字未満なら【取得できず】と出す（確認画面・404 など）。PDF は tools/quote_check_pdf.py を使う。
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), crypto = require('crypto');
const C = path.join(__dirname, '_sources', 'quote_cache');
fs.mkdirSync(C, { recursive: true });
const norm = s => s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;|&#x2019;|&#8216;|&lsquo;/g, "'")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"').replace(/&#8212;|&mdash;/g, '—').replace(/&#8211;|&ndash;/g, '–')
  .replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').toLowerCase();
function page(url) {
  const f = path.join(C, crypto.createHash('md5').update(url).digest('hex') + '.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  let h = '';
  try { h = execFileSync('curl', ['-sL', '--max-time', '60', url], { maxBuffer: 1e8 }).toString(); } catch (e) { h = ''; }
  const t = norm(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' '));
  fs.writeFileSync(f, t); return t;
}
const L = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const [url, ...qs] of L) {
  const t = page(url);
  console.log((t.length < 2000 ? '【取得できず ' + t.length + '】' : '') + url);
  for (const q of qs) { const ok = t.includes(norm(q)); if (!ok) bad++; console.log('  ' + (ok ? '○' : '×') + ' ' + q.slice(0, 90)); }
}
process.exitCode = bad ? 1 : 0;
