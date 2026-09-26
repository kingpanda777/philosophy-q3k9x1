// Claude Code の PreToolUse hook（matcher "Bash|PowerShell"）で、CLAUDE.md の書き換えの決まりに反するシェルでの書き換えを止める。
// 2026年9月26日、社会学の回で作った。設定は .claude/settings.local.json（Git に入らない。中身は CLAUDE.md「hooks で書き換えの決まりを止める」に写してある）。
//
// 標準入力で hook の JSON（tool_name・tool_input.command）を受け取る。
//   通す  ：何も出さずに終了コード 0
//   止める：理由と代わりのやり方を標準エラーに出して終了コード 2（公式の説明で、PreToolUse の終了コード 2 はツールの実行を止め、標準エラーが理由になる）
// 入力が読めない・このスクリプトが落ちる・時間切れのときは、命令は止まらずに通る（公式の説明どおり。利用者がそのままと決めた）。
//
// 止めるもの
//   Bash      ：ヒアドキュメント（<<）・sed -i・node -e / python -c のコードの中のファイルへの書き込み・リダイレクト（> >> >| &> n>）・tee
//   PowerShell：Set-Content・Add-Content・Out-File・Tee-Object・[IO.File]::Write*/Append*・リダイレクト（> >> *> n>）・node -e / python -c の書き込み
//   どちらも、bash -c・sh -c・powershell -Command・pwsh -Command の引数の中身を取り出して同じ検査にかける
// 通すもの：/dev/null・NUL・$null へ捨てるだけのもの、2>&1 のような出力先の付け替え、<<< （ヒアストリング）、読むだけの node -e
// 見分けは文字列の手がかりによるもので完全ではない。hooks は決まりの歯止めで、決まりそのものではない（CLAUDE.md）。
// このスクリプトを直したら、node tools/hooks/hook_guard_test.js を回すこと。

const ALT = '代わりのやり方：新しいファイルは Write ツールで作り、書き換えは Edit ツールか、ファイルに書いたスクリプト（node tools/_work/xxx.js）で行う。道具の出力をファイルに残すときは、その道具の --out <出力先> を使う（unverified_list.js・over_limit.js・remain_list.js）。';
const ALT_COMMIT = 'git commit のメッセージは、-m を段落ごとに並べて渡す（git commit -m "1行目" -m "本文"）か、Write で作ったファイルを -F で渡す（git commit -F tools/_work/msg.txt）。';

// 引用符の中身を空にする（'…' と "…"。"…" の中のバックスラッシュと、PowerShell のバッククォートのエスケープを扱う）
function stripQuotes(s) {
  let out = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (q === '"' && (c === '\\' || c === '`')) { i++; continue; }
      if (c === q) { q = null; out += c; }
      continue;
    }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    out += c;
  }
  return out;
}

