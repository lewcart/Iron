# Maestro UI tests

End-to-end UI tests for the iOS Capacitor build of Rebirth, run against the
simulator. Catches the regressions Lou would otherwise hit on-device:
keyboard shoving content, TabBar floating wrong, sheet dismiss broken,
scroll containers misbehaving.

See `PLAN-maestro-tests.md` (repo root) for the full design rationale.

---

## Quick start

```bash
# 0. One-time: install Maestro CLI + JDK
curl -fsSL https://get.maestro.mobile.dev | bash
brew install openjdk    # if `java` isn't on PATH

# 1. Verify environment
npm run test:maestro:doctor

# 2. Run the suite
npm run test:maestro

# 3. Iterate on a single flow
npm run test:maestro:watch .maestro/flows/smoke/launch.yaml
```

The orchestrator is `scripts/maestro-run.sh`. `npm run test:maestro` is a
thin wrapper.

---

## Subcommands

| Command | What it does |
|---|---|
| `npm run test:maestro` | Run full suite, incrementally (skips rebuild if sources unchanged) |
| `npm run test:maestro:full` | Cold rebuild + full suite |
| `npm run test:maestro:watch <file>` | Re-runs one flow on save (Maestro `--continuous`) |
| `npm run test:maestro:studio` | Maestro Studio — visual flow builder |
| `npm run test:maestro:failed` | Re-runs only flows that failed in the last run (parsed from `junit.xml`) |
| `npm run test:maestro:tree -- /feed` | Dumps the live a11y tree for a route as JSON (selector authoring) |
| `npm run test:maestro:doctor` | Verifies Maestro, JDK, sim, and `.maestro/flows` without running anything |

Pass-through args after `--` go to `maestro test`. Example: only run the
keyboard flows: `npm run test:maestro -- .maestro/flows/keyboard`.

---

## Authoring a new flow

1. Identify the regression. One sentence. e.g. "Keyboard hides the workout
   reps input." Don't author flows for hypothetical bugs — only real ones.
2. Pick the bucket: `keyboard/`, `tabbar/`, `scroll/`, `sheets/`, `nav/`.
3. Dump the live tree for the route you'll test:
   ```bash
   npm run test:maestro:tree -- /workout
   ```
   Grep the JSON for the element you want to interact with. Note its
   `name` (visible text or `aria-label`), `id`, or `role`.
4. Copy the closest existing flow as a skeleton.
5. Open it in watch mode:
   ```bash
   npm run test:maestro:watch .maestro/flows/keyboard/your-new-flow.yaml
   ```
6. Iterate until green.

### Selector preference (highest first)

1. **`id="m-…"` markers** — only when text/aria are ambiguous. Naming:
   `m-{surface}-{element}` (e.g. `m-addfood-search`, `m-workout-rir-3`).
2. **`accessibility-label` / `aria-label`** — for icon-only buttons or
   when text varies.
3. **Visible text** — for stable button labels and headings.

If `text:` matches more than one element, Maestro errors with
`AssertionError - Found N elements matching X`. Disambiguate by adding
an `id="m-…"` to the source element rather than fighting selectors.

### The 25-line rule

If a flow exceeds ~25 lines, extract a helper into `.maestro/helpers/`
and `runFlow:` into it. The keyboard-overlap assertion alone is reason
enough — see `helpers/actions/assert-above-keyboard.yaml`.

---

## Helpers inventory

| Helper | What it does | Required env |
|---|---|---|
| `helpers/launch.yaml` | Launch app, wait for bridge `ready()`, confirm /feed paints | (none) |
| `helpers/reset-data.yaml` | Clear Dexie + storage, reload, re-init bridge | (none) |
| `helpers/actions/open-sheet.yaml` | Tap a sheet trigger, assert sheet opened | `TRIGGER_TEXT`, `SHEET_TITLE` |
| `helpers/actions/dismiss-sheet-swipe.yaml` | Swipe down to dismiss sheet | `SHEET_TITLE` |
| `helpers/actions/dismiss-sheet-backdrop.yaml` | Tap backdrop to dismiss sheet | `SHEET_TITLE` |
| `helpers/actions/assert-above-keyboard.yaml` | Assert element bottom is above keyboard top | `SELECTOR_TEXT` |

