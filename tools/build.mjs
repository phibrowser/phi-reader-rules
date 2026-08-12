#!/usr/bin/env node
// Validates rules/ and compiles it into the table the browser downloads.
//
//   node tools/build.mjs            validate, then write dist/
//   node tools/build.mjs --check    validate only, write nothing
//
// dist/v1/rules.json is the payload and carries no timestamp, so its digest
// changes only when a rule changes. Clients compare that digest to decide
// whether to download; a build-stamped payload would make every rebuild look
// like new rules. The timestamp lives in the manifest, which is cheap to
// re-fetch.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./jsonschema.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rulesDir = join(root, "rules");
const distDir = join(root, "dist", "v1");
const checkOnly = process.argv.includes("--check");

const schema = readJSON(join(root, "schema", "rule.schema.json"));
const problems = [];
const compiled = [];
const seen = new Map();

// `notes` is documentation for people reading the rule file and is deliberately
// not published.
const NOT_PUBLISHED = new Set(["notes"]);

for (const filename of readdirSync(rulesDir).sort()) {
  if (!filename.endsWith(".json")) {
    problems.push(`rules/${filename}: only .json files belong in rules/`);
    continue;
  }

  let file;
  try {
    file = readJSON(join(rulesDir, filename));
  } catch (error) {
    problems.push(`rules/${filename}: ${error.message}`);
    continue;
  }

  const schemaErrors = validate(file, schema);
  if (schemaErrors.length) {
    problems.push(...schemaErrors.map((e) => `rules/${filename}: ${e}`));
    continue;
  }

  const expected = `${file.site}.json`;
  if (filename !== expected) {
    problems.push(`rules/${filename}: site is "${file.site}", so the file must be named ${expected}`);
  }

  for (const [index, rule] of file.rules.entries()) {
    const where = `rules/${filename}: rules[${index}]`;

    if (!rule.content?.length && !rule.source) {
      problems.push(`${where}: needs content selectors, or a source to take the article from`);
    }

    if (!hostBelongsToSite(rule.host, file.site)) {
      problems.push(`${where}: host "${rule.host}" does not belong in a file for ${file.site}`);
    }

    const key = `${rule.host} ${rule.pathPrefix ?? ""} ${rule.pathContains ?? ""}`;
    if (seen.has(key)) {
      problems.push(`${where}: duplicates ${seen.get(key)} — same host and path prefix`);
    } else {
      seen.set(key, where);
    }

    for (const field of ["content", "strip", "expand"]) {
      for (const selector of rule[field] ?? []) {
        const complaint = lintSelector(selector);
        if (complaint) {
          problems.push(`${where}.${field}: "${selector}" ${complaint}`);
        }
      }
    }
    for (const field of ["title", "byline"]) {
      const complaint = rule[field] ? lintSelector(rule[field]) : null;
      if (complaint) {
        problems.push(`${where}.${field}: "${rule[field]}" ${complaint}`);
      }
    }
    // A thread field is a selector unless it starts with @, which reads an
    // attribute off the post element instead.
    for (const [field, value] of Object.entries(rule.thread ?? {})) {
      if (value.startsWith("@")) continue;
      const complaint = lintSelector(value);
      if (complaint) {
        problems.push(`${where}.thread.${field}: "${value}" ${complaint}`);
      }
    }

    const canonical = canonicalize(rule);
    for (const field of unpublishedFields(rule, canonical)) {
      problems.push(`${where}: "${field}" is valid but canonicalize() drops it, ` +
                    `so it would never reach the browser — add it there`);
    }
    compiled.push(canonical);
  }
}

if (problems.length) {
  console.error(`${problems.length} problem(s):\n`);
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}

// Sorted so the payload, and therefore its digest, does not depend on
// directory order.
compiled.sort((a, b) =>
  a.host.localeCompare(b.host) || (a.pathPrefix ?? "").localeCompare(b.pathPrefix ?? ""));

const payload = JSON.stringify({ formatVersion: 1, rules: compiled }, null, 2) + "\n";
const digest = createHash("sha256").update(payload).digest("hex");

console.log(`${compiled.length} rule(s) across ${seen.size} host pattern(s), sha256 ${digest.slice(0, 12)}`);

if (checkOnly) {
  process.exit(0);
}

