import { readFileSync } from 'node:fs';
import { assertNodeVersion } from './setup-utils.mjs';

assertNodeVersion();
let mode = 'demo';
try { mode = JSON.parse(readFileSync(new URL('../.dot-tasks/settings.json', import.meta.url), 'utf8')).mode; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
// Only development enables the explicit fictional-data URL. Production stays live-only.
process.env.DOT_WORKBENCH_ALLOW_DEMO = '1';
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? args[portIndex + 1] : '5173';
console.log(mode === 'demo'
  ? `\nDOT Tasks demo: http://localhost:${port}/?demo=1\nFictional data. Nothing sent, scheduled, or connected.\n`
  : `\nDOT Tasks local: http://localhost:${port}/signin-with-chatgpt?return_to=/\nLocal development identity only; connect your own DOT after private deployment.\n`);
process.argv = [process.execPath, new URL('./run-framework.mjs', import.meta.url).pathname, 'dev', ...args];
await import('./run-framework.mjs');