Use `runFlow` with `env:` to invoke them:
```yaml
- runFlow:
    file: ../../helpers/actions/open-sheet.yaml
    env:
      TRIGGER_TEXT: "Add food"
      SHEET_TITLE: "Add food"
```

---

## The test bridge

When the app is built with `NEXT_PUBLIC_E2E=1` (i.e. via `npm run build:cap:e2e`),
the React tree mounts `window.__rebirthTestBridge` with these methods:

```ts
ready():    Promise<void>           // resolves after Dexie open
reset():    Promise<void>           // clear Dexie + localStorage + sessionStorage, reload
seed(name): Promise<void>           // load named fixture from src/lib/test-fixtures/
setClock(iso | null):  void         // pin Date.now() via now-provider shim
getTree():  TreeNode                // a11y-flavoured DOM snapshot for selector authoring
```

In any flow, call via `evalScript`:
```yaml
- evalScript: |
    (async () => {
      await window.__rebirthTestBridge.ready();
    })()
```

The bridge module is dynamically imported only inside an
`if (process.env.NEXT_PUBLIC_E2E === '1')` branch in
`src/app/providers.tsx`. Webpack DCE elides the import in non-E2E builds.
The pre-ship guard `scripts/check-no-test-bridge.sh` greps `out/` for
`__rebirthTestBridge` and fails the build if found.

---

## Failure modes (and what to do)

| Symptom | Likely cause | Fix |
|---|---|---|
| `test bridge not present` | App built without `NEXT_PUBLIC_E2E=1` | Run `npm run test:maestro` (orchestrator handles it). If you ran maestro directly, use `npm run build:cap:e2e` first. |
| `No element matched X` | Selector ambiguous OR element not yet rendered | `npm run test:maestro:tree -- <route>` to confirm the element exists. Add `id="m-…"` if ambiguous. Add `assertVisible` with `timeout` before the action. |
| `sim '<name>' not found` | Sim renamed or deleted | Set `REBIRTH_SIM_NAME=<actual name>` env or recreate sim in Xcode. `xcrun simctl list devices` lists all. |
| `xcodebuild` slow on first run | Cold cache + signing prompt | Expected. Run `npm run test:maestro:doctor` to pre-warm. |
| Flow flakes intermittently | Animation timing OR network race | Add `retries: 1` to that flow's frontmatter (NOT global). Document why above the field. |
| Last item under TabBar | Page missing `pb-[var(--tab-bar-height)]` on its scroll container | Real bug — fix the page, then add it to the scroll bucket. |

---

## CI / `/ship` integration

For pre-push, run the bundled gates:
```bash
npm run ship:checks
```

That runs, in order: vitest → selector-lint → maestro suite → clean prod
build → grep guard for bridge leaks. Any step failing halts the pipeline.

Wire into the `/ship` skill by adding `npm run ship:checks` to its
pre-push step. Already-running steps inside `/ship` (vitest, prod build)
can be skipped via `SKIP_VITEST=1` to avoid double-runs.

Emergency override:
- `SKIP_MAESTRO=1 npm run ship:checks` — skips maestro suite AND grep
  guard (since both depend on the maestro pipeline). Records the skip
  in `.maestro-out/skip-log.txt`. `/ship` surfaces the count over the
  last 14 days — three-in-a-row should be a forcing function to fix
  the suite, not a habit.

No GitHub Actions yet. Single-user, direct-to-main, macOS minutes 10x
cost. Revisit if `SKIP_MAESTRO=1` usage trends up.

---

## Pair-programming with Claude Code

See `.maestro/AGENTS.md` for the CC authoring contract.