const manifest = JSON.stringify({
  formatVersion: 1,
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  revision: revision(),
  rules: {
    path: "v1/rules.json",
    sha256: digest,
    bytes: Buffer.byteLength(payload),
    count: compiled.length,
  },
}, null, 2) + "\n";

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, "rules.json"), payload);
writeFileSync(join(distDir, "manifest.json"), manifest);
writeFileSync(join(root, "dist", "index.html"), landingPage(compiled.length, digest));
console.log(`wrote ${join("dist", "v1")}/{rules,manifest}.json`);

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Drops $schema and any key order difference, and omits absent optional
// fields rather than emitting nulls, so the client parses a tight object.
//
// Every field the schema allows has to be copied here. A field that is valid
// but forgotten is dropped on the way to the browser without a word — the rule
// author sees a green build and a rule that does nothing — so the omission is
// turned into a build failure below rather than left to be noticed in the
// field.
function canonicalize(rule) {
  const out = { host: rule.host };
  if (rule.pathPrefix) out.pathPrefix = rule.pathPrefix;
  if (rule.pathContains) out.pathContains = rule.pathContains;
  // Always emitted, even empty. A source-driven rule selects nothing, but
  // every browser already in the field decodes `content` as a required array,
  // and a missing key fails the whole table rather than the one rule — which
  // would silently strip every site's rules on an older build.
  out.content = rule.content ?? [];
  if (rule.source) out.source = rule.source;
  if (rule.strip?.length) out.strip = rule.strip;
  if (rule.expand?.length) out.expand = rule.expand;
  if (rule.title) out.title = rule.title;
  if (rule.byline) out.byline = rule.byline;
  if (rule.thread) out.thread = rule.thread;
  if (rule.forceRung) out.forceRung = rule.forceRung;
  return out;
}

function unpublishedFields(rule, canonical) {
  return Object.keys(rule).filter((key) =>
    !(key in canonical) && !NOT_PUBLISHED.has(key) && rule[key] !== undefined);
}

// Keeps one file per site honest: a rule in substack.com.json must target
// substack.com or a subdomain of it. Contains-wildcards are exempt, since
// their whole purpose is to match hosts that do not share a suffix.
function hostBelongsToSite(host, site) {
  if (host.startsWith("*") && host.endsWith("*") && host.length > 2) {
    return true;
  }
  const bare = host.startsWith("*.") ? host.slice(2) : host;
  return bare === site || bare.endsWith(`.${site}`);
}

// The browser calls querySelectorAll, where a malformed selector throws and
// the rule silently does nothing. Node has no DOM to parse selectors with, so
// this catches only the gross typos rather than validating CSS.
function lintSelector(selector) {
  if (selector.trim() !== selector) return "has leading or trailing whitespace";
  if (/[{}]/.test(selector)) return "looks like a CSS block, not a selector";
  if (/^[>+~,]|[>+~,]$/.test(selector)) return "starts or ends with a combinator";
  if (selector.split('"').length % 2 === 0) return "has an unbalanced quote";
  if (countOf(selector, "[") !== countOf(selector, "]")) return "has unbalanced brackets";
  if (countOf(selector, "(") !== countOf(selector, ")")) return "has unbalanced parentheses";
  return null;
}

function countOf(text, character) {
  return text.split(character).length - 1;
}

function revision() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch {
    return "unknown";
  }
}

function landingPage(count, digest) {
  return `<!doctype html>
<meta charset="utf-8">
<title>Phi Reader View site rules</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; max-width: 42rem;
         margin: 4rem auto; padding: 0 1.5rem; }
  code { font-family: ui-monospace, monospace; font-size: 0.9em; }
  a { color: inherit; }
</style>
<h1>Phi Reader View site rules</h1>
<p>Per-site extraction rules for Reader View in
<a href="https://github.com/phibrowser/phibrowser-mac">Phi Browser</a>.
Currently ${count} rule(s), digest <code>${digest.slice(0, 12)}</code>.</p>
<ul>
  <li><a href="v1/manifest.json">v1/manifest.json</a></li>
  <li><a href="v1/rules.json">v1/rules.json</a></li>
</ul>
<p>To fix Reader View on a site, open a pull request against
<a href="https://github.com/phibrowser/phi-reader-rules">phibrowser/phi-reader-rules</a>.</p>
`;
}
