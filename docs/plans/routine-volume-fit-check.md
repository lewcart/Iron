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

(Populated by /autoplan auto-decisions.)

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|

---
