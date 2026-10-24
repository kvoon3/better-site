import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCommitUrl, buildCompareUrl, buildTagCompareUrl, parseGithubRepo, parseProvenance } from '../src/core/provenance.ts'

test('repository URL shapes', () => {
  assert.deepEqual(parseGithubRepo('git+https://github.com/vuejs/core.git'), {
    owner: 'vuejs',
    repo: 'core',
  })
  assert.deepEqual(parseGithubRepo('git@github.com:nuxt/nuxt.git'), {
    owner: 'nuxt',
    repo: 'nuxt',
  })
  assert.deepEqual(parseGithubRepo({ url: 'https://github.com/nuxt/nuxt/tree/main/packages/nuxt' }), { owner: 'nuxt', repo: 'nuxt' })
  assert.deepEqual(parseGithubRepo('github:vuejs/core'), {
    owner: 'vuejs',
    repo: 'core',
  })
  assert.equal(parseGithubRepo('https://gitlab.com/foo/bar'), null)
  assert.equal(parseGithubRepo(undefined), null)
})

function attestations(predicate: unknown): unknown {
  const payload = Buffer.from(JSON.stringify({ predicate })).toString('base64')
  return {
    attestations: [
      {
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: { dsseEnvelope: { payload } },
      },
    ],
  }
}

test('SLSA payload maps to repo + commit', () => {
  const provenance = parseProvenance(
    attestations({
      buildDefinition: {
        externalParameters: {
          workflow: { repository: 'https://github.com/nuxt/nuxt' },
        },
        resolvedDependencies: [{ digest: { gitCommit: '8aacdde48e8388c8bb11b9a5c2f59935341bfcfd' } }],
      },
      runDetails: {
        builder: { id: 'https://github.com/actions/runner/github-hosted' },
      },
    }),
  )
  assert.equal(provenance.hasAttestation, true)
  assert.equal(provenance.provider, 'github')
  assert.deepEqual(provenance.repo, { owner: 'nuxt', repo: 'nuxt' })
  assert.equal(provenance.commit, '8aacdde48e8388c8bb11b9a5c2f59935341bfcfd')
})

test('missing attestations are tolerated', () => {
  assert.deepEqual(parseProvenance({}), { hasAttestation: false })
  assert.deepEqual(parseProvenance(null), { hasAttestation: false })
})

test('source URLs', () => {
  const repo = { owner: 'vuejs', repo: 'core' }
  assert.equal(buildCompareUrl(repo, 'aaa1111', 'bbb2222'), 'https://diffshub.com/vuejs/core/compare/aaa1111...bbb2222')
  assert.equal(buildTagCompareUrl(repo, '3.4.0', '3.5.0'), 'https://diffshub.com/vuejs/core/compare/v3.4.0...v3.5.0')
  assert.equal(buildCommitUrl(repo, 'deadbeef'), 'https://diffshub.com/vuejs/core/commit/deadbeef')
})
