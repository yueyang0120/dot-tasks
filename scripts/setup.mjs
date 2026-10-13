import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertNodeVersion, selectMode } from './setup-utils.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDir = path.join(root, '.dot-tasks');
async function json(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function run(args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Setup step failed (${signal || code}). Correct the error above and run setup again.`)));
  });
}
try {
  assertNodeVersion();
  if (!process.env.npm_execpath) throw new Error('Start with npm run setup.');
  const settings = await json(path.join(stateDir, 'settings.json'));
  const mode = selectMode(process.argv.slice(2), settings);
  const lockHash = createHash('sha256').update(await readFile(path.join(root, 'package-lock.json'))).digest('hex');
  const receipt = await json(path.join(stateDir, 'dependencies.json'));
  let dependenciesPresent = false;
  try { await access(path.join(root, 'node_modules/vinext/dist/cli.js')); dependenciesPresent = true; } catch {}
  await mkdir(stateDir, { recursive: true });
  if (!dependenciesPresent || receipt?.lockHash !== lockHash) {
    console.log('\n1/3 Installing locked dependencies…');
    await run([process.env.npm_execpath, 'run', 'install:ci']);
    await writeFile(path.join(stateDir, 'dependencies.json'), JSON.stringify({ lockHash }) + '\n');
  } else console.log('\n1/3 Locked dependencies already installed.');
  console.log('\n2/3 Building the local Worker…');
  await run([process.env.npm_execpath, 'run', 'build']);
  console.log('\n3/3 Applying local database migrations…');
  const configPath = path.join(root, 'dist/server/wrangler.json');
  const config = await json(configPath);
  config.main = path.resolve(path.dirname(configPath), config.main);
  if (config.assets?.directory) config.assets.directory = path.resolve(path.dirname(configPath), config.assets.directory);
  for (const db of config.d1_databases || []) db.migrations_dir = path.join(root, 'drizzle');
  const migrationConfig = path.join(stateDir, 'wrangler-migrations.json');
  await writeFile(migrationConfig, JSON.stringify(config, null, 2) + '\n');
  await run(['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', migrationConfig, '--persist-to', '.wrangler/state'], { ...process.env, CI: 'true' });
  await writeFile(path.join(stateDir, 'settings.json'), JSON.stringify({ mode }, null, 2) + '\n');
  console.log(`\nReady. Run npm run dev.\n${mode === 'demo' ? 'Open the printed /?demo=1 URL for fictional, temporary data. DOT is not connected.' : 'Open the printed local sign-in URL for an empty, persistent database. DOT is not connected.'}\nSetup has not created a hosted Site, connected an account, or enabled scheduled work.`);
} catch (error) {
  console.error('\n' + error.message);
  process.exitCode = 1;
}
