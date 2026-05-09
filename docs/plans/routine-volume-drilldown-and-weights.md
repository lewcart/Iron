<!-- /autoplan restore point: /Users/lewis/.gstack/projects/lewcart-Iron/main-autoplan-restore-20260508-073818.md -->
# Routine Volume Drill-down + Per-Exercise Secondary Weights (v1.1)

**Branch:** `routine-volume-drilldown-and-weights` (proposed)
**Date:** 2026-05-08
**Author:** Lou (rough), to be reviewed via /autoplan
**Builds on:** `docs/plans/routine-volume-fit-check.md` (shipped v0.10.0)

---

## The problem (Lou's framing)

> "The routine weekly projection — can we have it if I click it we get a more
> detailed view, something like the priority muscles with the lines and
> explanations and things to fully understand where we coming from."
>
> "Glutes was previously lower now it's showing absolutely max 25 — we only
> doing it 2 days a week nothing change for that to go up. Is it accurate now
> or was it before?"
>
> "Per exercise weighted. I need to see those weights on the exercise page
> when we add them. Does the research you're sampling list most? And we can
> infer the rest because we need it filled out for everything. And we'll
> have to figure out this might be a future version but this needs to be
> able to be set when there's a custom exercise."
>
> "MCP writing 1.1, UI in 1.2."

## Translation

v0.10.0 shipped Volume Fit on the routine builder (`RoutineVolumeFit.tsx`)
and a parallel Muscles This Week tile on `/feed` (`MusclesThisWeek.tsx`).
Both surfaces show **summary** verdicts only — the *why* (which exercises
contribute, primary vs secondary breakdown, RIR-effective vs raw) is hidden.

Lou wants to drill into either tile to see the contributors. Today's
secondary-credit math (flat 0.5 for any secondary muscle) is the specific
mechanism Lou is reverse-engineering when they ask "is the 25 accurate?" —
and the answer requires per-exercise nuance because Bulgarian Split Squat
→ glutes (deep stretch under load) is genuinely 0.7-0.9 of a primary set,
while Leg Press → glutes (knee-dominant, glutes barely stretched) is more
like 0.2.

Concrete forcing question: "When I tap the Volume Fit row that says
'glutes 23 sets', I want to see the 8 exercises that credited those 23
sets, with the per-exercise contribution and whether each contribution is
primary or secondary-weighted."

## Goals

1. **Drill-down view.** Tap the Volume Fit tile (routine page) OR the
   Muscles This Week muscle tile (`/feed`) → modal/page showing per-muscle
   bars + per-exercise contributors with primary / secondary credit
   breakdown.

2. **Default = projected, toggle to overlay actual.** Routine page drill-down
   defaults to projected (from routine config). `/feed` drill-down defaults
   to actual (from logged sets). Toggle at top swaps/overlays the other
   axis. Same component, two entry points, two defaults.

3. **Per-exercise secondary weight, replacing flat 0.5.** Catalog gains
   per-(exercise, muscle) weight 0.0–1.0 for secondary muscles. Primary
   muscles always weight 1.0. Math change cascades into both
   `volume-math.ts` (TS) and the SQL aggregation in `queries.ts:1481`
   (so Week page and routine projection stay coherent).

4. **Research-grounded defaults, inferred fallback.** ~30-40 high-frequency
   compounds get explicit weights from EMG / hypertrophy literature
   (sourced through androgodess SME). Everything else gets
   biomechanics-rule inference (joint pattern + ROM + stretch under load).
   Custom user exercises and unmapped catalog entries default to **0.5**
   (current behavior — preserves continuity, no regressions).

5. **Weights visible on exercise page.** Each exercise's detail page lists
   primary muscles (1.0) and secondary muscles with their weights. Read-only
   in v1.1.

6. **MCP write path in v1.1, UI editor in v1.2.** Extend `update_exercise`
   MCP tool to accept `secondary_weights` so an agent can set/refine
   weights via chat. Custom-exercise UI editor (per-muscle slider on the
   exercise form) is v1.2 work, documented as TODO.

## Non-goals (this phase)

- UI editor for per-exercise weights (v1.2).
- Retroactive recompute of historical sets when a weight changes — display
  uses *current* weights against current sets. Acceptable for single-user.
- Sub-muscle resolution beyond v1's lateral_emphasis (gmax vs gmed,
  rectus vs obliques). Carry forward as v2 work.
- Replacing the simplifying assumption that primary credit always = 1.0.
  Some exercises (e.g., reverse hyper for glutes) might warrant 0.8 primary
  too — out of scope.

## Bonus fixes riding along (low-cost, contextually adjacent)

- **Glute distribution audit.** `Cable Hip Abduction` is currently scheduled
  in `Upper B — Delts & Back Definition` as well as `Lower A`. That muddles
  glute split + recovery window. Move it off Upper B (or replace with a
  delt-only alternative). Drill-down view will surface this kind of
  cross-day spillover going forward.
- **TZ default bug.** `get_sets_per_muscle` MCP tool defaults `tz` to a
  literal `"Australia/Sydney\n"` (with stray newline) and crashes unless
  caller passes `tz: 'Australia/Brisbane'`. One-line fix at the MCP handler.

