#!/usr/bin/env node
// Static lint over .maestro/flows/**.yaml. Catches the failure modes that
// otherwise surface as "no element matched X" at run time:
//
//   1. Flow missing `runFlow: ../../helpers/launch.yaml` (bridge won't be
//      ready, every assertion fails).
//   2. `text:` selectors that look generic and risk matching multiple
//      elements ("Save", "Cancel", "Edit", "Done", "OK", "Back", "+").
//      Recommend `id="m-…"` markers in source and `id:` selector in flow.
//   3. Use of `data-testid` (we picked accessibility-tree selectors per D2).
//   4. Missing `appId: app.rebirth` frontmatter.
//   5. `runFlow` referencing a file that doesn't exist on disk.
//
// Usage:
//   node scripts/maestro-selector-lint.mjs              # all flows
//   node scripts/maestro-selector-lint.mjs path/to/flow.yaml
//
// Exit code 0 = clean, 1 = warnings, 2 = errors.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { glob } from 'node:fs/promises';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const FLOWS_DIR = join(ROOT, '.maestro/flows');
const HELPERS_DIR = join(ROOT, '.maestro/helpers');

// Words that, on their own, almost always match more than one element on
// any non-trivial app screen. Lint flags `text: "<word>"` exact-match against
// these. Author should disambiguate with id="m-…" markers.
const AMBIGUOUS_TEXT = new Set([
  'Save', 'Cancel', 'Edit', 'Done', 'OK', 'Ok', 'Back', 'Close', 'Delete',
  'Submit', 'Confirm', 'Next', 'Previous', 'Yes', 'No', '+', '-',
]);

const args = process.argv.slice(2);
let targets;
if (args.length > 0) {
  targets = args.map(a => resolve(ROOT, a));
} else {
  targets = [];
  for await (const f of glob(`${FLOWS_DIR}/**/*.yaml`)) targets.push(f);
}

let errors = 0;
let warnings = 0;

for (const file of targets) {
  if (!existsSync(file)) {
    console.error(`✗ ${rel(file)}: not found`);
    errors++;
    continue;
  }
  const src = readFileSync(file, 'utf8');
  const issues = lintFlow(src, file);
  for (const issue of issues) {
    const prefix = issue.level === 'error' ? '✗' : '!';
    console.log(`${prefix} ${rel(file)}:${issue.line}: ${issue.msg}`);
    if (issue.level === 'error') errors++;
    else warnings++;
  }
}

const totalFlows = targets.length;
if (errors === 0 && warnings === 0) {
  console.log(`✓ selector-lint: ${totalFlows} flows clean`);
  process.exit(0);
}
console.log(
  `\nselector-lint: ${totalFlows} flows, ${errors} error(s), ${warnings} warning(s)`,
);
process.exit(errors > 0 ? 2 : 1);

// ── lint impl ────────────────────────────────────────────────────────────────

function lintFlow(src, file) {
  const issues = [];
  const lines = src.split('\n');
  const isHelper = file.includes('/helpers/');

  // Check 1: appId frontmatter
  if (!/^appId:\s*app\.rebirth\s*$/m.test(src)) {
    issues.push({
      level: 'error',
      line: 1,
      msg: "missing or wrong 'appId: app.rebirth' frontmatter",
    });
  }

  // Check 2: helpers should NOT runFlow launch.yaml (would loop). Flows in
  // .maestro/flows/ should start with launch.yaml unless they themselves
  // run a helper that runs launch.yaml.
  if (!isHelper) {
    const startsWithLaunch =
      /runFlow:\s*\.\.\/\.\.\/helpers\/launch\.yaml/.test(src) ||
      /file:\s*\.\.\/\.\.\/helpers\/launch\.yaml/.test(src);
    if (!startsWithLaunch) {
      issues.push({
        level: 'warn',
        line: 1,
        msg: "flow does not call runFlow ../../helpers/launch.yaml — bridge may not be ready",
      });
    }
  }

  // Check 3: data-testid usage (deprecated per D2)
  for (let i = 0; i < lines.length; i++) {
    if (/data-testid|data-test=/.test(lines[i])) {
      issues.push({
        level: 'error',
        line: i + 1,
        msg: "data-testid is not bridged to the iOS a11y tree. Use id=\"m-…\" or aria-label instead.",
      });
    }
  }

  // Check 4: ambiguous `text:` matches
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*text:\s*["']([^"']+)["']\s*$/.exec(lines[i]);
    if (m && AMBIGUOUS_TEXT.has(m[1])) {
      issues.push({
        level: 'warn',
        line: i + 1,
        msg: `text: "${m[1]}" is ambiguous on most screens — add id="m-…" to the source element and use 'id:' selector instead`,
      });
    }
  }

  // Check 5: runFlow targets exist on disk
  for (let i = 0; i < lines.length; i++) {
    const m =
      /^\s*(?:-\s+)?runFlow:\s*([^\s#]+)/.exec(lines[i]) ||
      /^\s*file:\s*([^\s#]+)/.exec(lines[i]);
    if (!m) continue;
    const ref = m[1].replace(/['"]/g, '');
    const target = resolve(dirname(file), ref);
    if (!existsSync(target)) {
      issues.push({
        level: 'error',
        line: i + 1,
        msg: `runFlow target not found: ${ref}`,
      });
    }
  }

  return issues;
}

function rel(p) {
  return p.replace(ROOT + '/', '');
}
