import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
const problems = [];
const excluded = /(^|\/)(node_modules|\.wrangler|\.sites-runtime|\.dot-tasks|\.vinext|\.next|dist)(\/|$)|(^|\/)\.env(?!\.example$)|\.(sqlite|sqlite3|db|pem|key)$/;
const privateContent = [
  ['private home path', /\/Users\/(?:yangyue|I742955)\//],
  ['original private host', /dot-workbench\.yuehyang\.chatgpt\.site/],
  ['provisioned Site ID', /appgprj_[a-f0-9]{16,}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential-shaped value', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16})\b/],
];
for (const relative of files) {
  if (excluded.test(relative)) { problems.push([relative, 'runtime/secret file']); continue; }
  const absolute = path.join(root, relative);
  if (!statSync(absolute).isFile()) continue;
  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const source = buffer.toString('utf8');
  for (const [reason, pattern] of privateContent) if (pattern.test(source)) problems.push([relative, reason]);
}
const manifest = JSON.parse(readFileSync(path.join(root, '.openai/hosting.json'), 'utf8'));
if (manifest.project_id) problems.push(['.openai/hosting.json', 'template carries a Site identity']);
for (const required of ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'README.md', 'README.zh-CN.md', 'SETUP.md', 'build/sites-vite-plugin.LICENSE', 'vendor/shadcn-tailwind-4.13.0.LICENSE.md']) {
  if (!files.includes(required)) problems.push([required, 'missing release file']);
}
if (problems.length) {
  for (const [file, reason] of problems) console.error(`${file}: ${reason}`);
  process.exitCode = 1;
} else console.log(`PASS: ${files.length} source files; no runtime folders, known private identifiers or credential patterns; template identity and license notices checked.`);
