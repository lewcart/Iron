# Routine Volume Fit Check

**Branch:** `routine-volume-fit-check`
**Worktree:** `/Users/lewis/Developer/projects/Rebirth-worktrees/routine-volume-fit-check`
**Date:** 2026-05-05
**Author:** Lou (rough), reviewed via /autoplan

---

## The problem (Lou's framing)

> "We have a 'priority muscles' thing in week tracking live. But if I follow the
> routine, we would already know how this lands. So essentially I'm wondering if
> while we are building, and then when a routine is built, I want to be able to
> assess the routine based on the same metrics to see if it's good enough.
>
> Main thing for me: if we added a 5th day for example, and it was lower upper
> lower upper lower, that means we can hit glutes more from what I've discussed
> around MRV etc. So it needs to be dynamic, and maybe our routines need slightly
> more data for this to work."

## Translation

The Week page (`/feed`) computes **per-priority-muscle volume status** (under /
optimal / over / risk) from *logged* workouts and produces a PUSH / REDUCE /
DELOAD prescription via `src/lib/training/prescription-engine.ts`.

The Routine builder (`/plans`) is *upstream* of all that. Lou wants the same
volume math run on the routine's *planned* sets — so a routine can be evaluated
**before it's followed**, against the same priority muscles + MEV/MAV ranges.

Concrete forcing question: "If I switched to a 5-day Lower-Upper-Lower-Upper-Lower
split, would my glute volume actually move into the optimal range?" Today that
question can only be answered by following the routine for a week and reading
the Week page. We want to answer it during the build.

## Goals

1. **Routine volume projection.** Given a routine, compute per-muscle weekly
   set count + RIR-weighted effective_set_count from the *planned* sets, using
   the same primary/secondary credit rules `getWeekSetsPerMuscle` uses for
   logged sets.

2. **Priority-muscle fit verdict.** For each muscle in `vision.build_emphasis`,
   surface zone (under / optimal / over / risk) against MEV/MAV, mirroring the
   Week page's tile shape.

3. **Live in the builder.** As exercises and sets are added/removed/edited, the
   projection updates — so Lou can answer "if I added a 3rd lower day, do glutes
   move into optimal?" without leaving the page.

4. **Dynamic to routine shape.** Frequency matters: 2 lower days × 8 sets each
   ≠ 3 lower days × 6 sets each, even if the weekly total is the same. The
   projection must respect day frequency, not just total sets.

5. **Surface gaps in routine data.** If the projection needs data the routine
   schema doesn't carry yet (RIR targets, set-failure intent), call that out
   explicitly so we know what's blocking accuracy.

## Non-goals (this phase)

- Generating routines automatically. Lou builds; we evaluate.
- Recommending edits ("add 2 sets to glute work"). Just show the verdict and
  let Lou react. The Week page already owns prescription; this surface is
  diagnostic only.
- Predicting *outcomes* (fatigue, recovery cost). Just volume math vs MEV/MAV.

## Sketch

### Data model

`workout_routine_sets` already has: `min_repetitions`, `max_repetitions`,
`target_weight`, `rpe_target`, `target_duration_seconds`, `tag`. Enough for
volume projection — no schema change required for v1.

**Possible additions** (review phase decides):
- `target_rir` (numeric, 0–5): the routine's intended proximity to failure.
  Today we have `rpe_target` which is convertible (RIR ≈ 10 − RPE), so this
  may be derivable, not a new column.
- `frequency_per_week` on `workout_routines`: how many times per week Lou
  intends to run the cycle. Currently implicit from `workout_routine_days`
  count. Probably already inferable.

### Computation: `projectRoutineVolume(routine) → SetsByMuscleRow[]`

Pure function in `src/lib/training/`. Takes the full routine tree (days →
exercises → sets) and outputs one row per touched muscle:

```ts
{
  slug: MuscleSlug,
  set_count: number,                  // sum of routine sets crediting this muscle
  effective_set_count: number,        // RIR-weighted via rpe_target → RIR
  optimal_sets_min: number,           // from muscles table
  optimal_sets_max: number,
  zone: 'under' | 'optimal' | 'over' | 'risk',
  primary_set_count: number,          // sets where this muscle is primary
  secondary_set_count: number,        // sets where this muscle is secondary only
  is_priority: boolean,               // muscle ∈ vision.build_emphasis
  build_emphasis_rank: number | null, // sort order from vision
  // Frequency info for "low frequency, high per-session volume" warning
  days_touched: number,               // how many distinct days credit this muscle
}
```

Same primary/secondary credit rules as `getWeekSetsPerMuscle`:
- Primary muscle: 1.0 set credit
- Secondary-only muscle: 0.5 credit
- In both: 1.0 (primary wins, no double-count)

