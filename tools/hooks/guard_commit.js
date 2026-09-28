// Claude Code の PreToolUse hook（matcher "Bash|PowerShell"）で、作業ツリーに入れていない変更を残したままの git commit を止める。
// 2026年9月28日、引用の照らし直しの回で作った（道具が作り直した philosophers.js を入れ漏らしたため。CLAUDE.md「Git の運用」の手順4）。
// 設定は guard_shell_write.js と同じく philosophy-quiz と myapps の二か所の .claude/settings.local.json に並べる（CLAUDE.md「hooks で書き換えの決まりを止める」）。
// philosophy-quiz の作業（cwd が philosophy-quiz の中か、命令に philosophy-quiz のパスを含むもの）だけを見る。
//
// 止める条件：命令に git commit があり、philosophy-quiz のリポジトリに次のどれかがあるとき
//   ・add していない変更（git diff --name-only が空でない）。commit -a／--all のときは見ない（そのまま入るため）
//   ・Git に入っていない新しいファイル（git ls-files --others --exclude-standard が空でない。.gitignore に入れたものは出ない）
// 止めたときは、ファイルの一覧を標準エラーに出して終了コード 2。
// 止まったのが、わざとコミットに入れない変更だったときは、git stash で退避せずにそこで止まって利用者に報告する（2026年9月28日に利用者が決めた）。
// 入力が読めない・git が落ちる・時間切れのときは止めずに通す（guard_shell_write.js と同じ扱い）。
// このスクリプトを直したら、node tools/hooks/hook_guard_test.js を回すこと（この hook の試しも入っている）。

const { execFileSync } = require('child_process');
const { inScope, stripQuotes } = require('./guard_shell_write.js');
const PQ = 'C:/Users/merle/myapps/philosophy-quiz';

// 命令に git commit があるか。引用符の中（コミットメッセージの文など）は見ない
function commitKind(cmd) {
  const bare = stripQuotes(String(cmd));
  const m = bare.match(/(^|[\s;&|(])git(\.exe)?(\s+-C\s+\S+)?\s+commit\b([^;&|\n]*)/i);
  if (!m) return null;
  // 同じ命令の中で git add -A／--all／. をしてからコミットするなら、全部が入るので見ない（hook は add より前に走るため）。
  // git add にファイルを名前で渡して同じ命令でコミットすると、add の前の状態を見て止まる。そのときは add とコミットを分けて流す
  if (/(^|[\s;&|(])git(\.exe)?(\s+-C\s+\S+)?\s+add\s+(-A|--all|\.)(\s|$)/i.test(bare.slice(0, m.index + m[0].length))) return 'addall';
  return /\s(-a\w*|--all)\b/.test(' ' + m[4]) ? 'all' : 'normal';
}

function leftovers(kind, run) {
  const out = [];
  if (kind === 'addall') return out;
  if (kind !== 'all') for (const f of run(['diff', '--name-only'])) out.push('add していない変更: ' + f);
  for (const f of run(['ls-files', '--others', '--exclude-standard'])) out.push('Git に入っていないファイル: ' + f);
  return out;
}

const gitRun = args => execFileSync('git', ['-C', PQ, ...args], { encoding: 'utf8', timeout: 8000 }).split(/\r?\n/).filter(Boolean);

module.exports = { commitKind, leftovers };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => raw += d).on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch (e) { process.exit(0); }
    const tool = input.tool_name;
    if (tool !== 'Bash' && tool !== 'PowerShell') process.exit(0);
    const cmd = (input.tool_input && input.tool_input.command) || '';
    if (!inScope(input.cwd, cmd)) process.exit(0);
    const kind = commitKind(cmd);
    if (!kind) process.exit(0);
    let rest;
    try { rest = leftovers(kind, gitRun); } catch (e) { process.exit(0); }
    if (!rest.length) process.exit(0);
    process.stderr.write('作業ツリーにコミットへ入れていない変更が残っているので、hooks がコミットを止めた（tools/hooks/guard_commit.js。CLAUDE.md「Git の運用」の手順4）。\n' +
      rest.map(x => '  ' + x).join('\n') + '\n' +
      '入れるものなら git add してから、もう一度コミットする。わざと入れない変更なら、git stash で退避せず、ここで止まって利用者に報告する。\n');
    process.exit(2);
  });
}
