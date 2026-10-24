import assert from 'node:assert/strict'
import test from 'node:test'
import { sha256Hex } from '../src/core/sha256.ts'

test('sha256 known vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex('The quick brown fox jumps over the lazy dog'), 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592')
})

test('sha256 matches GitHub file anchors', () => {
  // Extracted from a live GitHub PR page: id="diff-<hash>" next to
  // data-path=".buildkite/ci.mjs".
  assert.equal(sha256Hex('.buildkite/ci.mjs'), '1078881549139699f46fe2a6eb58e98c06dfd3337ce094fe1535b9141b70aa85')
})
