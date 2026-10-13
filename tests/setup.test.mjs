import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNodeVersion, selectMode } from '../scripts/setup-utils.mjs';

test('requires a Node version supported by the Worker toolchain', () => {
  assert.throws(() => assertNodeVersion('20.19.0'), /22.13/);
  assert.throws(() => assertNodeVersion('22.12.0'), /22.13/);
  assert.doesNotThrow(() => assertNodeVersion('22.13.0'));
  assert.doesNotThrow(() => assertNodeVersion('24.0.0'));
});
test('repeat setup preserves empty mode unless explicitly changed', () => {
  assert.equal(selectMode([], null), 'demo');
  assert.equal(selectMode([], {mode:'empty'}), 'empty');
  assert.equal(selectMode(['--demo'], {mode:'empty'}), 'demo');
  assert.equal(selectMode(['--empty']), 'empty');
});
test('invalid modes fail before installation or data writes', () => {
  assert.throws(() => selectMode(['--reset']), /Usage/);
  assert.throws(() => selectMode(['--empty', '--demo']), /Usage/);
});
