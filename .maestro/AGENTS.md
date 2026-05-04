# .maestro/AGENTS.md — Claude Code authoring contract

You are writing a Maestro flow for Rebirth. You can't open Maestro Studio.
This file gives you everything you need to author a flow without the GUI.

## Workflow

1. **Confirm the bug exists.** Read the issue or bug report. State in one
   sentence what regression the flow is testing for. If you can't, stop —
   you're authoring against a hypothesis, not a regression.
2. **Pick the bucket.** `keyboard/`, `tabbar/`, `scroll/`, `sheets/`, `nav/`.
3. **Dump the live a11y tree for the route:**
   ```bash
   npm run test:maestro:tree -- /your-route
   ```
   This calls `window.__rebirthTestBridge.getTree()` and writes
   `.maestro-out/<ts>/tree-<route>.json`. Grep it for the element you'll
   target. Note: the bridge is only present when the app is built with
   `NEXT_PUBLIC_E2E=1`, which the orchestrator handles automatically.
4. **Copy the closest existing flow** as a skeleton. Don't write from
   scratch.
5. **Run in watch mode** (you can't do this — Lou does):
   ```bash
   npm run test:maestro:watch .maestro/flows/your-bucket/your-flow.yaml
   ```
   You write the YAML; Lou runs the watcher and reports back.
6. **Read the failure** from `.maestro-out/<ts>/junit.xml` and screenshots,
   then propose the fix.

## Selector preference

1. `id="m-{surface}-{element}"` — markers added to the source code
   specifically for Maestro. Use only when text/aria are ambiguous.
2. `accessibility-label` (HTML `aria-label`) — for icon-only buttons.
3. Visible text — for stable button labels and headings.

If you can't pick a stable selector, propose adding an `id="m-…"` to the
React source rather than guessing. List the file and line.

## YAML conventions

```yaml
appId: app.rebirth
tags:
  - keyboard           # bucket tag
---
# One-line description: what regression this catches.
- runFlow: ../../helpers/launch.yaml
- runFlow: ../../helpers/reset-data.yaml
# Then the flow body.
```

- **Always** start with `runFlow: launch.yaml`. Otherwise the bridge isn't ready.
- **Reset only when needed.** If the flow asserts against an empty state,
  use `reset-data.yaml`. If it doesn't care about prior state, skip the reset.
- **No raw `evalScript` over 10 lines.** Extract into a helper.
- **No flow over 25 lines.** Extract into a helper.

## Helper inventory

| Helper | Purpose | Env |
|---|---|---|
| `helpers/launch.yaml` | App launch + bridge.ready() | — |
| `helpers/reset-data.yaml` | Clear Dexie + storage | — |
| `helpers/actions/open-sheet.yaml` | Open sheet by trigger | TRIGGER_TEXT, SHEET_TITLE |
| `helpers/actions/dismiss-sheet-swipe.yaml` | Swipe down to dismiss | SHEET_TITLE |
| `helpers/actions/dismiss-sheet-backdrop.yaml` | Tap backdrop to dismiss | SHEET_TITLE |
| `helpers/actions/assert-above-keyboard.yaml` | Assert element above keyboard top | SELECTOR_TEXT |

If you need a primitive that isn't in this list, **propose a new helper**
rather than inlining the logic in your flow. New helpers go in
`.maestro/helpers/actions/` and get a row in this table + the README.

## Bridge API

The flow has access to `window.__rebirthTestBridge` via `evalScript`:

```ts
ready():    Promise<void>     // dexie open
reset():    Promise<void>     // wipe + reload
seed(name): Promise<void>     // load fixture
setClock(iso | null): void    // pin Date.now()
getTree():  unknown           // a11y snapshot
```

Use `setClock` when the flow asserts on date-bound text (today's date,
this week's count). Default flows use real wall-clock.

## Failure recovery

When Lou says "this flow is flaking" or "it failed":

1. Read `.maestro-out/<latest>/junit.xml` for failure messages.
2. Read screenshots in `.maestro-out/<latest>/` — the last screenshot
   before the failure tells you what state the app was in.
3. **Common causes**:
   - **Timing**: assertion fires before render. Add `assertVisible` with
     `timeout: <ms>` before the action.
   - **Selector ambiguity**: `text: "Save"` matched 3 elements. Add an
     `id="m-…"` to the right one.
   - **Bridge not ready**: forgot to start with `launch.yaml`.
   - **Stale state**: prior flow left Dexie populated. Add `reset-data.yaml`.

4. Never set `retries: 2+` to mask a flake. If a flow fails on first
   try and passes on retry, it's hiding a real regression.
