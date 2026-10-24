import { defineConfig } from 'bumpp'

/**
 * Release config for `upm run release`
 *
 * The version lives in package.json, the extension manifest, and upm.lock. Only
 * package.json is listed in `files`, because scripts/prepare-release.mjs syncs
 * the other two before the commit and blocks the release if anything else is
 * dirty
 *
 * `all` is needed to stage the files that bumpp did not write itself
 */
export default defineConfig({
  files: ['package.json'],
  execute: 'node scripts/prepare-release.mjs',
  all: true,
  commit: 'chore: release v{version}',
  tag: 'v{version}',
})
