import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../install.sh', import.meta.url));
const shellTest = (name, fn) => test(name, { skip: process.platform === 'win32' }, fn);
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'dot-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function run(args, env = {}) {
  return spawnSync('bash', [installer, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}
function checkout(root, remote = 'https://github.com/yueyang0120/dot-tasks.git') {
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', remote]);
  mkdirSync(path.join(root, '.openai'));
  writeFileSync(path.join(root, '.openai/hosting.json'), '{}');
}

shellTest('rejects an existing non-repository without touching its files', t => {
  const root = fixture(t);
  const marker = path.join(root, 'keep.txt');
  writeFileSync(marker, 'my existing files');
  const result = run(['--dir', root, '--no-start']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Nothing was overwritten/);
  assert.equal(readFileSync(marker, 'utf8'), 'my existing files');
});

shellTest('rejects a different repository', t => {
  const root = fixture(t);
  checkout(root, 'https://example.invalid/another-project.git');
  const result = run(['--dir', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /another repository/);
  assert.equal(execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(), 'https://example.invalid/another-project.git');
});

shellTest('does not run local setup inside a provisioned Site', t => {
  const root = fixture(t);
  checkout(root);
  writeFileSync(path.join(root, '.openai/hosting.json'), '{"project_id":"test-site"}');
  const result = run(['--dir', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deployed Site/);
});

shellTest('rejects invalid arguments before creating a destination', t => {
  const root = fixture(t);
  const result = run(['--dir', path.join(root, 'new'), '--port', '0']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Port must be/);
  assert.equal(run(['--dir']).status, 2);
  assert.equal(run(['--unknown']).status, 2);
});

shellTest('preserves an existing checkout and stops if setup fails', t => {
  const root = fixture(t);
  const app = path.join(root, 'app');
  mkdirSync(app);
  checkout(app);
  writeFileSync(path.join(app, 'keep.txt'), 'local edit');
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const log = path.join(root, 'npm.log');
  writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOT_INSTALL_TEST_LOG"\nexit "${DOT_INSTALL_TEST_EXIT:-0}"\n', { mode: 0o755 });
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, DOT_INSTALL_TEST_LOG: log };
  const result = run(['--dir', app, '--empty', '--no-start'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(log, 'utf8'), 'run setup -- --empty\n');
  assert.equal(readFileSync(path.join(app, 'keep.txt'), 'utf8'), 'local edit');
  writeFileSync(log, '');
  const failed = run(['--dir', app], { ...env, DOT_INSTALL_TEST_EXIT: '42' });
  assert.equal(failed.status, 42);
  assert.equal(readFileSync(log, 'utf8'), 'run setup\n');
  assert.doesNotMatch(failed.stdout, /Installed in/);
});