RIR weighting (Lou's existing convention):
- RIR 0–3: 1.0× effective
- RIR 4: 0.5×
- RIR 5+: 0.0×
- RIR null: 1.0× (charitable default — same as `getWeekSetsPerMuscle`)

Derive RIR from `rpe_target` when present (RIR = max(0, 10 − rpe)). When
neither exists, fall back to charitable 1.0.

### Surface

Routine builder page (`/plans` → individual routine view). New tile/section:
**"Volume Fit"** or **"Weekly Projection"**.

Layout sketch:

```
┌─────────────────────────────────────────────┐
│ Weekly Projection                           │
│ Based on planned sets · RIR-adjusted        │
├─────────────────────────────────────────────┤
│ Priority muscles                            │
│  ⚠ Glutes        8 sets   under (10–20)     │
│  ✓ Delts        14 sets   optimal           │
│  ✓ Hip abd       6 sets   under (10–20)     │
│  ✓ Core         12 sets   optimal           │
├─────────────────────────────────────────────┤
│ Other (collapsed by default)                │
│  Quads         18 sets    optimal           │
│  ... 13 more                                │
└─────────────────────────────────────────────┘
```

Edits anywhere in the routine recompute the projection (Dexie live query, same
pattern as workout page).

### Comparison mode (stretch)

When Lou is *editing* an existing routine (vs creating a new one): show
"current → projected" delta on each priority muscle. This is the answer to "if
I add a Lower C day, what changes?"

```
Glutes:  8  →  14  (+6, into optimal)
Delts:  14  →  16  (+2, still optimal)
```

### What about "needs slightly more data for this to work"?

Two specific gaps to validate in review:

1. **RIR intent.** Routines today encode `rpe_target` per set, but it's
   sparsely populated in Lou's actual `Androgod(ess) Q2 2026` routine. If most
   sets have null RPE, RIR weighting falls to the charitable default and the
   "effective_set_count" column equals raw `set_count` — the RIR-weighted
   distinction collapses. **Question for review:** is per-set RIR target
   something the routine builder should prompt for, or is the charitable
   default fine for projection (since logged sets will have actual RIR anyway)?

2. **Frequency vs total volume.** A muscle hit 3×/week at 5 sets each is
   superior to 1×/week at 15 sets for hypertrophy (Schoenfeld 2019 frequency
   meta). Today's `getWeekSetsPerMuscle` returns total set count — frequency
   is implicit. The projection should at least *show* `days_touched` so Lou
   can spot "high volume, low frequency" routines. **Question for review:**
   do we surface a frequency warning, or just expose the data and let Lou
   read it?

## Open questions for review

(These are things /autoplan should pressure-test, not pre-answer.)

1. Is "diagnostic only" the right scope, or should the builder also offer
   prescriptive nudges ("you're 6 sets short of optimal on glutes — would you
   like to add another glute exercise?")?

2. Should the verdict use Lou's *vision build_emphasis* (the 4 priority
   muscles), or the *full 18-muscle taxonomy*? Or both — priority-first +
   collapsed others?

3. Lou specifically called out 5-day LULUL. Is this projection enough, or
   does Lou actually want a "what-if" sandbox where they can hypothetically
   restructure days without committing? (That's a much bigger surface.)

4. Where exactly does the verdict tile live? Top of the routine card?
   Sticky footer? Separate `/plans/[uuid]/volume` route?

5. Does the prescription engine's concept of `effective_set_count` (RIR-weighted)
   apply *as-is* to projection, or does the projection need its own simpler
   model (since "RIR drift" and "anchor-lift slope" don't exist for unlogged
   sets)?

6. The Week page filters HOLD prescriptions out (silence beats noise). Should
   the routine projection follow the same rule, or always show all priority
   muscles even when in optimal?

7. **Day-frequency model.** Should we model "how many *distinct days* of the
   cycle credit this muscle" as a first-class concept and warn when it's <2
   for hypertrophy targets? RP/Helms convention says 2× per week minimum for
   muscle growth.

## Scope estimate

- **Pure function** (`projectRoutineVolume`) + tests: half a day CC.
- **API hook** (return projection alongside routine GET): an hour.
- **UI tile** in routine builder (priority muscles + collapsed others, live
  recompute): a day CC.
- **Comparison mode** (current vs projected): half a day CC, depends on
  whether we go that far in v1.
- **Total v1 estimate**: ~2 days CC effort, ~1 week human equivalent.

Boil-the-lake worth doing: hooking `projectRoutineVolume` into the `/feed`
prescription engine itself, so the Week page can show "your routine *plans*
14 sets but you *logged* 8 — adherence gap" as a 4th category alongside
PUSH/REDUCE/DELOAD. This is logically adjacent, low cost, surfaces a real
signal Lou cares about (am I doing what I planned). **Decide in review.**

## Files in blast radius

(From the code map — no actual code edits yet.)

- `src/lib/training/projection-engine.ts` (NEW) — pure function
- `src/lib/training/projection-engine.test.ts` (NEW) — unit tests
- `src/db/queries.ts` — possibly add `getActiveRoutineWithExercises` projection
  helper (or do it client-side from Dexie — review decides)
- `src/app/api/plans/[uuid]/routines/[routineUuid]/route.ts` — return
  `projectedVolume` alongside routine data
- `src/app/plans/page.tsx` (or equivalent) — `<RoutineCard>` adds Volume Fit
  tile
- `src/components/RoutineVolumeFit.tsx` (NEW) — the tile component
- `src/lib/useLocalDB-routines.ts` — possibly extend hook to compute projection

No schema migration in v1.

## Decision log

(Populated by /autoplan auto-decisions. Final-gate items live in the
"DECISIONS FOR LOU" section below.)

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Reshape plan: data model + shared core + simulation v0 (not parallel projection engine) | Mechanical | P5 explicit, P4 DRY | All 3 voices flagged parallel projection engine as duplication of prescription-engine.ts internals | Build new projection-engine.ts standalone |
| 2 | CEO | Frequency-as-red-zone is required, not optional | Mechanical | P1 completeness | Schoenfeld 2019 ≥2x/wk floor; Lou's motivating example IS a frequency question; days_touched<2 on priority muscle = critical | Treat frequency as a soft warning |
| 3 | CEO | Confidence degradation when RPE/frequency unknown — don't synthesize green ticks | Mechanical | P5 explicit | Plans without RIR target should produce `uncertain` zone, not optimistic raw count masquerading as effective | Charitable 1.0 default for null RIR in projection |
| 4 | CEO | Adherence loop (planned vs logged) is in scope, not "boil-the-lake follow-up" | TASTE | P1 completeness | Codex: this is the actual strategic payoff. Claude: agrees as +1 expansion. Androgodess: agrees once data fixes land. But scope expansion is real (~1 extra day CC). | Defer to follow-up phase |
| 5 | CEO | Vision-aware MAV overrides for build_emphasis muscles | Mechanical | P1 completeness | Default optimal_sets_max=20 will flag Lou's correct glute volume (24+) as "over"; tool would argue with the plan | Use unmodified per-muscle defaults |
| 6 | CEO | Lateral-delt sub-muscle resolution — required v1 | USER CHALLENGE | — | Androgodess flagged this as the credibility-killer for Lou's #1 transformation target. Lou's plan does NOT mention sub-muscle taxonomy. This is a structural change Lou should weigh in on. | (For Lou to choose) |
| 7 | CEO | Surface name change: "Planned weekly volume" not "Volume Fit" / "Weekly Projection" | Mechanical | P5 explicit | Honest framing — Week page handles dynamic prescription, builder handles static volume/frequency check. Avoids "two coaches disagreeing." | Keep Volume Fit framing |

---

# /autoplan REVIEW REPORT

## Phase 1 — CEO Review

Three independent voices: **Codex** (adversarial strategy), **Claude subagent**
(independent CEO read), **Androgodess PT subagent** (Lou's coach lens, grounded
in androgodess SKILL.md science notes + body-comp targets).

### CEO consensus table

```
═════════════════════════════════════════════════════════════════════════
  Dimension                           Claude   Codex   Andro   Consensus
  ─────────────────────────────────── ──────── ─────── ─────── ─────────
  1. Right problem to solve?          NO       NO      NO      DISAGREE-w-plan
  2. Premises valid?                  NO       NO      NO      DISAGREE-w-plan
  3. Scope calibration correct?       NO       NO      NO      DISAGREE-w-plan
  4. Alternatives explored?           NO       NO      —       CONFIRMED-gap
  5. Competitive/differentiation?     MEDIUM   —       —       MEDIUM
  6. 6-month trajectory sound?        NO       NO      NO      DISAGREE-w-plan
═════════════════════════════════════════════════════════════════════════
VERDICTS: Codex=RESHAPE, Claude=RESHAPE, Androgodess=RESHAPE.
Zero voices said SHIP AS-IS.
```

### Convergent critical findings (≥2 voices)

**[CRITICAL] Don't build parallel projection-engine.ts.** All 3 voices.
Extract shared volume math (primary/secondary credit, RIR weighting, zone
classification, priority-muscle ordering) into a single core consumed by BOTH
the existing `prescriptionsFor()` and the new routine projection. Codebase
already has the canonical math at `src/db/queries.ts:1481` (logged path) and
`src/lib/training/prescription-engine.ts` (consumer). Drift between two
implementations within a quarter is the predictable failure mode CLAUDE.md
already warns about ("two coaches disagreeing"). Fix: extract `volume-math.ts`
pure module before building projection.

**[CRITICAL] Routine data model is unfit for honest projection.** All 3 voices,
strongest from Codex and Androgodess. Without per-set RIR target, RIR weighting
falls to the charitable default and "effective_set_count" silently equals raw
`set_count` — a confident green tick from missing data. Without explicit
`frequency_per_week` intent, day count is ambiguous (4-day-cycle-run-every-7-days
vs 4-day-rotated-as-available). Lou's own line — "needs slightly more data for
this to work" — IS this finding. Fix: data-model PR lands FIRST, projection
PR lands SECOND. Specifically:
  - Audit current `Androgod(ess) Q2 2026` routine: what % of sets have usable
    `rpe_target`? If <50%, no projection will be honest until populated.
  - Add `target_rir int` to `workout_routine_sets` (or rationalize `rpe_target`
    so it's required for working sets).
  - Add `frequency_per_week int` to `workout_routines` (default = day count,
    overrideable for cycle/sparse plans).
  - Confidence flags: `effective_set_count` returns `null` when RIR unknown.
    UI shows "uncertain" zone, not optimistic green.

**[CRITICAL] Frequency is a first-class red-zone driver, not a footnote.**
Androgodess strongest, Codex agrees. Lou's literal motivating example
(4-day vs 5-day LULUL for glutes) is a frequency question dressed as volume.
Schoenfeld 2019: ≥2x/wk per muscle is the hypertrophy floor. Fix:
`frequency_zone` field alongside `volume_zone`. `days_touched<2` on a
`build_emphasis` muscle = red zone regardless of total set count. A routine
with 18 glute sets in one Lower-A is *worse* than 12 sets across 2 days —
the tile must say so.

**[CRITICAL] Vision-aware MAV overrides — without them, the tool argues with
the androgodess plan.** Androgodess unique critical finding, Codex echoes
("priority constraints"). Default `optimal_sets_max=20` for glutes will flag
Lou's correct 24-set glute volume as "over." Lateral delts spec is 12-16
even though parent slug shows higher. Fix: `vision.build_emphasis` entries
gain optional `override_sets_min`/`override_sets_max`, OR routine projection
respects per-vision-muscle ranges. Without this, the projection on the 5-day
LULUL example tells Lou NOT to do exactly what the plan tells them to do.

**[CRITICAL] "Diagnostic only" is a fig leaf — design the boundary now.**
Codex + Claude. Lou will immediately ask "so what should I change?" The fix
is NOT to add prescription (that violates CLAUDE.md's "two coaches" ban).
The fix is to be precise about boundaries:
  - `/feed` = adaptive coach from logged reality (PUSH/REDUCE/DELOAD)
  - Routine builder = design-time constraint check from planned intent
  - Builder language: "glutes short by 6 effective sets," "hip abductors only
    touched 1 day," "delts at MRV at 2-day frequency" — *design feedback*,
    not weekly *prescription*.
This is the same code, different framing — but the framing matters because
"PUSH glutes +2" vs "glutes are 6 sets short" reads differently to Lou.

### Critical finding from one voice (still flagged)

**[CRITICAL — Androgodess] Lateral-delt sub-muscle resolution.** The 18-slug
taxonomy treats "delts" as one muscle. Lou's #1 most-aggressive transformation
target — shoulder width 40.6→50cm — is a *lateral-head specialization* problem
that the monitoring log ALREADY flags ("total delts 22 sets/wk reads over,
lateral-direct only 4 sets/wk"). A volume tile that says "delts: optimal/over"
on a routine where lateral is undertrained is actively misleading. Two fix
options:
  - (a) Extend taxonomy with `delts_lateral` / `delts_anterior` / `delts_posterior`
    (proper, ~1-2 days extra, requires migration + exercise re-tagging).
  - (b) Exercise-tag layer: `lateral_emphasis: true` on lateral_raise / cable_y_raise,
    derive virtual `delts_lateral` row in projection only (no schema change,
    less precise, faster).

This is a USER CHALLENGE — Lou should pick (a), (b), or "ship without and accept
the blind spot." Same blind spot exists in miniature for glutes (gmax vs gmed)
and core (rectus vs anti-rotation) but lateral delts is the one that breaks
THIS feature for THIS user.

**[CRITICAL — Codex] Adherence loop is the strategic payoff, not "boil-the-lake
follow-up."** Codex argues the plan undersells the planned-vs-logged loop.
"Routine plans 14 glute sets; you logged 8 this week" is the closed loop that
makes routines a meaningful upstream contract for /feed. The plan defers this
as a stretch. Codex says it should be in v1 scope. Marked as TASTE DECISION
because it's a real scope expansion (~1 extra day CC) — Lou should weigh in
even though both engineering and PT angles support including it.

### Reshaped scope

Based on the convergent findings, the v1 scope should be:

**Sequence:**
1. **PR1 — Routine data model fixes** (~1 day CC):
   - Add `target_rir` to `workout_routine_sets` (or backfill from `rpe_target`).
   - Add `frequency_per_week` to `workout_routines`.
   - Audit Lou's active routine to populate where possible.
   - Confidence-flag plumbing.

2. **PR2 — Shared volume math extraction** (~half day CC):
   - Pull primary/secondary credit + RIR weighting + zone classification
     into `src/lib/training/volume-math.ts` (pure module).
   - Refactor `getWeekSetsPerMuscle` SQL helper or post-processor to use it.
   - Refactor `prescription-engine.ts` to consume from the same module.
   - **No behavior change for /feed** — pure refactor with snapshot tests.

3. **PR3 — Routine volume projection + tile** (~1 day CC):
   - `projectRoutineVolume(routine, vision, muscleDefs)` consumes shared math.
   - Frequency-as-red-zone semantics applied.
   - Vision-aware MAV overrides honored.
   - "Planned weekly volume" tile in routine builder.
   - Confidence states surfaced (uncertain when RIR null).
   - Lateral delt sub-muscle resolution per Lou's choice (a/b/skip).

4. **PR4 — Adherence delta on /feed** (~1 day CC, conditional on user-challenge):
   - Compare planned (from active routine) vs logged.
   - Add as 4th category alongside PUSH/REDUCE/DELOAD: "ADHERENCE GAP".

**v1 scope = PR1 + PR2 + PR3.** Total ~2.5 days CC.
**v1.1 scope = +PR4.** Total ~3.5 days CC.

### What's NOT in scope (deferred)

- Auto-generation of routines (still Lou's call, tool diagnoses only).
- Recovery prediction / fatigue cost modeling.
- Sub-muscle taxonomy beyond delts (gmax vs gmed, rectus vs obliques) — flag
  as future work.
- Training-block sequencing decisions ("is this routine right for week 4 of
  build phase?") — outside this layer.

---

## Phase 2 — Design Review

Two voices: **Codex** (adversarial UX) + **Claude subagent** (independent design).

### Design consensus table

```
═════════════════════════════════════════════════════════════════════════
  Dimension                                Claude   Codex   Consensus
  ──────────────────────────────────────── ──────── ─────── ─────────
  1. Information hierarchy clear?          NO       NO      DISAGREE-w-plan
  2. State coverage complete?              NO       NO      DISAGREE-w-plan
  3. Frequency × volume coexistence solved?NO       NO      DISAGREE-w-plan
  4. Confidence visualization correct?     NO       NO      DISAGREE-w-plan
  5. Live recompute UX specified?          NO       NO      CONFIRMED-gap
  6. Routing/IA decided?                   NO       NO      CONFIRMED-gap
  7. Comparison mode handled?              NO       PARTIAL DISAGREE-w-plan
  8. Sub-muscle UI shape specified?        NO       NO      DISAGREE-w-plan
═════════════════════════════════════════════════════════════════════════
VERDICTS: Codex=(implicit RESHAPE via gap-list), Claude=RESHAPE.
```

### Convergent design findings (both voices)

**[CRITICAL] Single verdict glyph per row — min of (volume, frequency,
confidence).** Both voices reject "two badges per row" or stacked pills.
Each row gets ONE glyph (✓ / ⚠ / ⌀ / ●) computed as the worst-of all axes.
Detail line names the binding constraint. Without this rule, Lou reads the
green tick on volume and stops — silently invalidating the feature on Lou's
literal motivating example (16 sets glutes in 1 day = "optimal volume,
frequency too low" must read as ⚠, not ✓).

**[CRITICAL] Uncertain (RIR-null) state must NOT look positive.** No green,
no checkmark, no "optimal" adjacency. Use neutral gray/amber, `?` or `⌀`
glyph, dashed range bar, copy "Uncertain — RIR targets missing." Footer
rollup ("3 of 8 muscles uncertain — populate RIR targets to sharpen") points
to the fix. Without this, charitable defaults synthesize confident green
ticks from missing data.

**[CRITICAL] Frequency + volume need separate visual channels in the row.**
Single-line headline that reads "Optimal volume · 1×/wk frequency risk"
preserves both signals even when collapsed. Long-form row can render
volume+range and frequency on separate lines. Either way the verdict glyph
takes the WORST of both — a row with optimal volume + inadequate frequency
must display ⚠, never ✓.

**[CRITICAL] State coverage required for v1.** Eight states need explicit
specification — listed in the Implementation Checklist below. Empty routine
and "all priority optimal" are the two most common states for the first 90
seconds of every routine session, both unspecified in the rough plan.

**[HIGH] Top-of-routine-card placement, NOT sticky footer.**
Both voices align: sticky footer eats too much vertical real estate on
mobile (Capacitor iOS shell already has tab bar). Separate `/plans/[uuid]/volume`
route kills live-edit feedback. Top-of-card with collapsed one-line summary
that expands to full tile is the right shape. Specifically:
  - Collapsed (accordion closed): single summary line —
    `⚠ 1 of 4 priority muscles needs work` or `✓ All 4 priority optimal`.
  - Expanded: full tile inline above the day list and exercise rows.

**[HIGH] Live recompute: <100ms, snap values, 600-900ms emphasis on changed
number, stable sort while focused.** Numbers snap-update (no ticker — at 12+
visible rows that reads as nausea). Zone color cross-fade 150ms. Sort order
stable while edit input focused, re-sort on blur. Range labels fade
in/out only when verdict actually changes.

**[HIGH] Vision-aware MAV override surfacing.** Small "Vision" pill or `★`
next to the range when MAV is overridden. Tooltip/popover shows
"Default MAV: 20 / Lou's glute emphasis MAV: 24." Visible on the row, not
hidden in tooltip-only.

**[HIGH] Lateral delt sub-muscle resolution UI shape (option-dependent).**
- If option (b) ships (exercise-tag layer): single delts row with indented
  child sub-row showing `delts: lateral` count derived from
  `lateral_emphasis: true` exercise tags.
- If option (a) ships (taxonomy extension): three sibling rows
  (delts: lateral / anterior / posterior) with optional rollup.
- If skipped: explicit footer copy "Lateral delt specificity unavailable" —
  do NOT silently green-tick parent delts.

### Divergent: comparison mode (current → projected diff)

This is a TASTE DECISION already in the decision log (#4 family). Voices split:
- **Claude design**: "diff IS the headline." Lou's stated example only
  has a useful answer relative to the 4-day baseline. Make every priority
  row a `before → after (Δ)` row, collapse Δ to nothing when before == after.
- **Codex design**: design the data shape and reserve a delta slot in the row
  component now, ship absolute-only in v1, add diff UI in v1.1 when comparing
  published routines / variants becomes the obvious next step.
- **Codex eng**: snapshot baseline at-mount, diff against it until save —
  no new persistence layer.

Both can be true. The TASTE call is whether v1 ships absolute-only with the
component shape ready (Codex), or v1 ships diff-as-default with absolute as
the empty-baseline case (Claude). Live in the final gate as a real Lou call.

---

## Phase 3 — Eng Review

Three voices: **Codex** (architecture pressure), **Claude subagent**
(independent eng), **Androgodess PT-eng** (volume-math correctness).

### Eng consensus table

```
═════════════════════════════════════════════════════════════════════════
  Dimension                                Claude   Codex   Andro   Consensus
  ──────────────────────────────────────── ──────── ─────── ─────── ─────────
  1. Architecture sound?                   PARTIAL  PARTIAL —       PARTIAL
  2. "Shared core" extraction tractable?   PARTIAL  PARTIAL —       PARTIAL
  3. Test strategy specified?              YES      YES     —       CONFIRMED
  4. Schema migration safe?                YES*     YES*    —       CONFIRMED-w-caveat
  5. Performance OK?                       YES      —       —       OK
  6. Failure modes catalogued?             YES      YES     YES     CONFIRMED
  7. PR ordering optimal?                  PR2→PR1→PR3 (all 3) — all 3 agree   CONFIRMED
  8. Volume math correctness?              —        —       NO      DISAGREE-w-plan
═════════════════════════════════════════════════════════════════════════
* = "yes IF sync routes also touched" — single biggest PR1 risk
VERDICTS: Codex=RESHAPE, Claude=RESHAPE, Androgodess=RESHAPE.
```

### Convergent eng findings (≥2 voices)

**[CRITICAL] CEO's "shared core" framing is partly wrong — refine before
implementing.** Both eng voices independently flagged this. The SQL in
`queries.ts:1481` IS the volume math (executed in Postgres). The TS in
`prescription-engine.ts:138` consumes already-projected facts and emits
PUSH/REDUCE/DELOAD — it does NOT do volume math. They look similar but operate
at different layers. The honest extraction is *smaller*: pure constants and
contribution functions (`primarySecondaryCredit`, `rirCredit`,
`effectiveSetContribution`, `zoneFor`, `mrvAtFreq`) — the credit + RIR rules.
The SQL stays canonical for the logged path (perf, transactionality);
the TS module gets used by `projectRoutineVolume()` for Dexie data; a
**conformance test** asserts SQL output ≡ TS output for a fixed fixture set.
Don't refactor `getWeekSetsPerMuscle` to call TS — that drops Postgres
aggregation for negligible gain.

**[CRITICAL] PR1 must touch 4 layers, not 1.** Both eng voices flagged
sync-engine drop-on-write as the single biggest PR1 risk. The set:
- Postgres migration (`workout_routine_sets.target_rir`,
  `workout_routines.frequency_per_week`).
- Dexie version bump (likely v22) in `src/db/local.ts:595`.
- Local types `LocalWorkoutRoutine`, `LocalWorkoutRoutineSet` in
  `src/db/local.ts:112`.
- **Sync routes** — pull selection in
  `src/app/api/sync/changes/route.ts:171` AND push upserts in
  `src/app/api/sync/push/route.ts:357`. Without this, local edits silently
  drop the new columns and Lou's routine RIR targets quietly disappear on
  the next sync round-trip. CLAUDE.md's watch-companion warning is the same
  failure mode pattern: "must echo every column or EXCLUDED.column NULLs
  fields the writer didn't touch."

**[CRITICAL] Don't reshape `vision.build_emphasis` to add MAV overrides.**
Both eng voices: it's currently `string[]` consumed across multiple
codebase locations (Dexie types, useLocalDB-strategy.ts, WeekFacts assembly,
prescription engine). Object-shape migration is broad and breaks existing
normalization. Less-invasive options:
- **Add `vision_muscle_overrides` table** keyed by `(vision_uuid, muscle_slug)`
  with nullable `override_sets_min` / `override_sets_max` /
  `override_freq_min`. Cleaner, reversible, queryable.
- Or nullable JSONB `muscle_overrides` on `body_vision`. Faster but easier
  to drift.
**Recommendation: separate table.** Reverses cleanly if abandoned.

**[CRITICAL — Androgodess unique] Volume math correctness has 4 specific
issues the plan glosses:**

1. **Per-muscle frequency floors, NOT flat-2.** Schoenfeld's ≥2× is a
   population mean. Concrete per-muscle floors:
   - Glutes: 2–3 (RP says 3+ at high volume)
   - Lateral delts: 2–4 (small muscle, fast recovery — Lou's 12-16 spec needs 3)
   - Hip abductors: 2–3
   - Core (rectus): 3–5
   - Calves: 3–6
   - Chest, hams: 1–2 (eccentric-damage, slow recovery)
   - Quads, back/lats: 2
   - Biceps/triceps: 2–3
   Stored on muscle definitions (extends `MUSCLE_DEFS`), with optional
   per-vision override.

2. **Concrete MAV overrides for Lou's vision.** Numbers grounded in the
   androgodess SKILL.md science cliff-notes:
   - **Glutes:** override `sets_min: 14, sets_max: 26, freq_min: 3`
     (skill says glutes tolerate 24+; monitoring-protocol flag triggers at
     <14 or >24 — match those).
   - **Lateral delts** (when sub-muscle ships): `sets_min: 8, sets_max: 16,
     freq_min: 3` (skill says 8 sets → 3.3-4.6% growth in 8 weeks; 12-16 is
     specialization).
   - **Hip abductors:** `sets_min: 8, sets_max: 16, freq_min: 2` (literature
     thin — flag `evidence: 'low'`).
   - **Core (rectus):** `sets_min: 8, sets_max: 16, freq_min: 3`.
     **Cap obliques at `sets_max: 6`** (Lou's plan deliberately suppresses
     oblique hypertrophy for waist target). Anti-rotation work like Pallof
     press tagged `stimulus: 'stability'` so it doesn't pollute hypertrophy
     counts.

3. **RIR weighting tiers — refine.** Current 1.0/1.0/1.0/1.0/0.5/0.0 step
   function loses signal. Replacement (Schoenfeld 2021 + Beardsley
   effective-reps grounding):
   ```
   RIR 0 (failure)    → 1.0   (NO bonus — extra fatigue, same stimulus)
   RIR 1–2            → 1.0
   RIR 3              → 1.0
   RIR 4              → 0.5   (current value, defensible)
   RIR 5              → 0.25  (NEW tier — sub-stimulus, not zero)
   RIR 6+             → 0.0
   ```
   Current code's `RIR 5 = 0.0` is too punitive (deliberate pump finishers
   at RIR 5 aren't worthless). Document the "no failure bonus" rule
   explicitly in volume-math.ts so future-Lou doesn't "fix" it upward.

4. **`cycle_length_days` on `workout_routines`.** Frequency-per-week ≠
   days-in-cycle when cycle isn't 7. A 4-day routine run "as available"
   (avg 9-day cycles) effectively delivers 1.5×/wk, not 4×/wk. Without
   this field, the projection is honest only for routines where
   `frequency_per_week == routine_days.length`. Add as nullable int on
   `workout_routines`, default null = "weekly cycle" assumption.

**[HIGH] Lateral-delt option (b) is the v1 ship.** All 3 voices converged.
Cost: ~2 hours (add `lateral_emphasis` boolean tag on ~5 exercises in
`exercises` table, derive virtual `delts_lateral` row in projection).
Reversible: drop the column, drop the projection branch (~20 lines).
Option (a) (taxonomy extension) is correct long-term but locks in
structural commitment, requires re-tagging ~30-50 exercises, breaks
historical comparison continuity. Defer (a) to v1.1+ once (b) validates the
framing.

**[HIGH] PR ordering: PR2 → PR1 → PR3 → optional PR4** (all 3 voices).
- PR2 (volume-math.ts pure module + conformance test) ships INDEPENDENTLY
  first. Lowest risk, no consumers initially, earns trust in the math.
- PR1 (schema + sync routes + Dexie version bump) ships second. Independent
  testability via sync round-trip.
- PR3 (projection + tile + lateral-delt option-b + vision overrides table)
  consumes both. Bail-out: feature flag the tile if data quality bad.
- PR4 (adherence delta on /feed) only ships after PR3 validates with
  real-use data quality. Conditional on Lou's TASTE call.

This ordering unblocks parallel work and keeps trunk green at every step.
Original plan's strict PR1→PR2→PR3 chain is overspecified.

**[HIGH] Adherence model — two zones side-by-side, NOT multiplication.**
(Androgodess unique; both eng voices defer to the call.) PR4's verdict
should NOT be `expected_delivered = planned × adherence_pct` (single
number that hides failure modes). Instead: two zones — `planned_zone`
("does the routine prescribe enough?") and `delivered_zone` ("did logged
reality hit the dose?") — plus `adherence_pct` as a third axis.
"ADHERENCE GAP" verdict fires only when:
```
planned_zone == optimal AND delivered_zone == under AND adherence_pct < 80
```
That's the actionable case (routine fine, execution isn't). If
`planned_zone == under`, adherence is irrelevant — fix the routine first.

**[MEDIUM] Live recompute is trivially cheap.** Both eng voices: ~360
(set, muscle) hits per routine, O(n) Map aggregation, <1ms in V8. No
memoization needed for v1. Mirror the workout page's existing
`useEffect` recompute-on-mutation pattern. Revisit only if routines ever
exceed ~500 sets.

### Failure modes registry

| # | Severity | Failure | Detection | Mitigation |
|---|---|---|---|---|
| 1 | CRITICAL | Sync push payload misses `target_rir` / `frequency_per_week` → Dexie writes silently lost on next pull (server overwrites with NULL) | Sync round-trip test: edit on phone → fresh-install → verify field present. | PR1 wires sync.ts + push route. Add a "every Dexie column appears in push serializer" parity test. |
| 2 | CRITICAL | Vision MAV override disagrees between routine builder and `/feed` Week tile (Lou's 24-set glutes reads "optimal" in builder, "over" on Week page) — the "two coaches" failure mode | Snapshot test: same vision + same set count → same zone in both surfaces | Apply override at `volume-landmarks.zoneFor` call sites in BOTH `/feed` aggregator AND `projectRoutineVolume`. Single source of override (vision_muscle_overrides table). Don't fork the math. |
| 3 | CRITICAL | Lateral-delt blind spot persists. Routine reads "delts: optimal/14 sets" but lateral-direct is 2 sets. Lou's #1 transformation target. | Manual: run projection on `Androgod(ess) Q2 2026`, compare to monitoring log's lateral-direct count. | Ship option (b) — exercise-tag layer with `lateral_emphasis: true`. |
| 4 | HIGH | Confidence flag silently degrades to "uncertain" forever because `target_rir` populated <50% of sets, but UI doesn't surface that. Lou stops trusting the tile. | Dev-console log of `% of routine sets with target_rir set` when projection runs. Audit query in PR3. | If <50% on Lou's active routine, add UI prompt to populate. |
| 5 | HIGH | Frequency math wrong for cycle-rotated routines. 4-day-run-as-available averages 1.5×/wk, not 4×/wk. `days_touched` from `routine_days.length` is wrong. | Compare projection's `days_touched` for active routine vs `getWeekSetsPerMuscle`'s 8-week trailing average. Alert if Δ > 1. | `frequency_per_week` + `cycle_length_days` columns. Default to day count, surface override prominently. |
| 6 | MEDIUM | Per-muscle frequency floor flat-2 mis-flags. RP says hams can grow on 1×/wk; flat-2 would red-flag a fine routine. Lateral delts at 2 days insufficient for Lou's spec; flat-2 would green-tick an under-frequencied routine. | Walkthrough on Lou's active routine + 5-day LULUL hypothetical. | Per-muscle frequency floors stored alongside MEV/MAV (extension to MUSCLE_DEFS), with vision override. |
| 7 | MEDIUM | Exercise catalog missing muscle tags produces false undercount | `coverage` flag from `getWeekSetsPerMuscle` (already exists) | Surface "N muscles can't be evaluated — exercise X missing primary tag" in tile footer. |
| 8 | MEDIUM | Routine page recomputes on every keystroke during set-count edit, causing jitter | DevTools render timing | Debounce input field at 100ms; sort order stable while focused. |

### Implementation Checklist (PR-ordered)

**PR2 — Shared volume math module** (~half day CC, ships first, no consumers yet)
- [ ] Create `src/lib/training/volume-math.ts` with pure exports:
  `primarySecondaryCredit(primary[], secondary[]) → MuscleCredit`,
  `rirCredit(rir | null) → number` (with the 5-tier table above),
  `effectiveSetContribution(set) → MuscleHit[]`,
  `aggregateMuscleHits(hits) → SetsByMuscleRow[]`.
- [ ] `zoneFor()` from `volume-landmarks.ts` is already shared. Verify no
  duplication.
- [ ] `frequency_zone(days_touched, freq_floor) → 'red' | 'yellow' | 'green'`.
- [ ] Conformance test: fixture of synthetic `WorkoutSet[]` covering
  primary-only / secondary-only / in-both / RIR null / RIR 0-3 / RIR 4 /
  RIR 5 / RIR 6+ / incomplete. Assert SQL output (against test Postgres)
  ≡ TS output. Property-style assertions.
- [ ] No behavior change for `/feed`. Snapshot test on existing
  `prescription-engine.test.ts` to prove it.

**PR1 — Routine data model + sync wiring** (~1 day CC)
- [ ] Postgres migration: add `workout_routine_sets.target_rir int CHECK
  (>=0 AND <=10) NULL`, `workout_routines.frequency_per_week int NULL`,
  `workout_routines.cycle_length_days int NULL`.
- [ ] Postgres migration: add `vision_muscle_overrides` table `(vision_uuid,
  muscle_slug, override_sets_min int NULL, override_sets_max int NULL,
  override_freq_min int NULL, evidence text NULL, PRIMARY KEY (vision_uuid,
  muscle_slug))`.
- [ ] Local types in `src/db/local.ts`: add new fields to
  `LocalWorkoutRoutine`, `LocalWorkoutRoutineSet`, plus new
  `LocalVisionMuscleOverride` table.
- [ ] Dexie version bump (v22 likely): add overrides store, no index changes.
- [ ] Sync pull: include new fields in
  `src/app/api/sync/changes/route.ts`.
- [ ] Sync push: thread new fields through
  `src/app/api/sync/push/route.ts` upserts.
- [ ] Parity test: every Dexie column appears in push serializer.
- [ ] One-shot audit query: `% of Lou's active routine's working sets with
  populated target_rir or rpe_target`. Run before PR3 merge.

**PR3 — Projection function + tile UI** (~1.5 days CC)
- [ ] `src/lib/training/routine-projection.ts` —
  `projectRoutineVolume(routine, vision, muscleDefs, overrides) →
  ProjectedSetsByMuscleRow[]`. Pure. Consumes volume-math.ts.
- [ ] Includes `frequency_zone` (per-muscle floor with vision override),
  `confidence: 'confident' | 'uncertain_rir' | 'uncertain_freq' | 'uncertain_subgroup'`.
- [ ] Lateral-delt option (b): `exercises.lateral_emphasis bool NULL` column;
  tag the 5 exercises (lateral_raise, cable_y_raise, leaning_lateral_raise,
  machine_lateral_raise, db_lateral_raise); derive virtual `delts_lateral`
  row in projection. Vision can opt-in `delts_lateral` as priority muscle.
- [ ] `src/components/RoutineVolumeFit.tsx` tile component:
  - Single verdict glyph per row (`min(volume_zone, frequency_zone, confidence)`).
  - Detail line names binding constraint.
  - Uncertain state visually distinct from optimal (no green, no ✓).
  - Vision override "★" or pill indicator with tooltip.
  - Sub-row pattern for delts_lateral when option (b) ships.
  - Collapsed summary line when accordion closed:
    `⚠ N of M priority muscles need work` or `✓ All M priority optimal`.
  - Expanded inline tile at top of routine card.
- [ ] State coverage:
  - Loading: skeleton with `muscles.length` rows, no spinner.
  - Empty routine (0 exercises): suppress tile, show inline copy "Add
    exercises to see weekly projection."
  - No active routine: tile not rendered.
  - No vision / empty build_emphasis: skip Priority section, render
    collapsed All-muscles only.
  - Single-day routine: explicit footer "1 day/week — most muscles can't
    hit ≥2× frequency floor."
  - All priority optimal: single-line celebrate state.
  - Editing active vs draft routine: subtle "Active" pill on tile header.
  - MEV undefined for muscle: render "—", neutral, footer copy.
- [ ] Live recompute: useEffect on Dexie live query, no memoization
  (cheap), <100ms p95. Snap values, 600-900ms emphasis on changed
  number. Stable sort while edit input focused.
- [ ] Tests: 8 fixtures (4-day current, 5-day LULUL hypothetical,
  high-volume single-day, no-priority, vision-override-applied, empty,
  lateral-delt option-b, frequency-cycle-override).

**PR4 — Adherence delta on /feed** (~1 day CC, OPTIONAL)
- [ ] Compare `planned_zone` from active routine vs `delivered_zone` from
  logged data + `adherence_pct`.
- [ ] Two-zone display, NOT multiplication.
- [ ] "ADHERENCE GAP" verdict fires only when `planned == optimal AND
  delivered == under AND adherence_pct < 80`.
- [ ] Render as 4th category alongside PUSH/REDUCE/DELOAD (or as a
  separate strip — design decision in v1.1).

### Cross-phase themes

- **"Two coaches" risk recurs at every layer.** CEO flagged it for the
  builder vs Week page boundary. Eng flagged it for the SQL vs TS volume
  math. Design flagged it for the verdict-glyph composition. Single-source-of-truth
  is the through-line — vision overrides apply once, RIR weights live in
  one module, verdict glyph is min-of-axes not max-of-axes.
- **"Confidence is first-class" recurs across CEO, Design, Eng.** RIR null
  ≠ green tick. Frequency inferred ≠ frequency known. Sub-muscle approximated
  ≠ sub-muscle resolved. The plan must surface uncertainty visibly, not
  hide it in defaults.
- **Lou's stated motivating example (5-day LULUL glutes) is a frequency
  question, not a volume question.** All three phases independently
  arrived at this. Plan v1 must answer it correctly: requires per-muscle
  frequency floors, vision MAV overrides, and `cycle_length_days` to be
  honest.


---

# /autoplan REVIEW COMPLETE — DECISIONS FOR LOU

> Lou — you're going to wake up to this. Seven independent voices ran (CEO ×3,
> Design ×2, Eng ×3). Every one returned **RESHAPE**. The plan is sound at the
> seed level but the v1 spec as you sketched it would have shipped a green-tick
> illusion that breaks on your own motivating example (5-day LULUL glutes).
> Below is the structured stack of decisions you make this morning. Pick A/B/C
> on each and I'll execute.

## Plan summary (one paragraph)

Bring the Week-page priority-muscle volume math into the Routine builder so
routines are assessed against MEV/MAV/frequency before being followed. Sequence:
extract a small pure `volume-math.ts` (PR2), add routine data-model fields +
sync wiring (PR1), build `projectRoutineVolume()` + tile (PR3), optional
adherence delta on /feed (PR4). Total v1 ≈ 3 days CC, +1 day if PR4. Critical
bits: per-muscle frequency floors (not flat-2), vision-aware MAV overrides via
new table (not vision shape change), `lateral_emphasis` exercise tag for
lateral-delt resolution, single-verdict-glyph rows that take the worst of
volume/frequency/confidence axes.

## Decisions taken (auto-decided — see Decision log table above)

7 decisions auto-decided using the 6 principles. Most important:
1. Don't build parallel projection-engine.ts — extract small shared core only.
2. Frequency-as-red-zone is required, NOT optional.
3. Confidence degradation visible, no green ticks from missing data.
4. Vision-aware MAV overrides via new table (not field reshape).
5. PR ordering: PR2 → PR1 → PR3 (lowest risk, parallelizable).
6. Per-muscle frequency floors with concrete numbers from androgodess science notes.
7. RIR weighting tier refinement: add 0.25 at RIR 5, no failure bonus.

Each is the recommended choice from the 6 principles AND has consensus
across multiple voices. Override any of them in your morning answers if you
disagree.

## USER CHALLENGES (4) — both engineering AND PT voices recommend changing your stated direction

These are the cases where the review consensus is that your plan as written
should be modified. None are auto-decided. Default = your original direction;
the reviewers must make the case for change.

### UC1 — Schema change is required, not "no schema change in v1"

**You said:** "No schema migration in v1." (Plan line ~190)

**Both eng voices + PT voice say:** Schema migration IS required. Specifically:
- `workout_routine_sets.target_rir int NULL`
- `workout_routines.frequency_per_week int NULL`
- `workout_routines.cycle_length_days int NULL`
- `vision_muscle_overrides` table (new)
- `exercises.lateral_emphasis bool NULL`

**Why:** Without `target_rir` populated, RIR weighting falls to the charitable
default and "effective_set_count" silently equals raw `set_count` — a confident
green tick from missing data. Without `frequency_per_week` + `cycle_length_days`,
projection is honest only for routines run exactly once per 7-day cycle (your
4-day routine doesn't qualify if you've ever skipped a day). Vision MAV
overrides need persistence. Lateral-delt resolution needs a tag.

**What we might be missing:** Lou-side context that "no schema change" was a
ship-speed preference, not a hard constraint. If the cost is "you ship v1 a
day later but it's actually correct," that's probably worth it.

**If we're wrong:** Wasted half-day on schema, worktree throwaway. Downside is
small.

**Cost:** ~1 day CC for the migration + sync wiring (PR1).

→ **Recommendation: ACCEPT the schema change.**

### UC2 — Sub-muscle resolution for lateral delts (option b) ships in v1

**You said:** Plan didn't mention sub-muscle resolution at all.

**Both eng voices + PT voice say:** Required for v1. Without it, the tile
will read "delts: optimal/14 sets" on a routine where lateral-direct is 4 sets
— which is exactly the gap your monitoring log already flags ("total delts
22 sets/wk reads over, lateral-direct only 4"). Lateral-delt growth is your #1
most-aggressive transformation target (shoulder width 40.6→50cm). A volume tile
that silently green-ticks the parent slug while lateral is undertrained is
actively misleading on your most important goal.

**Three options:**
- **(a)** Extend MUSCLE_SLUGS taxonomy with `delts_lateral` / `_anterior` /
  `_posterior`. Proper, locks in structural commitment, requires re-tagging
  ~30-50 exercises, breaks historical comparison continuity. Cost: ~1-2 days
  extra. Reversibility: painful.
- **(b)** Exercise-tag layer: add `lateral_emphasis: true` on ~5 lateral-raise
  exercises, derive virtual `delts_lateral` row in projection only. No
  taxonomy migration. Cost: ~2 hours. Reversibility: trivial.
- **(c)** Ship without and explicitly mark "lateral delt specificity
  unavailable" in the tile footer.

**Recommendation: option (b).** All three voices converge.

**What we might be missing:** Lou-side preference for the proper taxonomy
fix even at higher cost (clean schema for 5 years > clean schema for v1).

→ **Recommendation: ACCEPT option (b) for v1, defer (a) to v1.1+ once (b) validates the framing.**

### UC3 — "Diagnostic only" framing — refine the boundary

**You said:** "Don't add prescription. Just show verdict and let me react."
(Plan line ~76, "Non-goals")

**Codex + Claude CEO voices say:** "Diagnostic only" is a fig leaf. You will
immediately ask "so what should I change?" The fix is NOT to add prescription
(that violates CLAUDE.md's "two coaches" ban). The fix is to be precise about
boundaries:
- `/feed` = adaptive coach from logged reality (PUSH/REDUCE/DELOAD).
- Routine builder = design-time constraint check from planned intent.
- Builder language: "glutes short by 6 effective sets," "hip abductors only
  touched 1 day," "delts at MRV at 2-day frequency" — *design feedback*, not
  weekly *prescription*.

This is the same code, different framing — but the framing matters because
"PUSH glutes +2" reads differently from "glutes are 6 sets short of optimal."

**What we might be missing:** You may have wanted "diagnostic only" specifically
to avoid auto-suggested edits ("would you like to add another glute exercise?").
The recommendation here is just framing change in copy, NOT adding edit suggestions.

→ **Recommendation: ACCEPT the framing refinement (still no edit suggestions, just clearer language).**

### UC4 — Comparison mode (current → projected) — TASTE call

**You said:** "Comparison mode" is a stretch goal in v1.

**Claude design says:** Diff IS the headline. Your literal motivating example
("if I add a 5th day, what changes?") only has a useful answer relative to the
current routine. Make every priority row a `before → after (Δ)` row.

**Codex design says:** Design the data shape now (reserve the delta slot in
the row component), ship absolute-only in v1, add diff UI in v1.1.

**Codex eng says:** Snapshot baseline at-mount, diff against it until save —
no new persistence layer, fits naturally.

**Three options:**
- **(A) Diff-as-default:** Every priority row shows `before → after (Δ)`.
  Empty baseline = absolute case. ~half day extra in PR3. Headline feature.
- **(B) Reserve-the-slot:** Component accepts before/after but renders
  absolute-only in v1. v1.1 adds diff UI when needed. ~no extra cost in PR3.
- **(C) Defer entirely:** Absolute only, diff in v1.1.

→ **Recommendation: (B)** — closest to your original "stretch" framing while
preserving the diff path. (A) is more complete but +half day; pick if you want
the headline experience now.

## TASTE DECISIONS (3) — close calls where reasonable people could disagree

### TD1 — Include PR4 (adherence delta on /feed) in v1?

**Codex CEO:** This is the actual strategic payoff, ship it in v1.
**Claude CEO:** Agrees as a +1 expansion (in blast radius).
**Androgodess PT:** Agrees, but ONLY if PR3 lands first and produces clean data
for ≥2 weeks of real use. The two-zones-side-by-side model is correct (NOT
multiplication).

**Tradeoff:**
- **Include in v1:** +1 day CC, ~4 days total. The closed-loop "planned
  vs delivered" shows up immediately. Risk: PR3's data quality might
  not hold under real use, you'd ship a noisy adherence verdict.
- **Defer to v1.1:** Cleaner v1, validates PR3 first, ship PR4 in 2 weeks.

→ **Recommendation: DEFER PR4 to v1.1.** PR3 needs real-use validation before
adherence comparison is meaningful, and v1 (PR2+PR1+PR3) is already a coherent
ship. (TASTE — both calls are defensible.)

### TD2 — RIR weighting tiers: 5 levels (Androgodess) or 3 levels (current)?

**Current code:** RIR 0-3 = 1.0, RIR 4 = 0.5, RIR 5+ = 0.0.

**Androgodess PT proposes:** RIR 0-3 = 1.0, RIR 4 = 0.5, RIR 5 = 0.25, RIR 6+ = 0.0.
Reason: "Deliberate pump finishers at RIR 5 aren't worthless — current cliff
is too punitive."

**Tradeoff:** The 0.25 tier costs nothing to add but creates a precedent for
finer-grained RIR weighting (should we have 0.7 at RIR 4? 0.4 at RIR 5? etc).
Either keep the 3-tier simplicity or add the 0.25 tier and lock it.

→ **Recommendation: ADD the RIR 5 = 0.25 tier.** Better signal preservation,
zero implementation cost. (TASTE — current is also defensible.)

### TD3 — Vision-aware MAV concrete numbers — accept Androgodess defaults?

**Androgodess proposed concrete vision overrides for your 4 priority muscles:**

| Muscle | sets_min | sets_max | freq_min | Source |
|---|---|---|---|---|
| Glutes | 14 | 26 | 3 | androgodess science: tolerates 24+; monitoring flag at <14 OR >24 |
| Lateral delts | 8 | 16 | 3 | 8 sets → 3.3-4.6% growth/8wk; spec is 12-16 |
| Hip abductors | 8 | 16 | 2 | Literature thin — flag `evidence: 'low'` |
| Core (rectus) | 8 | 16 | 3 | Plus separate cap on obliques `sets_max: 6` (waist target suppresses oblique hypertrophy) |

→ **Recommendation: ACCEPT these as the seeded vision overrides.** They're
grounded in the androgodess SKILL.md science cliff-notes and align with your
existing monitoring-protocol flag triggers. Override any specific value if
you have stronger conviction. (TASTE — these are inferences from PT-grade
sources, not gospel.)

## QUESTION FOR LOU (single AskUserQuestion in the morning)

I'm going to surface the 4 user challenges + 3 taste decisions as a single
batched question when you're awake. Default answers if you don't override:

```
UC1 schema change:           ACCEPT
UC2 lateral-delt option (b): ACCEPT
UC3 framing refinement:      ACCEPT
UC4 comparison mode:         (B) reserve the slot, ship absolute-only
TD1 PR4 in v1:               DEFER to v1.1
TD2 RIR 5-tier:              ADD the 0.25 tier
TD3 vision MAV defaults:     ACCEPT Androgodess numbers
```

If you reply "approve" or "ship it" or "defaults" — I'll execute exactly the
above. If you want to override any, just list which (e.g., "UC4=A, TD1=include").

## What happens after you answer

1. The plan stays in this branch's `docs/plans/routine-volume-fit-check.md`.
2. I'll execute PR2 first (pure module + conformance test) — lowest risk,
   ships independently. Probably ~2-3 hours of CC work.
3. Then PR1 (schema + sync wiring). I will pause before merging to confirm
   the sync round-trip test passes.
4. Then PR3 (projection + tile). I will pause for visual review of the tile
   on a real Capacitor build before considering it ready.
5. PR4 conditional on TD1.

Per your CLAUDE.md ship policy: each PR merges to main directly, no GitHub PR.
The branch lives only as long as PR2 is unmerged.

## Restore point

If you hate the whole thing, the rough plan still exists in the worktree's
git history at `git log docs/plans/routine-volume-fit-check.md`. Specifically
the first commit (`69dc14f` or similar — `git log --oneline`) has the rough
plan as you described it. Revert the worktree, throw away the branch, no
state lost.

## Voice consensus summary

| Voice | Phase | Verdict |
|---|---|---|
| Claude subagent | CEO | RESHAPE |
| Codex | CEO | RESHAPE |
| Androgodess PT | CEO | RESHAPE |
| Claude subagent | Design | RESHAPE |
| Codex | Design | (implicit RESHAPE via gap-list) |
| Claude subagent | Eng | RESHAPE |
| Codex | Eng | RESHAPE |
| Androgodess PT-eng | Eng | RESHAPE |

7-of-7 RESHAPE, 0-of-7 SHIP-AS-IS, 0-of-7 KILL.

The seed plan is good — bringing volume math to the routine builder is the
right move. The v1 spec needed work. Above is the worked-through v1.

— /autoplan, 2026-05-05 evening
