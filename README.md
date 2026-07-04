# osrsx-central — the osrsx plugin registry

The central, versioned index of community plugins for the [osrsx](https://github.com/osrsx/osrsx-client)
client. The in-game **Marketplace** reads [`registry.json`](registry.json) from this repo to let users
search, install, and update plugins.

Modeled on the [`zigglers/rachet`](https://github.com/zigglers/rachet) (Clanker) registry, adapted for
JVM plugins: plugins are **jars** hosted as GitHub **Release assets** (not committed to git), and the
build step is `./gradlew build`.

## How it works

```
author opens an issue ──► CI clones the repo, ./gradlew build
                          ├─ validates the jar's MANIFEST.MF (Osrsx-Plugin-Id/Version/Api-Version)
                          ├─ publishes the jar as a Release asset (+ sha256)
                          └─ writes plugins/<org>/<name>/metadata.json on a bot branch ──► review PR
maintainer merges the PR ──► update-registry.yml regenerates registry.json ──► live for clients
```

- **Submit a plugin:** open a [Plugin submission issue](../../issues/new?template=plugin_submission.yml)
  pointing at your plugin repo (start from
  [`osrsx/osrsx-template`](https://github.com/osrsx/osrsx-template)).
- **Approval:** a maintainer merges the bot PR. Merge = approved & live.
- **Client discovery:** the marketplace fetches
  `https://raw.githubusercontent.com/osrsx/osrsx-central/main/registry.json`, then downloads each
  plugin's `artifact` jar into `~/.osrsx/plugins/` (verifying `sha256` and the `Osrsx-Api-Version` compat
  gate) where the client's directory watcher loads it.

## Layout

```
registry.json                       # generated index (client-facing) — DO NOT hand-edit
scripts/
  generate-registry.js              # plugins/**/metadata.json -> registry.json
  validate-plugin.js                # metadata-shape + semver + artifact/sha256 lint (PR check)
.github/
  ISSUE_TEMPLATE/plugin_submission.yml
  workflows/{plugin-submission,create-plugin-pr,update-registry}.yml
plugins/<org>/<name>/
  metadata.json                     # all versions + latest pointer (source of truth)
  <version>/manifest.yml            # per-version snapshot (human-readable)
```

## `registry.json` entry schema

```json
{
  "id": "ziggle-dev/woodcutter",
  "org": "ziggle-dev",
  "name": "Woodcutter",
  "description": "Chops a configured tree and drops or banks the logs.",
  "author": "ziggle-dev",
  "latest": "1.2.0",
  "versions": ["1.0.0", "1.1.0", "1.2.0"],
  "apiVersion": "0.1.0",
  "tags": ["skilling", "afk"],
  "repository": "https://github.com/ziggle-dev/osrsx-woodcutter",
  "readme":   "https://raw.githubusercontent.com/ziggle-dev/osrsx-woodcutter/v1.2.0/README.md",
  "artifact": "https://github.com/osrsx/osrsx-central/releases/download/woodcutter-1.2.0/woodcutter-1.2.0.jar",
  "sha256": "…",
  "created": "2026-07-01",
  "updated": "2026-07-03"
}
```

## Per-plugin `metadata.json` (the source of truth)

```json
{
  "id": "woodcutter",
  "name": "Woodcutter",
  "description": "Chops a configured tree and drops or banks the logs.",
  "publisher": "ziggle-dev",
  "author": "ziggle-dev",
  "repository": "https://github.com/ziggle-dev/osrsx-woodcutter",
  "tags": ["skilling", "afk"],
  "versions": {
    "1.2.0": {
      "date": "2026-07-03",
      "commit": "abc1234",
      "apiVersion": "0.1.0",
      "sha256": "…",
      "artifact": "https://github.com/osrsx/osrsx-central/releases/download/woodcutter-1.2.0/woodcutter-1.2.0.jar",
      "readme": "https://raw.githubusercontent.com/ziggle-dev/osrsx-woodcutter/abc1234/README.md"
    }
  },
  "latest": "1.2.0"
}
```

## Setup notes (maintainers)

- Add a repo secret **`BOT_TOKEN`** (a PAT or GitHub App token with `contents:write` and
  `pull-requests:write` on this repo) — the submission workflow uses it to push the bot branch, create
  releases, and open the review PR so those actions can trigger the downstream workflow.
- Regenerate locally: `node scripts/generate-registry.js`. Validate: `node scripts/validate-plugin.js --all`.
  Both are dependency-free (plain Node).

Part of the osrsx plugin SDK — see the client's `docs/PLUGIN_MARKETPLACE_PLAN.md`.
