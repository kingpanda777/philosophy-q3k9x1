// tools/hooks/guard_shell_write.js の試し。止めるべき命令と通すべき命令を hook と同じ形（標準入力の JSON）で渡し、終了コードを確かめる。
// 書き込みはしない。使い方: node tools/hooks/hook_guard_test.js（すべて期待どおりなら終了コード 0）
// guard_shell_write.js か、止める対象の道具を直したら、これを回すこと（CLAUDE.md）。
const { spawnSync } = require('child_process');
const path = require('path');
const G = path.join(__dirname, 'guard_shell_write.js');
const B = c => ['Bash', c], P = c => ['PowerShell', c];
const BLOCK = [
  B("cat > a.js <<'EOF'\nconsole.log(1)\nEOF"),
  B('cat >> tools/_work/soc_log.md <<EOF\nx\nEOF'),
  B('python - <<EOF\nprint(1)\nEOF'),
  B("git commit -q -m \"$(cat <<'EOF'\n直した\n\n本文\nEOF\n)\""),
  B("git commit -F - <<'EOF'\n直した\nEOF"),
  B("sed -i 's/a/b/' tools/unverified_list.js"),
  B('sed -i.bak -e "s/a/b/" x.txt'),
  B('sed --in-place "s/a/b/" x.txt'),
  B('node -e "require(\'fs\').writeFileSync(\'x.txt\',\'a\')"'),
  B("node -e \"const fs=require('fs');fs.appendFileSync('log.md','x')\""),
  B("node --input-type=module -e \"import fs from 'fs'; fs.promises.writeFile('x','a')\""),
  B("python -c \"open('x.txt','w').write('a')\""),
  B('node tools/unverified_list.js > tools/_work/soc_unv_out.md'),
  B('echo hi >> notes.md'),
  B('git log --oneline > log.txt'),
  B('node tools/check_keys.js 2>&1 | tee out.txt'),
  B('echo x | tee -a a.txt'),
  B('ls &> list.txt'),
  B('echo a >| b.txt'),
  B('bash -c "echo x > f.txt"'),
  B("sh -c 'sed -i s/a/b/ x.txt'"),
  B('bash -lc "cat <<EOF > f.txt\nx\nEOF\n"'),
  B('powershell -NoProfile -Command "Set-Content -Path a.txt -Value x"'),
  P('Set-Content -Path a.txt -Value "x"'),
  P('Add-Content notes.md "x"'),
  P('Get-Date | Out-File log.txt'),
  P('git status > status.txt'),
  P('echo x >> a.txt'),
  P('Get-ChildItem | Tee-Object -FilePath list.txt'),
  P('[IO.File]::WriteAllText("a.txt", "x")'),
  P('node -e "require(\'fs\').writeFileSync(\'x\',1)"'),
  P("bash -c 'echo x > f.txt'"),
];
const PASS = [
  B('git status --short'),
  B('git add -A && git commit -q -m "直した（q340）\n\n本文の2行目" && git push -q origin main'),
  B('git commit -m "note: <<EOF と > の話"'),
  B('node tools/check_keys.js >/dev/null 2>&1; echo keys=$?'),
  B('node tools/check_phil.js 2>&1 | tail -3'),
  B('node tools/add_batch.js tools/_work/soc_appr.json --dry-run 2>&1 | grep -E "要判断|結果"'),
  B('node tools/unverified_list.js --out tools/_work/soc_unv_out.md'),
  B("node -e \"const y=require('./tools/years_src.json');console.log(y['ゴフマン'])\""),
  B("node -e \"process.stdout.write(String(1+1))\""),
  B("node -e \"const s=require('fs').readFileSync('questions.js','utf8');console.log(s.length)\""),
  B('node tools/_work/soc_count.js'),
  B('curl -s https://example.com | grep -c x'),
  B('grep -n "a > b" CLAUDE.md'),
  B('echo x > /dev/null'),
  B('cmd 2>/dev/null'),
  B('node x.js | tee /dev/null'),
  B('cat <<< "hello"'),
  B('bash -c "git status"'),
  B('gh run list --limit 1 --json headSha,status,conclusion --jq \'.[0] | .headSha[0:7]+" "+.status\''),
  P('Get-Content questions.js -TotalCount 5'),
  P('git status 2>&1'),
  P('node tools/check_keys.js > $null'),
  P('Get-ChildItem | Out-Null'),
  P('Get-ChildItem | Select-Object -First 5'),
  P('Write-Output "a > b"'),
  P("git commit -m @'\n直した\n'@"),
  P('powershell -NoProfile -Command "Get-Date"'),
];
// 作業フォルダ（cwd）ごとの試し（2026年9月26日に足した）。philosophy-quiz にかかわる命令だけが止まり、ほかのアプリの命令は通ること
const PQ = 'C:\\Users\\merle\\myapps\\philosophy-quiz', MY = 'C:\\Users\\merle\\myapps';
const CWD_BLOCK = [
  [PQ, 'Bash', 'echo x > a.txt'],
  ['/c/Users/merle/myapps/philosophy-quiz', 'Bash', "sed -i 's/a/b/' x.txt"],
  [PQ + '\\tools', 'PowerShell', 'Set-Content a.txt x'],
  [MY, 'Bash', 'echo x > philosophy-quiz/a.txt'],
  [MY, 'Bash', "cd philosophy-quiz && sed -i 's/a/b/' x.txt"],
  [MY, 'Bash', "node -e \"require('fs').writeFileSync('C:/Users/merle/myapps/philosophy-quiz/x.txt','a')\""],
  [MY, 'PowerShell', 'Add-Content C:\\Users\\merle\\myapps\\philosophy-quiz\\notes.md x'],
];
const CWD_PASS = [
  [MY, 'Bash', 'echo x > a.txt'],
  [MY, 'Bash', 'echo x > news-digest/out.txt'],
  [MY + '\\news-digest', 'Bash', "python -c \"open('out.txt','w').write('a')\""],
  [MY + '\\news-digest', 'Bash', "C:/Users/merle/myapps/news-digest/.venv/Scripts/python.exe -X utf8 -c \"open('o.txt','w').write('a')\""],
  [MY + '\\news-digest', 'Bash', "cat > a.py <<'EOF'\nprint(1)\nEOF"],
  [MY + '\\shiba-pet', 'PowerShell', 'Set-Content a.txt x'],
  [MY + '\\youtube-summarizer', 'Bash', 'node x.js | tee log.txt'],
  [PQ, 'Bash', 'git status --short'],
];
let bad = 0;
const run = ([kind, cmd], cwd = PQ) => spawnSync(process.execPath, [G], { input: JSON.stringify({ tool_name: kind, tool_input: { command: cmd }, cwd }), encoding: 'utf8' });
for (const [cwd, kind, cmd] of CWD_BLOCK) { const r = run([kind, cmd], cwd); const ok = r.status === 2; if (!ok) bad++; console.log((ok ? '○ 止めた ' : '× 通した ') + '[' + cwd.split(/[\\/]/).pop() + '] ' + kind + ' ' + JSON.stringify(cmd).slice(0, 70)); }
for (const [cwd, kind, cmd] of CWD_PASS) { const r = run([kind, cmd], cwd); const ok = r.status === 0; if (!ok) bad++; console.log((ok ? '○ 通した ' : '× 止めた ') + '[' + cwd.split(/[\\/]/).pop() + '] ' + kind + ' ' + JSON.stringify(cmd).slice(0, 70)); }
const show = c => c[0] + ' ' + JSON.stringify(c[1]).slice(0, 80);
for (const c of BLOCK) { const r = run(c); const ok = r.status === 2; if (!ok) bad++; console.log((ok ? '○ 止めた ' : '× 通した ') + show(c)); }
for (const c of PASS) { const r = run(c); const ok = r.status === 0; if (!ok) bad++; console.log((ok ? '○ 通した ' : '× 止めた ') + show(c) + (ok ? '' : '  ' + (r.stderr.split('\n')[1] || ''))); }
for (const t of [{ tool_name: 'Write', tool_input: { file_path: 'a' } }, 'これは JSON ではない']) {
  const r = spawnSync(process.execPath, [G], { input: typeof t === 'string' ? t : JSON.stringify(t), encoding: 'utf8' });
  if (r.status !== 0) bad++;
  console.log((r.status === 0 ? '○ 通した ' : '× 止めた ') + (typeof t === 'string' ? '読めない入力' : 'Bash・PowerShell 以外（Write）'));
}
console.log('止めるべき ' + (BLOCK.length + CWD_BLOCK.length) + '件・通すべき ' + (PASS.length + CWD_PASS.length + 2) + '件：' + (bad ? '食い違い ' + bad + '件' : 'すべて期待どおり'));
process.exitCode = bad ? 1 : 0;