## Sketch

### Data model

**`exercises.secondary_weights`** — new column. Two viable shapes:

```ts
// Option A — JSONB on exercises table (denormalized)
secondary_weights: Record<MuscleSlug, number> | null
// example: { glutes: 0.8, hamstrings: 0.5 }

// Option B — separate exercise_secondary_weights table
// PRIMARY KEY (exercise_uuid, muscle_slug), weight numeric(3,2)
```

Tradeoff:
- A is simpler, mirrors `primary_muscles` / `secondary_muscles` columns
  already on `exercises`. One row per exercise.
- B is queryable (joinable for SQL aggregation) but heavier — extra Dexie
  store, extra sync wiring, more migration code.

**Recommendation (review): A (JSONB)**, because:
- The volume math joins on (set, exercise) → exercise row already in
  scope. Dereferencing a JSONB field on the same row is free.
- Sync wiring stays tiny (one column added to `LocalExercise`).
- Future per-(exercise, set, muscle) overrides (e.g., Lou tags a single
  set as "felt this in glutes more") would be on a different table
  anyway, doesn't influence this choice.

Defaults policy:
- `secondary_weights = null` on existing exercises until the catalog audit
  fills them in.
- During the audit pass, every catalog exercise gets explicit weights for
  every muscle in its `secondary_muscles` array.
- Volume math: `weights[muscle] ?? 0.5` (charitable default preserves v1
  behavior for unmapped exercises and custom exercises).

### Math change

Current (`volume-math.ts:effectiveSetContribution`):
```
secondary_only credit = 0.5
```

After:
```
secondary_only credit = exercise.secondary_weights[muscle] ?? 0.5
```

That's the entire math change. RIR weighting tier, primary/in-both rules,
zone classification all unchanged.

SQL parity (`queries.ts:1481`): the same fallback expression applied in
the aggregation. Conformance test from PR2 (TS ≡ SQL on fixture set) gets
extended with a per-exercise-weight fixture.

### Surface — drill-down component

New: `src/components/VolumeContributorsModal.tsx` (or full-page route
`/plans/[uuid]/volume/[muscleSlug]` — review decides).

Two entry points → same component:

```
Routine page Volume Fit row (e.g. "glutes 23 sets ⚠")
  → tap → drill-down with view='projected', muscle='glutes'

/feed Muscles This Week tile (e.g. "Glutes 29 sets / over")
  → tap → drill-down with view='actual', muscle='glutes'
```

Component props:
```ts
interface VolumeContributorsProps {
  muscle: MuscleSlug;
  defaultView: 'projected' | 'actual';
  // Source data is read live from Dexie based on view:
  //   projected → active routine + per-exercise contribution
  //   actual    → last 7 days of logged workout_sets + same math
}
```

Layout sketch:

```
┌─────────────────────────────────────────────────┐
│  Glutes  ✓                                      │
│  ╭─────────────────────────────────────────╮    │
│  │ ░░░░░░░░░░██████████ 23 sets · 14-26    │    │
│  ╰─────────────────────────────────────────╯    │
│  3×/wk  ·  RIR-adjusted  ·  ★ vision range      │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ Projected  │  Actual                    │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  Contributors (projected)                       │
│  ─────────────────────────────────────────      │
│  Hip Thrust (Barbell)         primary  4.0      │
│  Romanian Deadlift            ×0.5     1.5      │
│  Step-Up                      primary  3.0      │
│  Cable Hip Abduction          ×0.8     2.4 ⓘ    │
│  Hip Thrust Banded Pulse      primary  3.0      │
│  Single Leg RDL               ×0.5     1.5      │
│  Bulgarian Split Squat        ×0.7     2.1      │
│  Cable Pull-Through           ×0.6     1.8      │
│  Leg Press                    ×0.2     0.6      │
│  Cable Hip Abduction (Upper B)×0.8     2.4 ⚠    │
│                                                 │
│  Total                                23.3      │
│                                                 │
│  ⚠ Cable Hip Abduction shows in Upper B.        │
│     Move off Upper B to consolidate glute days. │
└─────────────────────────────────────────────────┘
```

Toggle behavior: tapping "Actual" overlays a second column or replaces.
Decision deferred to design review.

