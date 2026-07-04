#!/usr/bin/env node
/**
 * generate-registry.js — build the client-facing registry.json index from the per-plugin metadata.
 *
 * Walks `plugins/<org>/<name>/metadata.json` and rolls each up into one flat registry entry. This is the
 * single source of truth the in-game marketplace reads (via raw.githubusercontent). It is regenerated on
 * every merge to `main` that touches `plugins/**` (see .github/workflows/update-registry.yml) — never
 * hand-edit registry.json.
 *
 * Port of zigglers/rachet's scripts/generate-registry.js, adapted for osrsx: plugins are JVM jars hosted
 * as GitHub Release assets (not JS bundles committed to git), so each version carries `artifact`
 * (download URL), `sha256`, and `apiVersion` (the Osrsx-Api-Version the jar built against).
 *
 * No external dependencies — plain Node so CI needs no `npm install`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLUGINS_DIR = path.join(ROOT, 'plugins');
const OUT = path.join(ROOT, 'registry.json');

/** Compare two semver strings; returns <0, 0, >0. Pre-release tags are compared lexically after the core. */
function compareSemver(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v).split('-');
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
    return { nums, pre: pre || '' };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa.nums[i] || 0) !== (pb.nums[i] || 0)) return (pa.nums[i] || 0) - (pb.nums[i] || 0);
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1; // a release outranks any pre-release of the same core
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** Read a JSON file, returning null on any failure (a malformed metadata file just gets skipped + warned). */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`  ! skipping ${path.relative(ROOT, file)}: ${err.message}`);
    return null;
  }
}

/** Collapse one plugin's metadata.json into a single flat registry entry. */
function toEntry(org, meta) {
  const versionsMap = meta.versions || {};
  const versions = Object.keys(versionsMap).sort(compareSemver);
  if (versions.length === 0) return null;

  // Latest = the highest published semver (versions are sorted ascending), so it's order-independent —
  // re-submitting an older version can never demote the latest pointer.
  const latest = versions[versions.length - 1];
  const latestV = versionsMap[latest] || {};
  const dates = versions.map((v) => versionsMap[v].date).filter(Boolean).sort();

  // Per-version detail powering the marketplace version selector: SDK-compat gating (apiRange), per-version
  // install (artifact/sha256) and changelog history. Keyed by version string.
  const versionInfo = {};
  for (const v of versions) {
    const vv = versionsMap[v] || {};
    versionInfo[v] = {
      apiVersion: vv.apiVersion || null,
      apiRange: vv.apiRange || '',
      changelog: vv.changelog || '',
      artifact: vv.artifact || '',
      sha256: vv.sha256 || '',
      date: vv.date || '',
    };
  }

  return {
    id: `${org}/${meta.id}`,
    org,
    name: meta.name || meta.id,
    description: meta.description || '',
    author: meta.author || org,
    authors: meta.authors || (meta.author ? [meta.author] : []),
    latest,
    versions,
    apiVersion: latestV.apiVersion || meta.apiVersion || null,
    tags: meta.tags || [],
    repository: meta.repository || '',
    readme: latestV.readme || meta.readme || '',
    artifact: latestV.artifact || '',
    sha256: latestV.sha256 || '',
    changelog: latestV.changelog || '',
    versionInfo,
    created: dates[0] || latestV.date || '',
    updated: dates[dates.length - 1] || latestV.date || '',
  };
}

function main() {
  const plugins = [];
  if (fs.existsSync(PLUGINS_DIR)) {
    for (const org of fs.readdirSync(PLUGINS_DIR)) {
      const orgDir = path.join(PLUGINS_DIR, org);
      if (!fs.statSync(orgDir).isDirectory()) continue;
      for (const name of fs.readdirSync(orgDir)) {
        const metaFile = path.join(orgDir, name, 'metadata.json');
        if (!fs.existsSync(metaFile)) continue;
        const meta = readJson(metaFile);
        if (!meta) continue;
        const entry = toEntry(org, meta);
        if (entry) plugins.push(entry);
        else console.warn(`  ! ${org}/${name}: no versions, skipped`);
      }
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));

  const registry = {
    version: '1.0.0',
    plugins,
    // `updated` is intentionally the build time; overridden deterministically in CI via SOURCE_DATE if set.
    updated: process.env.SOURCE_DATE || new Date().toISOString(),
    totalPlugins: plugins.length,
  };

  fs.writeFileSync(OUT, JSON.stringify(registry, null, 2) + '\n');
  console.log(`Wrote ${path.relative(ROOT, OUT)} — ${plugins.length} plugin(s).`);
}

main();