// ヒアドキュメント：<<WORD のあとに、WORD だけの行が来るもの。引用符の中（$(cat <<'EOF' …) の形）でも見つける。
// 終わりの行が無い <<（コミットメッセージの文中の「<<EOF」など）は通す。<<< は通す
function heredocs(raw) {
  const found = [];
  const re = /(^|[^<])<<(?!<)(-?)\s*(['"]?)([A-Za-z_][\w-]*)\3/g;
  let m;
  while ((m = re.exec(raw))) {
    const word = m[4], rest = raw.slice(m.index + m[0].length);
    const lines = rest.split(/\r?\n/).slice(1);
    if (lines.some(l => (m[2] ? l.replace(/^\t+/, '') : l).trim() === word)) found.push(word);
  }
  return found;
}

// node -e / python -c のコードの中の、ファイルに書く呼び出し
const WRITE_API = /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|copyFile|renameSync|rename|unlinkSync|unlink|rmSync|rmdirSync|mkdirSync|truncateSync|cpSync|write_text|write_bytes|shutil\.(copy|copy2|copyfile|move|rmtree)|os\.(remove|rename|replace|unlink))\s*\(|\bopen\s*\([^)]*,\s*['"](w|a|x|r\+|wb|ab)['"]/;
const INLINE = /(^|[\s;&|(])(node(\.exe)?(\s+--?[\w-]+(=\S+)?)*?\s+(-e|--eval|-p|--print)|python3?(\.exe)?(\s+-[\w]+)*?\s+-c|py(\s+-[\w.]+)*?\s+-c)(\s|$)/i;
function inlineWrite(raw, bare) {
  if (!INLINE.test(bare)) return false;
  return WRITE_API.test(raw.replace(/process\.(stdout|stderr)\.write\s*\(/g, ''));
}

// bash -c・sh -c・powershell -Command の引数の中身を取り出す
function unquote(tok) {
  if (tok[0] === "'") return tok.slice(1, -1);
  return tok.slice(1, -1).replace(/\\(["\\$`])/g, '$1').replace(/`(["`$])/g, '$1');
}
const QTOK = `("(?:[^"\\\\]|\\\\.)*"|'[^']*')`;
function nested(raw) {
  const out = [];
  const sh = new RegExp('(^|[\\s;&|(])(bash|sh)(\\.exe)?((\\s+-[a-zA-Z]+)*?)\\s+-c\\s+' + QTOK, 'g');
  const ps = new RegExp('(^|[\\s;&|(])(powershell|pwsh)(\\.exe)?(\\s+-[a-zA-Z]+(\\s+[\\w]+)?)*?\\s+-(Command|c)\\s+' + QTOK, 'gi');
  let m;
  while ((m = sh.exec(raw))) out.push({ kind: 'Bash', cmd: unquote(m[6]) });
  while ((m = ps.exec(raw))) out.push({ kind: 'PowerShell', cmd: unquote(m[7]) });
  return out;
}

function checkBash(raw) {
  const reasons = [];
  const bare = stripQuotes(raw);
  const hd = heredocs(raw);
  if (hd.length) {
    if (/\bgit\b[^\n]*\bcommit\b/.test(raw)) reasons.push('git commit のメッセージをヒアドキュメント（<<' + hd[0] + '）で作っている。' + ALT_COMMIT);
    else reasons.push('ヒアドキュメント（<<' + hd[0] + '）でファイルを作ったり、命令に長い入力を渡したりしている');
  }
  if (/(^|[\s;&|(])sed\b[^;&|]*\s(-[a-zA-Z]*i[a-zA-Z.]*|--in-place)(\s|=|$)/.test(bare)) reasons.push('sed -i でファイルをその場で書き換えている');
  if (inlineWrite(raw, bare)) reasons.push('node -e・python -c のコードの中でファイルに書いている');
  const re = /(^|[^<>&0-9])(\d*|&)>>?\|?\s*(&?\d+|[^\s;&|<>()]+)/g;
  let m;
  while ((m = re.exec(bare))) {
    const t = m[3];
    if (/^&?\d+$/.test(t)) continue;                                  // 2>&1、>&2
    if (/^(\/dev\/null|NUL|nul)$/.test(t)) continue;                   // 捨てるだけ
    reasons.push('リダイレクト（' + m[0].trim() + '）でファイルを作ったり書き換えたりしている');
    break;
  }
  const teeRe = /(^|[\s;&|(])tee\b([^;&|]*)/g;
  while ((m = teeRe.exec(bare))) {
    const args = m[2].trim().split(/\s+/).filter(a => a && !a.startsWith('-'));
    if (args.length && args.every(a => /^(\/dev\/null|NUL)$/.test(a))) continue;
    reasons.push('tee でファイルを作ったり書き換えたりしている');
    break;
  }
  return reasons;
}

function checkPowerShell(raw) {
  const reasons = [];
  const bare = stripQuotes(raw);
  const cm = bare.match(/(^|[\s;|({])(Set-Content|Add-Content|Out-File|Tee-Object)\b/i);
  if (cm) reasons.push(cm[2] + ' でファイルを作ったり書き換えたりしている');
  if (/\[(System\.)?IO\.File\]::(Write|Append)\w*/i.test(raw)) reasons.push('[IO.File] の書き込みでファイルを作ったり書き換えたりしている');
  if (inlineWrite(raw, bare)) reasons.push('node -e・python -c のコードの中でファイルに書いている');
  const re = /(^|[^<>&0-9*])(\d*|\*)>>?\s*(&\d+|[^\s;&|<>()]+)/g;
  let m;
  while ((m = re.exec(bare))) {
    const t = m[3];
    if (/^&\d+$/.test(t)) continue;                                   // 2>&1
    if (/^(\$null|NUL|nul|\/dev\/null)$/i.test(t)) continue;           // 捨てるだけ
    reasons.push('リダイレクト（' + m[0].trim() + '）でファイルを作ったり書き換えたりしている');
    break;
  }
  return reasons;
}

function check(kind, raw, depth = 0) {
  const reasons = kind === 'PowerShell' ? checkPowerShell(raw) : checkBash(raw);
  if (depth < 3) for (const n of nested(raw)) for (const r of check(n.kind, n.cmd, depth + 1)) reasons.push(n.kind === 'PowerShell' ? 'powershell -Command の中で：' + r : 'bash -c・sh -c の中で：' + r);
  return reasons;
}

module.exports = { check };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => raw += d).on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch (e) { process.exit(0); }
    const kind = input.tool_name;
    if (kind !== 'Bash' && kind !== 'PowerShell') process.exit(0);
    const cmd = (input.tool_input && input.tool_input.command) || '';
    const reasons = check(kind, cmd);
    if (!reasons.length) process.exit(0);
    process.stderr.write('この命令は CLAUDE.md の書き換えの決まりに反するので hooks が止めた（tools/hooks/guard_shell_write.js）。\n理由：' + reasons.join('／') + '\n' + ALT + '\n形を変えて回り込まず、Write・Edit かファイルに書いたスクリプトに切り替えること。\n');
    process.exit(2);
  });
}