The "ⓘ" on a row opens an inline tooltip explaining the weight ("0.8 from
catalog: deep hip ROM with cable resistance, EMG-supported").

The "⚠" footer surfaces obvious routine misallocations — currently just
"exercise X tagged for muscle Y appears on day Z that doesn't fit the
muscle's split intent." Heuristic: if a muscle's `is_priority` rows
include exercises spread across >2 days when frequency_per_week implies
2-day split, flag the spillover.

### Exercise page weight display

`src/app/exercises/[uuid]/page.tsx` (verify exact path in eng review)
gains a new section:

```
Muscle credit
─────────────────────────
Glutes        primary   1.0
Hamstrings    secondary 0.5  (default)
```

Read-only badges. Tooltip on each weight names the source: `catalog`
(audited), `inferred` (rule-based), or `default` (0.5 fallback).

### MCP write path

Extend `update_exercise` in `src/lib/mcp/tools/exercises.ts` (verify path)
to accept:
```ts
secondary_weights?: Partial<Record<MuscleSlug, number>>
```

Server validates: keys ∈ canonical muscle slugs, values ∈ [0, 1].
Merges with existing weights (passing `null` for a key clears it back
to default).

Audit script: `scripts/audit-exercise-secondary-weights.mjs` (NEW) reads
the catalog, prompts the SME (Claude/Lou via chat), populates weights
for the top ~40 compounds. Idempotent, re-runnable.

## Open questions for review

(These are things /autoplan should pressure-test, not pre-answer.)

1. **JSONB vs separate table** for `secondary_weights`. JSONB is simpler;
   separate table is queryable and analytics-friendly. Single-user app,
   sync round-trips matter — does the JSONB simplicity win?

2. **Drill-down surface: modal or full page route?** Modal feels right for
   "tap to peek" pattern but loses URL-shareability and history. Full
   page route is more permanent but adds a hop. iOS Capacitor sheet
   semantics favor modal.

3. **Unified vs split components** for routine-projected vs /feed-actual
   drill-downs. They share data shape but have different defaults and
   sources. One component with `view` prop OR two components sharing a
   sub-component?

4. **Audit cadence and SME source.** Who owns ground truth for the ~40
   compound weights? Androgodess SME up-front this round (per Lou). Then
   what — quarterly review? Static unless someone challenges a number?

5. **"Inferred" weights — algorithm or one-shot LLM pass?** Rule-based
   inference (joint pattern + ROM + stretch tags) is auditable but
   brittle. One-shot LLM pass over the catalog with research grounding
   is faster but opaque. Hybrid: LLM proposes, audit script logs source
   so each weight carries `'audited' | 'inferred' | 'default'`.

6. **What to display when `secondary_weights = null`** for an exercise?
   "Default 0.5" with a fade — invites the audit to fill it in. Or hide
   the weight entirely until populated, showing only "secondary"?

7. **Drill-down toggle semantics: overlay or swap?** Projected + Actual
   side-by-side fits desktop but not mobile rows. Tab/segment swap is
   cleaner on mobile but loses comparison. Compromise: rows show
   `projected → actual (Δ)` always, like the existing diff-as-default
   pattern in `RoutineVolumeFit`.

8. **Spillover warnings — heuristic strength.** The "Cable Hip Abduction
   on Upper B" warning is the kind of thing the drill-down can surface
   automatically. Where does that heuristic live, what false positives
   does it have on legitimate routines like upper/lower-with-glute-finish?

9. **MCP write path scope.** v1.1 ships `update_exercise` accepting
   `secondary_weights`. Should it also support a bulk `set_exercise_weights`
   for the audit pass, or is one-at-a-time fine?

10. **Performance.** The drill-down recomputes per-exercise contribution
    live. For a 20-exercise routine, that's ~20 × 18-muscle = 360 hits.
    O(n), in V8, should be <1ms. Confirm in eng review.

## Scope estimate

- **PR1 — Catalog field + sync wiring + math hookup** (~half day CC).
  Add `secondary_weights jsonb null` column, Dexie v23 bump, sync push +
  pull, update `LocalExercise` type, change `volume-math.ts` lookup,
  parity test in conformance suite.

- **PR2 — Catalog audit pass** (~half day CC + SME time).
  Audit script that walks the catalog, surfaces each exercise to androgodess
  for weight assignment with research grounding, writes `secondary_weights`
  + `weight_source` per exercise. Idempotent. Run once for v1.1, re-run
  whenever new exercises ship.

- **PR3 — Drill-down component + entry points** (~1.5 days CC).
  `VolumeContributorsModal.tsx` or page route, two entry points wired,
  projected/actual toggle, contributor row component, spillover warning
  heuristic.

- **PR4 — Exercise page weight display + MCP write path** (~half day CC).
  Read-only weight section on exercise detail page, `update_exercise`
  extension, MCP tool tests.

- **PR5 — Bonus fixes** (~30 min CC).
  Move Cable Hip Abduction off Upper B (data fix via MCP). Fix
  `Australia/Sydney\n` TZ default in `get_sets_per_muscle`.

**Total v1.1: ~3 days CC.**

## Files in blast radius

- `src/db/schema.ts` (or migration files) — `secondary_weights`,
  `weight_source` columns
- `src/db/local.ts` — Dexie version bump, `LocalExercise` type extension
- `src/app/api/sync/changes/route.ts`, `src/app/api/sync/push/route.ts`
  — sync new column
- `src/lib/training/volume-math.ts` — replace flat 0.5 with lookup
- `src/db/queries.ts:1481` — SQL aggregation parity
- `src/lib/mcp/tools/exercises.ts` (verify path) — `update_exercise`
  extension
- `src/components/VolumeContributorsModal.tsx` (NEW) — drill-down
- `src/components/RoutineVolumeFit.tsx` — make rows tappable, wire to drill-down
- `src/components/MusclesThisWeek.tsx` — make tiles tappable, wire to
  drill-down
- `src/app/exercises/[uuid]/page.tsx` (verify) — weight display section
- `scripts/audit-exercise-secondary-weights.mjs` (NEW)
- `src/lib/mcp/tools/sets.ts` (or wherever `get_sets_per_muscle` handler
  lives) — TZ default bug
- Active routine data — Cable Hip Abduction removal from Upper B

## Decision log

(Populated by /autoplan auto-decisions during review — see /autoplan REVIEW REPORT below.)

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Reshape v1.1: drill-down first, defer per-exercise weights to v1.2 | USER CHALLENGE | P1, P3 | All 3 voices converge: Lou's forcing question is provenance ("how did 25 happen with no routine change") not precision. Drill-down with current 0.5 math answers it. Per-exercise weights validate against drill-down evidence in v1.2. | Bundle weights + drill-down + MCP write path in v1.1 |
| 2 | CEO | Drop MCP write path from v1.1; audit script writes Drizzle direct | USER CHALLENGE | P3, P5 | Codex + Claude: dead infrastructure. Audit script doesn't need MCP — it has DB access. Lou's "MCP-write 1.1, UI 1.2" plan is a half-step that delivers nothing in v1.1. | Ship `update_exercise(secondary_weights)` MCP extension in v1.1 |
| 3 | CEO | Split bonus fixes: ship TZ + Cable Hip Abduction TODAY as standalone commits | USER CHALLENGE | P3 | Codex + Claude: 30-min fixes blocking nothing. Coupling delays them ~3 days for zero benefit. TZ bug actively crashes MCP calls. | Bundle into v1.1 PR train |
| 4 | Design | Single component, two entry points: `view='projected'` (routine page) / `view='actual'` (/feed) | Mechanical | P1, P5 | Plan already specs this; design review confirms it's the right shape. No fork risk. | Two separate components |
| 5 | Design | Drill-down placement: modal sheet on routine page, inline expansion on /feed Muscles This Week | Mechanical | P5 | Routine page modal preserves edit context. /feed inline expansion already used in MusclesThisWeek (parent_group expand). Don't introduce a third interaction pattern. | Full-page route |
| 6 | Design | Spillover warnings stay NEUTRAL (annotation, not prescription) | Mechanical | CLAUDE.md "two coaches" rule | Claude + Androgodess: "Move off Upper B" reads as prescription. Use "scheduled on Upper B and Lower A (cross-day)" — Lou decides. | Prescriptive copy |
| 7 | Design | Contributor row sort: `effective_set_count DESC` | Mechanical | P1, P5 | Androgodess: surfaces the contributor that surprised Lou (e.g., "OHP contributes 0.9 sets to lateral via secondary" first row, not buried). Alphabetical fails the use case. | Alphabetical |
| 8 | Eng | When v1.2 ships per-exercise weights, use **coarse bands** (low/medium/high) not decimals | TASTE | P5 | Codex critical: 0.2 vs 0.4 vs 0.7 implies precision EMG evidence cannot support. Coarse bands honestly encode coaching judgment. Internal mapping: low=0.25, medium=0.5, high=0.75. | Decimal weights 0.0-1.0 (current plan) |
| 9 | Eng | Pre-v1.2 work: ship a "weight impact report" script that simulates per-exercise weights against Lou's actual routines + last 8 weeks logged | Mechanical | P1 | Codex critical: validates whether per-exercise weights actually change verdicts before building the schema. If <3 priority-muscle verdicts shift, defer indefinitely. | Build per-exercise weight system blind |
| 10 | PT-SME | Catalog audit scope: glute-relevant + lateral-delt-relevant compounds only (~15 exercises) | Mechanical | P3 | Codex high + Androgodess: 40-exercise audit for 5-6 verdict-shifting cases is poor ratio. Scope to compounds that materially affect Lou's priority muscles. Default 0.5 stays for everything else. | Catalog-wide audit |

## Androgodess role

Per Lou's explicit instruction:

1. **Up-front SME (CEO + Eng phases):** weight assignment for the ~40
   compounds. Each weight cites a source (EMG study / Schoenfeld
   stretch-mediated work / RP convention / inferred from biomechanics
   tags). Where literature is thin, flag `evidence: 'low'` so the UI
   tooltip can surface uncertainty.

2. **End-of-pipeline PT verdict (final review):** "Would I, as a coach,
   reach for this drill-down to make a programming decision? Or is it
   information overload?" PT signs off (or doesn't) before the gate
   locks.

---

# /autoplan REVIEW REPORT

**Pipeline run:** 2026-05-08
**Voices:** Codex CEO + Claude CEO subagent + Androgodess PT SME (CEO + final verdict)
**Compression note:** Phase 2 (Design) and Phase 3 (Eng) ran light because the
convergent CEO reshape (defer per-exercise weights, ship drill-down only)
collapses most of the design + eng question surface. Full Phase 2/3 voice
rounds were judged marginal-value given the strength of the v1.1 reshape.
Phase 3.5 (DX) skipped — the surface under DX evaluation (MCP write path)
is being recommended OUT of v1.1.

## Phase 1 — CEO Review

### CEO consensus table

```
═════════════════════════════════════════════════════════════════════════
  Dimension                              Codex   Claude  Androgo  Consensus
  ──────────────────────────────────────  ──────  ──────  ───────  ─────────
  1. Right problem to solve?              NO      NO      PARTIAL  RESHAPE
  2. Premises valid (0.5 is wrong)?       NO      NO      PARTIAL  DISAGREE
  3. v1.1 scope correctly bounded?        NO      NO      NO       RESHAPE
  4. MCP write path justified in v1.1?    NO      NO      —        REMOVE
  5. Bonus fixes coupling appropriate?    NO      NO      —        SPLIT
  6. 6-month trajectory sound?            NO      NO      PARTIAL  RESHAPE
═════════════════════════════════════════════════════════════════════════
VERDICTS: Codex=RESHAPE, Claude=RESHAPE, Androgodess=CONDITIONAL.
Zero voices said SHIP AS-IS.
```

### Convergent critical findings (≥2 voices)

**[CRITICAL] Wrong forcing question — Lou is asking about provenance, not precision.** Codex + Claude. Lou's "is the 25 accurate?" is a *trust* question, not a *math* question. The current Volume Fit tile hides which exercises contribute to a muscle's count, what's primary vs secondary, what's RIR-effective vs raw, which day each set falls on. A drill-down with the existing 0.5 math answers Lou's question completely. Per-exercise weights only matter once Lou has confirmed *via the drill-down* that a specific exercise is mis-weighted. Today there is zero evidence of that complaint — Lou hasn't said "Bulgarian split squat at 0.5 feels too low for glutes." Building the per-exercise weight system pre-emptively is solving a problem Lou hasn't surfaced.

**Fix:** v1.1 ships drill-down only, retaining current flat 0.5 secondary credit. Per-exercise weights become v1.2 *if and only if* the drill-down surfaces specific mis-weightings during 2+ weeks of real use.

**[CRITICAL] MCP write path with no UI editor is dead infrastructure.** Codex + Claude. Plan ships `update_exercise(secondary_weights)` MCP extension in v1.1, UI editor in v1.2. In practice: Lou never opens an MCP chat to edit exercise weights. Audits land via direct DB scripts (the plan even names `scripts/audit-exercise-secondary-weights.mjs`). The MCP write path will have one caller (the audit script) — which doesn't need MCP, it has DB access. Androgodess agreed conditionally but only with extra guards (logged coaching note, `weight_source: 'manual-override'` tag) — those guards are themselves complexity that exists only to prevent drift in a write path no one needs.

**Fix:** Drop MCP write path from v1.1 entirely. Audit script (when v1.2 lands) writes directly via Drizzle. UI editor in v1.2 is the only legitimate write surface.

**[CRITICAL] Bonus fixes should not ride with this plan.** Codex + Claude. TZ default bug (`Australia/Sydney\n` literal newline) is actively crashing MCP `get_sets_per_muscle` calls right now. Cable Hip Abduction misallocation on Upper B is a 2-minute MCP-direct fix to Lou's active routine. Coupling these to a 1-2 day v1.1 plan delays them by days for zero coupling benefit. Bundling muddies the learning loop ("did the bonus fix or the new math change the glute number?").

**Fix:** Ship TZ default + Cable Hip Abduction relocation as standalone commits to main TODAY (per ship-direct policy). Re-check Lou's glute total before approving v1.1 work.

**[CRITICAL] "Two coaches" risk re-introduced.** Claude + Androgodess. CLAUDE.md is unambiguous: prescription engine on /feed owns the verdict; other surfaces stay descriptive. The plan's spillover warning ("⚠ Move off Upper B to consolidate glute days") and verdict copy ("glutes are 6 sets short") drift toward prescription. The /feed Muscles This Week tile already says "PUSH glutes +2."

**Fix:** Drill-down stays diagnostic. Show contributors, ranges, zones. NO routine-allocation suggestions. Spillover detection is fine as a *neutral fact* ("scheduled on Upper B and Lower A — cross-day spillover"), not a prescription.

### Critical from one voice (still flagged)

**[CRITICAL — Codex] Per-exercise weights risk fake precision.** EMG evidence supports broad statements ("Bulgarian split squat hits glutes meaningfully more than leg press") but cannot reliably distinguish 0.7 from 0.8 from 0.6. Decimals imply scientific accuracy where the app is encoding coaching judgment. **Fix when v1.2 ships:** use coarse bands (`low`=0.25, `medium`=0.5, `high`=0.75) not decimal sliders. Honest framing of the uncertainty. (See decision log #8.)

**[CRITICAL — Codex] Catalog-wide audit is over-scoped.** 40 audited compounds for 5-6 verdict-shifting cases on Lou's routines. Audit only what matters: glute-relevant compounds (~10) + lateral-delt-relevant compounds (~5). Default 0.5 stays everywhere else with a "default" badge that invites future audit. (See decision log #10.)

### Reshaped scope

**v1.1 (~1 day CC, was 3 days):**
1. **Drill-down component** (`VolumeContributorsModal.tsx` or sheet) — single component, two entry points (`view='projected'` from routine page Volume Fit row, `view='actual'` from /feed Muscles This Week tile). Shows per-muscle bar + contributor ledger sorted by `effective_set_count DESC`. Spillover detection as NEUTRAL annotation. Uses current flat 0.5 math.
2. **Glute audit + TZ bug fix** — ship as standalone commits BEFORE v1.1 even starts. Confirms whether the drill-down still shows glute confusion after the data fix.

**v1.2 (~1.5 days CC, gated on v1.1 evidence):**
1. **Per-exercise weight schema** (only if drill-down surfaces specific mis-weightings during 2+ weeks of v1.1 use)
2. **Weight impact simulation script** — runs proposed weights against Lou's actual routines + last 8 weeks logged data. If <3 priority-muscle verdict zones shift, abort v1.2.
3. **Coarse-band weights (low/medium/high)** not decimals. Internally maps to 0.25/0.5/0.75.
4. **Audit pass for ~15 priority compounds** (glute-relevant + lateral-delt-relevant). Everything else stays at 0.5 default.
5. **Exercise page weight display** — read-only badges with source provenance.
6. **UI editor for custom-exercise weights** — per-muscle 3-button selector (low/med/high) on custom exercise form.

**Deferred (v2+):**
- MCP write path for weights (no proven need)
- ROM-variant weights (leg press deep vs shallow — exercise-variant rows would handle this if needed)
- Tempo/eccentric modifiers
- Per-(exercise, set) overrides

### Androgodess SME deliverables (preserved for v1.2 use)

The Androgodess SME run produced research-grounded weights for 25+ compounds in a single pass — reproduced verbatim in the plan thread for v1.2 implementation reference. Highlights for Lou's routine:

- **Bench press → lateral delts: 0.1** (catalogs that credit 0.5 are wrong)
- **OHP → lateral delts: 0.3** (most catalogs over-credit)
- **Bulgarian split squat → glutes: 0.7** (deep stretch under load — high evidence)
- **Leg press → glutes: 0.3** standard / 0.5+ deep+wide (ROM-variant flagged)
- **Hip thrust → hams: 0.4** (no stretch under load)
- **RDL → glutes: 0.6** (loaded stretch — slightly higher than RP convention)
- **Cable hip abduction → glutes: 0.5** (plan's 0.8 was too high — gmed is true primary)
- **Lying leg curl → glutes: 0.0** (catalogs that tag glutes here are wrong; pure knee-flexion isolation)

These weights become the v1.2 catalog audit seed. Source provenance per exercise (EMG / Schoenfeld / RP-convention / biomechanics-inference) is preserved in the SME run.

## Phase 2 — Design Review (light)

The drill-down design extends two already-shipped tile components (RoutineVolumeFit, MusclesThisWeek). Component shape is well-defined. Key decisions auto-resolved (see decision log #4-7):

- **One component, two entry points** with `view: 'projected' | 'actual'` prop.
- **Routine page → modal sheet** (preserves edit context, fits Capacitor iOS sheet patterns already used elsewhere).
- **/feed → inline expansion** (matches existing parent_group expand pattern in MusclesThisWeek).
- **Contributor sort:** `effective_set_count DESC` — surfaces the surprise contributor first.
- **Spillover detection:** neutral annotation language ("scheduled on Upper B and Lower A"), no prescriptive copy.
- **Toggle:** since v1.1 ships drill-down only (no actual/projected separate axes — actual lives on /feed already, projected lives in routine page), the projected vs actual *toggle* mostly disappears. Each entry point shows its native data axis. Cross-source overlay deferred to v1.2 as a stretch goal — useful only once weights are accurate enough to make the comparison meaningful.

## Phase 3 — Eng Review (light)

For v1.1 scope (drill-down only, no math change):

- **No schema migration needed.** No Dexie version bump. No sync wiring.
- **Component-only PR.** `src/components/VolumeContributorsModal.tsx` (NEW) + small edits to RoutineVolumeFit.tsx + MusclesThisWeek.tsx to wire entry points.
- **Data already available.** Routine projection (`projectWeeklyVolume`) and logged sets (`getWeekSetsPerMuscle`) both already return per-muscle aggregates. The drill-down needs one additional level — per-(muscle, exercise) — which is a straightforward in-memory regroup of existing data, no new query.
- **Performance:** ~360 (set, muscle) hits per routine drill-down view, O(n) Map aggregation, <1ms in V8. No memoization needed (mirrors the live recompute pattern from RoutineVolumeFit).
- **Tests:** 4 fixtures — projected drill-down with priority muscle, actual drill-down with same muscle, spillover detection (Cable Hip Abduction on multiple days), empty state (muscle with no contributors).

For v1.2 (gated, scope per reshape above):

- **Schema:** `secondary_weights jsonb null` on `exercises` table. `weight_source text null` ('audited' | 'inferred' | 'default' | 'manual-override').
- **Sync wiring** (the v1 critical risk pattern recurs): push + pull routes, Dexie version bump, parity test asserting every Dexie column is present in push serializer.
- **SQL ≡ TS conformance test extends** to per-(exercise, muscle) weight lookup. Existing test in volume-math.ts conformance suite gets a new fixture per weight-bearing exercise.
- **Audit script seeds the catalog** at v1.2 ship; subsequently re-runnable when new exercises ship.

## Phase 3.5 — DX Review

**SKIPPED.** The DX surface under evaluation (MCP write path for `update_exercise(secondary_weights)`) is being recommended OUT of v1.1 by both Codex + Claude CEO voices. DX review on a removed surface is moot. When v1.2 ships, the only DX surface is the audit script (developer-only, internal). DX review at that point would be ~30 minutes of "does the script have good error messages and idempotency" — defer.

## Cross-phase themes

1. **"Drill-down before precision" recurs across CEO + Eng + PT.** Lou's question is provenance, not precision. All three phases independently arrived at: ship the explanation surface first, validate whether new math is actually needed, only then build the schema.

2. **"Two coaches" risk recurs from v1.** The reshape preserves /feed as the single prescriptive surface. Drill-down language is purely diagnostic. This is the same discipline v1 enforced; v1.1 must not regress it.

3. **"Honesty over precision" pattern.** Both CEO voices flag fake-precision risk. Androgodess flags ROM-variant ambiguity (leg press depth). The pattern: when underlying evidence is coarse, the surface should be coarse too — bands not decimals, neutral copy not prescriptive, "uncertain" badges over silent green ticks.

## Androgodess PT verdict (final sign-off)

> **Conditional yes.** I would reach for this drill-down in two specific situations:
> (1) when Lou asks "is my 23 glute count real?" — the contributor breakdown answers
> it honestly, replacing the flat-0.5 fiction with sourced numbers; (2) when validating
> that lateral-direct delts are still under-served despite "delts 22 sets" — re-weighting
> bench/OHP/face-pull lateral credit downward will *correctly* widen that gap and
> reinforce the lateral specialization push the Week page already prescribes. Outside
> those two cases the drill-down is mostly confirmatory of what the priority-tile
> already shows.
>
> **Ship conditions:** (a) drill-down sort must be `effective_set_count DESC` not
> alphabetical, (b) "spillover" warnings stay neutral (no prescriptive language),
> (c) MCP write path logs a coaching note + tags `weight_source: 'manual-override'`
> to prevent drift accumulation [→ moot if MCP write path dropped per CEO reshape],
> (d) leg press carries an audit note about ROM variant ambiguity [→ v1.2].
>
> With those guards, this earns its place in my coaching loop.

PT verdict + CEO reshape align: ship the drill-down, defer the weights.

---

# /autoplan REVIEW COMPLETE — DECISIONS FOR LOU

## Plan summary (one paragraph)

You wanted v1.1 = drill-down + per-exercise weights + MCP write path + bonus fixes (3 days CC). All 3 voices say RESHAPE: ship drill-down only with current 0.5 math (1 day CC), defer per-exercise weights to v1.2 gated on actual evidence from drill-down use, drop MCP write path entirely (UI editor in v1.2 is the only legitimate write surface), and split bonus fixes (TZ + glute audit) as standalone commits TODAY. The per-exercise weight SME work Androgodess delivered isn't wasted — it's preserved verbatim for v1.2 implementation seed.

## Decisions taken (auto-decided)

10 decisions auto-decided per the 6 principles. Most important:
1. v1.1 scope reshape: drill-down only, weights to v1.2 (USER CHALLENGE — gate-pending)
2. MCP write path dropped from v1.1 (USER CHALLENGE — gate-pending)
3. Bonus fixes split as standalone commits (USER CHALLENGE — gate-pending)
4. Component shape: one component, two entry points with `view` prop
5. Drill-down placement: modal on routine page, inline expansion on /feed
6. Spillover language stays neutral ("two coaches" guard from CLAUDE.md)
7. Contributor sort: `effective_set_count DESC`
8. v1.2 weights as coarse bands (low/med/high), not decimals
9. v1.2 prefaced by weight-impact simulation script (gate)
10. v1.2 audit scope: ~15 priority compounds, not catalog-wide

## USER CHALLENGES (3) — Codex + Claude both push back on your stated direction

These are NOT auto-decided. Your original direction stands unless you explicitly accept the change.

### UC1 — v1.1 scope: drill-down only, defer weights to v1.2

**You said:** "Per exercise weighted. I need to see those weights on the exercise page when we add them. ... MCP writing 1.1 UI in 1.2."

**Both Codex + Claude CEO say:** Lou's actual question ("is the 25 accurate?") is provenance, not precision. The drill-down with current 0.5 math answers it. Per-exercise weights only matter if drill-down evidence shows specific exercises mis-weighted. Today there's no specific complaint — building the schema pre-emptively is solving a problem you haven't surfaced.

**Androgodess agrees conditionally:** "the drill-down is mostly confirmatory of what the priority-tile already shows" outside two specific scenarios. The SME table is preserved as v1.2 seed.

**What we might be missing:** You may have wanted weights in v1.1 specifically because you've already seen exercises that feel mis-weighted (e.g., from your own coaching intuition, even without surfacing them in chat). If so, building blind is justified.

**If we're wrong, the cost is:** v1.2 ships ~2 weeks later than v1.1 would have included it. The drill-down ships 1 day instead of 3 days. SME weights stay archived for that ~2 weeks. No work lost.

→ **Recommendation: ACCEPT the reshape.** Drill-down today, weights when evidence demands them.

### UC2 — Drop MCP write path from v1.1

**You said:** "MCP writing 1.1, UI in 1.2."

**Both Codex + Claude CEO say:** Dead infrastructure. Audit script writes Drizzle direct (no MCP needed). UI editor in v1.2 is the only write surface that makes sense. The MCP write path's only realistic v1.1 caller is the audit script — which doesn't need MCP.

**What we might be missing:** Your "MCP write" intent might have been narrower than literal MCP — maybe you meant "I want to ask Claude in chat to update a weight without opening UI." That's still v1.2 territory (depends on weights existing first), and when it lands the MCP path could be a thin wrapper over the same DB write the UI uses.

**If we're wrong, the cost is:** v1.2 takes a half-day extra to add the MCP path then. No work lost.

→ **Recommendation: ACCEPT the drop.** v1.2 includes MCP write if you still want it then.

### UC3 — Split bonus fixes (TZ default + Cable Hip Abduction) as standalone commits TODAY

**You said:** Plan listed them as "Bonus fixes riding along."

**Both Codex + Claude say:** TZ bug actively crashes MCP calls right now. Cable Hip Abduction is a 2-minute MCP-direct fix. Coupling them to a multi-day plan blocks them for no reason and muddies "what changed the glute number" learning.

**If we're wrong, the cost is:** Two extra commits to main today. Zero downside.

→ **Recommendation: ACCEPT.** Ship both today as small commits before v1.1 even starts. Re-check the glute total before approving v1.1.

## TASTE DECISIONS (2) — close calls where reasonable people could disagree

### TD1 — v1.2 weights: coarse bands (low/med/high) or decimals (0.0-1.0)?

**Codex critical:** Decimals imply EMG-grade precision the evidence cannot support. Bands honestly encode coaching judgment. Internal mapping: low=0.25, medium=0.5, high=0.75.

**Androgodess SME:** Provided decimal weights (0.1-0.7 range) with cited sources. Decimals work because they're audited values, not slider-tweaked guesses.

→ **Recommendation: BANDS.** Honest framing of evidence quality. Decimals can be added later if any single weight needs sub-band precision. Bands also make the future UI editor (3-button selector) trivial vs a calibration slider that nobody can use confidently. (TASTE — Androgodess's decimals are also defensible.)

### TD2 — v1.2 gating: ship after weight-impact simulation, or ship after 2 weeks of v1.1 use surfacing specific mis-weightings?

**Codex:** Run simulation script before v1.2 schema work. If <3 priority-muscle verdicts shift across Lou's routines + last 8 weeks logged data, abort v1.2 entirely.

**Claude:** Wait for organic Lou complaint ("Bulgarian split squat at 0.5 feels wrong for glutes") via drill-down use. Empirical, but slower.

→ **Recommendation: BOTH GATES.** Run simulation as a prereq (Codex), AND require Lou to flag at least one specific exercise as mis-weighted from drill-down use (Claude). Belt and braces — the simulation tells us "would weights matter," the user signal tells us "do they matter to Lou specifically." (TASTE — single-gate is also defensible.)

## What happens after you answer

1. If you ACCEPT all 3 USER CHALLENGES + both TASTE DECISIONS as recommended:
   - **TODAY:** Ship TZ bug fix + Cable Hip Abduction routine fix as 2 standalone commits to main
   - **TODAY/TOMORROW:** v1.1 drill-down (~1 day CC) — single component, two entry points, neutral language
   - **2+ WEEKS LATER:** if drill-down use surfaces specific mis-weightings AND simulation script shows ≥3 verdict shifts → v1.2 (per-exercise weights as coarse bands, ~1.5 days CC)
   - **NEVER (probably):** MCP write path

2. If you REJECT any USER CHALLENGE: original v1.1 plan stands, ~3 days CC, ships everything bundled.

3. If you want to interrogate any specific decision: say so, I'll explain.

— /autoplan, 2026-05-08

---

## GATE LOCKED — 2026-05-08

Lou's answers:

```
UC1 v1.1 scope:           REJECT reshape — ship original bundled v1.1
                          (drill-down + per-exercise weights + exercise page + MCP write)
UC2 MCP write path:       KEEP in v1.1
UC3 Bonus fixes:          ACCEPT — ship TZ + Cable Hip Abduction TODAY as standalone commits
TD1 Weight encoding:      Decimals 0.0-1.0 (use Androgodess SME values as-is)
TD2 v1.2 gating:          MOOT — v1.2 doesn't exist as a phase; weights ship in v1.1
```

**Honest time estimate (per Lou's feedback on inflated CC-day quotes):**
~1-2 hours total Claude execution for everything (bonus fixes + full v1.1 bundle).

**Execution order:**
1. TZ bug fix (`get_sets_per_muscle` default tz) — standalone commit
2. Cable Hip Abduction relocation off Upper B — MCP-direct fix
3. Schema: `secondary_weights jsonb`, `weight_source text` on `exercises`
4. Sync wiring (push + pull + Dexie bump)
5. `volume-math.ts` lookup change + SQL parity
6. Audit script seeded with Androgodess SME weights (decimals)
7. Drill-down component (`VolumeContributorsSheet.tsx`) — modal on routine page, inline expansion on /feed
8. Entry-point wiring (RoutineVolumeFit + MusclesThisWeek made tappable)
9. Exercise page weight display (read-only badges)
10. MCP `update_exercise` extension accepting `secondary_weights`

