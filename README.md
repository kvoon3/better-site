# Better Site

> Switch between **GitHub ↔ DiffsHub** and **npm ↔ npmx** without losing your place.

![The rail and the dependency bridge on a GitHub pull request](docs/rail.png)

<sub>The screenshot was taken with the anonymous GitHub API budget exhausted, so
the panel shows its page-ref fallback. With a token (or a fresh budget) the refs
come from the API's exact merge base.</sub>

Better Site is a small Chrome extension (Manifest V3) for the two best
"alternate frontends" in the JavaScript ecosystem:

- [DiffsHub](https://diffshub.com) renders GitHub diffs with a virtualized,
  streaming viewer.
- [npmx](https://npmx.dev) is a fast browser for the npm registry, including
  version diffs and a code viewer.

Both are read-only mirrors with their own URL grammar. Better Site adds the
missing part: **a way to move between them, carrying the file/line you were
looking at, plus two semantic bridges that neither site can build alone.**

## What it does

- **Floating rail** on every supported page. It shows where you are and where
  you can go. Click a chip to switch.
- **`Alt+Shift+D`** — toggle GitHub ↔ DiffsHub.
- **`Alt+Shift+N`** — toggle npm ↔ npmx.
- **`Alt+Shift+B`** — open the bridge panel.
- **Back chip** — after a switch, `↩ GitHub` (or `↩ npmx`) takes you back to the
  exact URL you came from.
- **Works in place** — the rail is a shadow-DOM overlay; it never changes the
  page layout.
- **Dependencies** — on any GitHub/DiffsHub diff, the panel reads the root
  `package.json` + lockfiles on both sides and lists every dependency bump with
  a direct link to the matching npmx version diff.
- **Source diff** — on an npmx version diff or version page, the panel resolves
  the source repository and commit from npm provenance, then links to the exact
  DiffsHub `compare` (or `commit`).

The URL algebra is also usable without the extension: build once, open
`dist/demo.html`, and paste any supported URL to see its alternates.

## Install

```bash
# one-time (macOS/Linux): install upm
# (or manage it with mise: `mise use -g npm:upm`)
curl -fsSL https://upm.sh/install.sh | sh

upm install
upm run build
```

Dependencies are pinned in `upm.lock`; use `upm install --frozen-lockfile` in CI.

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** → select `dist/`.
4. Open a GitHub PR, a DiffsHub diff, an npm package, or an npmx page.

Chrome/Edge 114+. Firefox is not wired up yet (MV3 service-worker differences).

### Optional: GitHub token

The dependency bridge calls the GitHub API and `raw.githubusercontent.com`.
Anonymous API access is limited to 60 requests/hour per IP. The extension
degrades gracefully (it falls back to the refs embedded in the PR page), but a
token makes it exact and unlocks private repositories.

Open the extension's **Settings** page and paste a fine-grained token with
**Contents: read** and **Pull requests: read**. The page checks it against
`api.github.com` and shows the remaining hourly budget. The token is stored in
`chrome.storage.local` and sent only to `api.github.com` and
`raw.githubusercontent.com`. The same page has a switch for the floating rail;
the keyboard shortcuts keep working when the rail is hidden.

This token is separate from the token DiffsHub stores on its own origin for its
own private-diff feature.

## URL algebra

### GitHub ↔ DiffsHub

| Semantic view     | GitHub                          | DiffsHub                         |
| ----------------- | ------------------------------- | -------------------------------- |
| Pull request      | `github.com/o/r/pull/7`         | `diffshub.com/o/r/pull/7`        |
| Files changed tab | `github.com/o/r/pull/7/changes` | `diffshub.com/o/r/pull/7` (307)  |
| Commit            | `github.com/o/r/commit/<sha>`   | `diffshub.com/o/r/commit/<sha>`  |
| Compare           | `github.com/o/r/compare/a...b`  | `diffshub.com/o/r/compare/a...b` |
| Raw diff          | `github.com/o/r/pull/7.diff`    | `diffshub.com/o/r/pull/7`        |
| Shorthand         | `o/r#7`                         | `diffshub.com/o/r/pull/7`        |

### npm ↔ npmx

| Semantic view  | npm                              | npmx                                                       |
| -------------- | -------------------------------- | ---------------------------------------------------------- |
| Package        | `npmjs.com/package/vue`          | `npmx.dev/package/vue`                                     |
| Version        | `npmjs.com/package/vue/v/3.5.27` | `npmx.dev/package/vue/v/3.5.27`                            |
| Scoped package | `npmjs.com/package/@nuxt/kit`    | `npmx.dev/package/@nuxt/kit`                               |
| Search         | `npmjs.com/search?q=vue`         | `npmx.dev/search?q=vue`                                    |
| User / org     | `npmjs.com/~user`, `/org/nuxt`   | `npmx.dev/~user`, `/org/nuxt`                              |
| Version diff   | —                                | `npmx.dev/diff/vue/v/3.5.26...3.5.27`                      |
| Code line      | —                                | `npmx.dev/package-code/vue/v/3.5.27/dist/vue.d.ts#L10-L20` |

npmx also accepts npm-compatible paths and `xnpmjs.com`; the bridge always
emits canonical npmx URLs.

### Anchors are translated, not dropped

| Surface   | File selection                     | Line selection                   |
| --------- | ---------------------------------- | -------------------------------- |
| GitHub    | `#diff-<sha256(path)>`             | `R42`, `L42`, `R42-R50`          |
| DiffsHub  | `#target=<path>&start=A42&end=A50` | `A` = additions, `D` = deletions |
| npmx diff | `?file=<path>`                     | — (not supported by npmx yet)    |
| npmx code | path segment                       | `#L42-L50`                       |

Examples of what the bridge produces:

```
diffshub.com/o/r/pull/7#target=src/a.ts&start=A42
  → github.com/o/r/pull/7/changes#diff-<sha256("src/a.ts")>R42
```

GitHub only exposes the file path through the rendered page, so GitHub → the
other side resolves the `#diff-` hash against `[data-path]` elements before
navigating. DiffsHub → GitHub is fully deterministic: the path is already in
the hash.

## The two bridges

### Dependencies: git diff → published diff

On a GitHub/DiffsHub diff the extension:

1. Resolves the before/after refs. Pull requests use the API's exact merge base;
   compares use `merge_base_commit`; commits use the first parent.
2. Fetches the root `package.json` and lockfiles
   (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`,
   `bun.lock`) at both refs. This is why the diff is _published_ data rather than
   a fragile parse of patch hunks.
3. Parses resolved versions and compares them. Falls back to declared versions in
   `package.json` when no lockfile is committed.
4. Renders a link per change: `npmx.dev/diff/<pkg>/v/<from>...<to>`, or the
   version page for added/removed packages.

When the GitHub API is rate-limited, the content script reads the PR page's
embedded `headSha` and `baseBranch` and the background uses them as an
approximate fallback (the base is the current branch tip, so unrelated changes
may appear). The panel says so.

### Source: npm version → git commit

On an npmx version diff or version page the extension:

1. Reads `registry.npmjs.org/<pkg>/<version>` for both versions.
2. Fetches the npm attestations bundle and decodes the SLSA provenance payload.
3. If both versions have the same GitHub repository and a
   `resolvedDependencies[0].digest.gitCommit`, builds the exact
   `diffshub.com/<owner>/<repo>/compare/<sha1>...<sha2>`.
4. Otherwise falls back to the package's `repository` field and guessed release
   tags (`v1.2.3`), clearly marked as a guess.

No scraping of either site is involved. The extension reads upstream APIs and
generates links; DiffsHub and npmx render the result.

## Architecture

```
src/core/                  pure TypeScript, no browser globals
  parse.ts                 four URL grammars → Surface
  anchors.ts               GitHub / DiffsHub / npmx anchor codecs
  switch.ts                Surface → alternates, state-preserving URLs
  sha256.ts                synchronous file-anchor hashing
  lockfiles.ts             package-lock / pnpm / yarn / bun readers
  deps.ts                  version diffing + manifest fallback
  provenance.ts            SLSA → repo + commit → DiffsHub URLs
src/extension/
  background.ts            refs, API/raw fetches, caching, commands, switch stack
  content.ts               rail, DOM state, bridge panels
  rail.ts                  shadow-DOM UI
  settings.ts              shared chrome.storage helpers
src/settings/              Solid 2 + StyleX settings page
src/demo/                  URL playground
scripts/build.mjs          esbuild for the extension, Vite for settings
scripts/verify-extension.mjs  real Chrome + CDP smoke test
```

The service worker is the only place that talks to the network. Content scripts
hold no secrets and never call GitHub directly. The switch stack is per tab and
cleared when you navigate somewhere unrelated.

## Develop

```bash
upm run dev        # Vite dev server for the settings page
upm run lint       # oxlint: StyleX, antfu, and anti-slop rules
upm run format     # oxfmt: no semicolons, 2 spaces, 320-column width
upm run check      # typecheck + lint + format check + unit tests + build
```

Commits follow Conventional Commits. `simple-git-hooks` installs a `pre-commit`
hook that runs `nano-staged` (oxfmt + oxlint on staged files) and a `commit-msg`
hook that runs `commitlint`.

## Verify

```bash
upm run verify     # launch Chrome for Testing with the extension and drive it
```

`upm run verify` uses `CHROME_PATH` if set; otherwise it looks for Chrome for
Testing, Chromium, then Google Chrome. It checks the rail, both toggles, the
dependency panel, and the provenance source link against real pages. To use a
different PR or save a screenshot:

```bash
PR_URL="https://github.com/npmx-dev/npmx.dev/pull/3193" SHOT=1 upm run verify
```

## Known limits (MVP)

- Only the **root** manifest and lockfile are compared. Monorepo package
  lockfiles in subdirectories are not read yet.
- The source bridge compares the whole repository; `repository.directory`
  (monorepo packages) is ignored, so the source diff can be wider than the
  package.
- The approximate ref fallback reads the GitHub PR page, so it is only available
  when you open **Deps on GitHub**. On DiffsHub the bridge needs the API, hence a
  token, when the anonymous budget is spent.
- DiffsHub supports GitHub and Tangled; the bridge only maps GitHub.
- npmx has no npmjs equivalent for version diffs, code-line views, changelogs,
  timelines, or stats. The rail disables those alternates instead of inventing a
  destination.
- Private npm registries and GitHub Enterprise are out of scope.
- GitHub file anchors require the file to be rendered on the page (or a token +
  API expansion later). If the file isn't in the DOM, the switch preserves the
  PR but not the line.
- The dependency panel compares root lockfile state, not the exact `package.json`
  ranges in the diff. It intentionally shows resolved versions.
- npmx's diff view has no line anchor yet; the bridge preserves the file only.
  Adding `#L` support to npmx would be a small upstream PR.

## Roadmap

- **Source vs Published**: a "publish report" that joins the git diff and the
  npm tarball diff for the same release — files present in only one side,
  changed build output, missing `dist/` files. This is the flagship idea the two
  surfaces enable together.
- Native cross-links in both sites (a DiffsHub dependency chip, an npmx "source
  diff" command) so the bridge works without the extension.
- `/.well-known/surfaces.json` + `<link rel="alternate">` so browsers, editors,
  and agents can discover surfaces without a bundled rule table.
- A `surface` CLI that reuses `src/core` for PR review agents and CI.
- Firefox build and a side-panel "dock" mode.

## Research notes

- DiffsHub lives in `pierrecomputer/pierre/apps/diffshub` (Apache-2.0). Its data
  plane is a streaming `GET /api/diff?path=…` proxy with a public → authenticated
  → GitHub API fallback chain; the client parses `diff --git` boundaries as they
  stream in and renders with `@pierre/diffs` CodeView + FileTree.
- npmx lives in `npmx-dev/npmx.dev` (MIT). Version diffs compare **published
  tarballs** via jsDelivr, not git. Provenance comes from npm attestations
  (SLSA), which is the exact edge this bridge uses.
- GitHub's diff file anchor is `sha256(path)`, verified against live pull
  request HTML.

## License

MIT
