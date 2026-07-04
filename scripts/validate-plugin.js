#!/usr/bin/env node
/**
 * validate-plugin.js — lint one plugin's registry metadata before it is merged.
 *
 * Two modes:
 *   node scripts/validate-plugin.js plugins/<org>/<name>/metadata.json   # validate one metadata file
 *   node scripts/validate-plugin.js --all                                # validate every metadata file
 *
 * This checks the *registry-side* metadata shape (ids, semver, required version fields, artifact URL).
 * The jar's own MANIFEST.MF headers (Osrsx-Plugin-Id/Name/Version/Api-Version) and the Osrsx-Api-Version
 * compat gate are asserted in the submission workflow at build time (it has the actual jar); this script
 * is the fast PR check that needs no build.
 *
 * No external dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
// A dependency coordinate: `[<org>/]<id>[:<version-or-range>]`. The id part must be kebab-case; the
// optional range part (after ':') is validated loosely (a semver or a Maven/NeoForge range).
const DEP = /^(?:[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*(?::[^\s]+)?$/;

const errors = [];
const warnings = [];

function fail(file, msg) { errors.push(`${file}: ${msg}`); }
function warn(file, msg) { warnings.push(`${file}: ${msg}`); }

function validateMeta(file) {
  const rel = path.relative(ROOT, file);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(rel, `not valid JSON — ${err.message}`);
    return;
  }

  // Directory layout must agree with the metadata: plugins/<org>/<id>/metadata.json
  const parts = rel.split(path.sep);
  const dirOrg = parts[1];
  const dirName = parts[2];

  if (!meta.id || !ID.test(meta.id)) fail(rel, `"id" missing or not kebab-case ([a-z0-9-]): ${meta.id}`);
  else if (meta.id !== dirName) fail(rel, `"id" (${meta.id}) must match its folder name (${dirName})`);

  if (!meta.publisher) fail(rel, '"publisher" is required');
  else if (meta.publisher !== dirOrg) fail(rel, `"publisher" (${meta.publisher}) must match its org folder (${dirOrg})`);

  if (!meta.description) warn(rel, '"description" is empty');
  if (!meta.repository) warn(rel, '"repository" is empty (source link shown in the marketplace)');

  // Plugin type: `plugin` (default) or `library`. Libraries are additionally published to osrsx-maven.
  if (meta.type != null && meta.type !== 'plugin' && meta.type !== 'library') {
    fail(rel, `"type" must be "plugin" or "library" (got ${JSON.stringify(meta.type)})`);
  }

  const versions = meta.versions || {};
  const keys = Object.keys(versions);
  if (keys.length === 0) { fail(rel, 'has no versions'); return; }

  for (const v of keys) {
    if (!SEMVER.test(v)) fail(rel, `version key "${v}" is not semver`);
    const ver = versions[v] || {};
    if (!ver.artifact) fail(rel, `version ${v}: missing "artifact" (release-asset download URL)`);
    else if (!/^https:\/\//.test(ver.artifact)) fail(rel, `version ${v}: "artifact" must be an https URL`);
    if (!ver.sha256 || !/^[a-f0-9]{64}$/i.test(ver.sha256)) fail(rel, `version ${v}: "sha256" missing or not a 64-hex digest`);
    if (!ver.apiVersion || !SEMVER.test(ver.apiVersion)) fail(rel, `version ${v}: "apiVersion" missing or not semver`);
    if (!ver.date) warn(rel, `version ${v}: missing "date"`);
    // Dependencies: each a well-formed coordinate; a plugin may not depend on itself.
    const deps = ver.dependencies || [];
    if (!Array.isArray(deps)) fail(rel, `version ${v}: "dependencies" must be an array`);
    else for (const d of deps) {
      if (typeof d !== 'string' || !DEP.test(d)) { fail(rel, `version ${v}: bad dependency coordinate ${JSON.stringify(d)}`); continue; }
      const depId = d.split('/').pop().split(':')[0];
      if (depId === meta.id) fail(rel, `version ${v}: "${meta.id}" cannot depend on itself`);
    }
  }

  if (!meta.latest) fail(rel, '"latest" is required');
  else if (!versions[meta.latest]) fail(rel, `"latest" (${meta.latest}) is not among the versions`);
}

function metadataFiles() {
  const out = [];
  const pluginsDir = path.join(ROOT, 'plugins');
  if (!fs.existsSync(pluginsDir)) return out;
  for (const org of fs.readdirSync(pluginsDir)) {
    const orgDir = path.join(pluginsDir, org);
    if (!fs.statSync(orgDir).isDirectory()) continue;
    for (const name of fs.readdirSync(orgDir)) {
      const f = path.join(orgDir, name, 'metadata.json');
      if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}

function main() {
  const arg = process.argv[2];
  let files;
  if (!arg || arg === '--all') files = metadataFiles();
  else files = [path.resolve(arg)];

  if (files.length === 0) { console.log('No metadata files to validate.'); return; }
  for (const f of files) validateMeta(f);

  for (const w of warnings) console.warn(`  war: ${w}`);
  for (const e of errors) console.error(`  ERR: ${e}`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s), ${warnings.length} warning(s). FAILED.`);
    process.exit(1);
  }
  console.log(`Validated ${files.length} plugin(s): OK (${warnings.length} warning(s)).`);
}

main();
