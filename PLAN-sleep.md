# Sleep Tracking Surface — Plan v2 (post-review)

Branch: `scratch/20260501-1347` (rename to `feat/sleep-surface` once accepted)
Single-user app (Lou only). Multi-user / migration-skew concerns relaxed.

> **North star:** Eight Sleep + Apple Watch already write every sleep sample into Apple Health. We have stage minutes per night flowing into `healthkit_daily`, but the wake/bed envelope and a coaching-grade rollup view are missing. v2 (this doc) absorbs Design + Eng + DX review findings — most importantly, the discovery that `SleepNight.start_at`/`end_at` already exist in the Capacitor payload, eliminating the proposed plugin change.

This plan went through Design + Eng + DX dual-voice reviews (Claude subagent + Codex). v2 incorporates their feedback. Sections that changed materially are marked **(rev)**.

---

## Premise (rev)

v1 framed this as "views/aggregation problem, not ingestion." Both Eng voices independently disagreed: backfill, nap filtering, multi-source dedup, and HK deletions are real ingestion concerns. v2's framing:

**Sleep tracking is a views problem riding on top of an under-exercised ingestion path.** The pipes carry the data. The pipes also have edge cases nobody has hit yet because nothing reads them carefully. This plan reads them carefully — and fixes the edges that surface.

Concretely:
- HealthKit pipes 6 stage metrics into `healthkit_daily` (migration 017). ✓ Working.
- The Capacitor plugin's `SleepNight` payload already includes `start_at` / `end_at` (epoch ms) and `deleted: string[]` (`src/lib/healthkit.ts:71-72, 135`). ✓ Available, but `healthSync.ts:148` drops `deleted` and the sync route doesn't persist `start_at`/`end_at` anywhere.
- `get_health_snapshot.sleep_last_night` returns last night's stage breakdown. ✓ Working.
- `get_health_series` accepts sleep metrics with day/week buckets. ✓ Working.
- `/wellbeing/page.tsx:80` still has a manual "sleep hours" text input — vestigial; HealthKit is the source of truth.

Gaps:
- **No persistence of bedtime/waketime per night** → no consistency score possible.
- **HK deletions for sleep are silently dropped** → stale rows after edit/delete in iOS Health.
- **Naps pollute aggregates** if/when we start treating each `SleepNight` as a "main night."
- **Eight Sleep + Apple Watch can both write a session** for the same physical night with different HK sample IDs.
- **No /sleep UI surface.** Only the manual `/wellbeing` input.
- **No window-aggregate MCP tool.** Coaching agents must call `get_health_series` six times for "how was last week's sleep?"

---

## What already exists (reuse list, rev)

| Need | Existing piece | Where |
|---|---|---|
| Sleep stage minutes per night | `healthkit_daily` rows for `sleep_*` metrics | migration 017 |
| **Per-night start_at / end_at (epoch ms)** | `SleepNight.start_at`, `end_at` in plugin payload | `src/lib/healthkit.ts:71-72` ✓ already there |
| **Sleep deletions from HK** | `fetchSleepNights` returns `deleted: string[]` | `src/lib/healthkit.ts:135` ✓ already there |
| Sleep sync via anchor | `HKAnchoredObjectQuery` via `last_anchor` | `src/features/health/healthSync.ts:142-211` |
| Per-night detail (last night) | `get_health_snapshot.sleep_last_night` | `src/lib/mcp-tools.ts:1517-1532` |
| Trend per metric | `get_health_series(metric, from, to, bucket)` | `src/lib/mcp-tools.ts:2845-2862` |
| HRV daily | `healthkit_daily.metric='hrv'` | migration 017 |
| `not_connected` error shape | `notConnectedResponse(status)` | `src/lib/mcp-tools.ts` |
| HRV branch shape | `get_health_snapshot.hrv` (avg, baseline_30d, delta_pct, n) | `src/lib/mcp-tools.ts` |
| Charts | `recharts@3.8.0` | already installed |
| iOS list styles + Sheet primitive | `.ios-section`, `<Sheet>`, etc. | `globals.css`, `src/components/ui/Sheet.tsx` |

**The big v1→v2 simplification:** v1 said "extend the Capacitor plugin to emit `bedtime_at`/`waketime_at`" (~Native code change, App Store rebuild, TestFlight). v2: those fields already exist as `start_at`/`end_at`. Native code untouched. The plan's scope contracts to TypeScript-only.

---

## NOT in scope this round (rev)

- **Eight Sleep direct API integration** — Eight Sleep already writes to HealthKit.
- **Sleep coaching prompts / nudges** — display first, intervene later.
- **Apple Watch sleep config UI** — happens in iOS Health app.
- **Hypnogram-grade UI** (minute-by-minute stage transitions) — possible future, not now. The stage stack here is *proportional*, not temporal (see Stage viz).
- **Naps as first-class** — they're filtered out of the main-night dataset (see ingestion).
- **Writeback to HealthKit** — read-only.
- **Local-first / Dexie mirror** — sleep data is server-authoritative. `/sleep` is online-only with cache + offline banner.

---

## Data model — migration 025 (rev)

```sql
-- 025_healthkit_sleep_nights.sql

-- One row per night per source. Source-aware so multi-source nights
-- (Eight Sleep + Apple Watch) coexist; the UI picks a canonical per night.
CREATE TABLE IF NOT EXISTS healthkit_sleep_nights (
  wake_date DATE NOT NULL,                    -- date of waketime in Europe/London
  source_key TEXT NOT NULL,                   -- 'apple_watch' | 'eight_sleep' | 'unknown'
                                              -- derived from source_bundle_id;
                                              -- mapping table inline in TS
  start_at TIMESTAMPTZ,                       -- in-bed onset (NULLABLE — old samples may lack)
  end_at TIMESTAMPTZ,                         -- in-bed end   (NULLABLE — old samples may lack)
  asleep_min NUMERIC NOT NULL DEFAULT 0,
  rem_min NUMERIC NOT NULL DEFAULT 0,
  deep_min NUMERIC NOT NULL DEFAULT 0,
  core_min NUMERIC NOT NULL DEFAULT 0,
  awake_min NUMERIC NOT NULL DEFAULT 0,
  in_bed_min NUMERIC NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 1,    -- # underlying HK samples (data quality signal)
  is_main BOOLEAN NOT NULL DEFAULT TRUE,      -- false = nap (filtered out by default)
  source_bundle_id TEXT,                      -- raw bundle id, kept for forensics
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wake_date, source_key)
);

CREATE INDEX IF NOT EXISTS idx_healthkit_sleep_nights_wake_date
  ON healthkit_sleep_nights(wake_date DESC);
CREATE INDEX IF NOT EXISTS idx_healthkit_sleep_nights_main
  ON healthkit_sleep_nights(is_main, wake_date DESC) WHERE is_main = TRUE;

DROP TRIGGER IF EXISTS healthkit_sleep_nights_updated_at ON healthkit_sleep_nights;
CREATE TRIGGER healthkit_sleep_nights_updated_at
  BEFORE UPDATE ON healthkit_sleep_nights
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

**Key changes from v1:**
- PK is `(wake_date, source_key)`, not `hk_uuid`. Native already merges multiple HK samples into one derived `SleepNight` per source; there is no canonical "in-bed envelope UUID" to use as PK.
- `start_at` / `end_at` are NULLABLE. Historical Eight Sleep/manual entries may lack the envelope.
- `is_main` filters naps. A row qualifies as main when `in_bed_min >= 240` (4h floor) AND `end_at` (waketime) lands ≥ 04:00 Europe/London. Otherwise `false`. Aggregates and consistency score read `WHERE is_main = TRUE`.
- `sample_count` carried through from native (already merges samples per night).
- `source_key` is enum-like — `'apple_watch'`, `'eight_sleep'`, `'unknown'` — derived from `source_bundle_id` via a small TS map. Stable, indexable, queryable.

### Source-of-truth note (rev)

`healthkit_daily.sleep_*` rows continue to exist (the daily aggregate per stage). `healthkit_sleep_nights` is the **night-level** record. They're not duplicates: daily rolls up across all sessions and sources for backwards-compat with `get_health_snapshot.sleep_last_night`; nights gives per-source detail and main-vs-nap separation.

To keep them honest, a unit test asserts: for any wake_date, `SUM(asleep_min WHERE source_key=canonical AND is_main) == healthkit_daily.value_sum WHERE metric='sleep_asleep' AND date=wake_date`. If they drift, that's a sync bug.

---

## Sync changes (rev)

`src/app/api/healthkit/sync/route.ts` writes both `healthkit_daily` (existing) and `healthkit_sleep_nights` (new) from the same `SleepNight[]` payload. Three new behaviors:

1. **Persist `start_at` / `end_at`** — already in payload, just persisted now.
2. **Process `deleted: string[]`** — currently dropped at `healthSync.ts:148`. Carry through; sync route deletes by `(wake_date, source_key)` for any night derived from a deleted sample. Edge: native sample UUIDs don't directly map to our row PK; deletion handling re-materializes the affected `wake_date` from remaining samples instead. (Documented in failure modes.)
3. **Backfill on first deploy** — migration 025 includes a guarded one-shot:
   ```sql
   -- end of 023:
   UPDATE healthkit_sync_state SET last_anchor = NULL WHERE metric = 'sleep';
   ```
   Next sync re-pulls the last 90 days of sleep nights. After that, anchor flow resumes normally. (Without this, the table is empty for ~90 days post-deploy.)

### Source mapping (TS, near the sync route)

```ts
function deriveSourceKey(bundleId: string | null | undefined): 'apple_watch' | 'eight_sleep' | 'unknown' {
  if (!bundleId) return 'unknown';
  const b = bundleId.toLowerCase();
  if (b.includes('apple.health')) return 'apple_watch';   // com.apple.health for HK
  if (b.includes('eightsleep'))   return 'eight_sleep';
  return 'unknown';
}
```

### Canonical source per night

When both Eight Sleep AND Apple Watch wrote a night, the UI / aggregates pick the canonical row. Rule: **`MAX(in_bed_min)` wins.** Eight Sleep typically captures more total time (full in-bed envelope) vs the Watch's stage-detection windows. If tied, prefer `eight_sleep` (more accurate for Lou's setup).

`get_health_sleep_summary` exposes `sources: string[]` listing all source keys seen in the window for transparency.

---

## Consistency score (rev — math fixed)

v1's `tzMinsOfDay` had two real bugs:
1. Used runtime `getHours()` (server is in some other TZ; user is Europe/London).
2. Hard-split at noon, breaking redeyes/shift sleep.
3. Score formula `100 - 2*(stdev_bed + stdev_wake)/2` simplified to `100 - (stdev_bed + stdev_wake)`. Sloppy.

v2 uses **circular statistics** for clock times (the standard way to do this):

```ts
function circularStats(timestamps: Date[]) {
  // Convert each clock time to an angle on the 24h circle.
  // Use Europe/London local hours/minutes via Intl, not getHours().
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const angles = timestamps.map(d => {
    const [hh, mm] = fmt.format(d).split(':').map(Number);
    const minutes = hh * 60 + mm;
    return (minutes / 1440) * 2 * Math.PI;
  });
  const meanSin = angles.reduce((a, θ) => a + Math.sin(θ), 0) / angles.length;
  const meanCos = angles.reduce((a, θ) => a + Math.cos(θ), 0) / angles.length;
  const meanAngle = Math.atan2(meanSin, meanCos);
  // Circular stdev in minutes (von Mises approximation).
  const R = Math.sqrt(meanSin ** 2 + meanCos ** 2);
  const stdevRad = Math.sqrt(-2 * Math.log(R));
  const stdevMin = (stdevRad / (2 * Math.PI)) * 1440;
  return {
    mean_minutes: ((meanAngle / (2 * Math.PI)) * 1440 + 1440) % 1440,
    stdev_min: stdevMin,
  };
}

function consistencyScore(nights: { start_at: Date; end_at: Date }[]) {
  if (nights.length < 5) return null; // 3 was too low; 5 = a working week
  const bed = circularStats(nights.map(n => n.start_at));
  const wake = circularStats(nights.map(n => n.end_at));
  const avgStdev = (bed.stdev_min + wake.stdev_min) / 2;
  // Linear penalty: 0 stdev → 100; 30min stdev → 70; 60min → 40.
  const score = Math.max(0, Math.min(100, 100 - avgStdev));
  return {
    score: Math.round(score),
    bedtime_stdev_min: Math.round(bed.stdev_min),
    waketime_stdev_min: Math.round(wake.stdev_min),
    typical_bedtime: minsToHHMM(bed.mean_minutes),
    typical_waketime: minsToHHMM(wake.mean_minutes),
  };
}
```

Score interpretation:
- **90+** = stdev within ~10min — exceptional
- **75-89** = within ~25min — solid
- **60-74** = within ~40min — drifting
- **<60** = >40min — erratic

n threshold raised 3→5 (a working week) per Eng review — 3 nights of stdev is statistically meaningless. Below 5, return `null` and the UI shows "Need 5+ nights."

---

## UI — `/sleep` page (rev — recovery-first hierarchy)

v1 led with "7h 42m last night + stage stack." Both Design voices flagged: **the user's first question is "did I recover well?"** not "what stages did I sleep through?" v2 reorders.

```
┌─────────────────────────────────────────┐
│  ‹  Sleep                         •••   │  ← iOS nav title; • = source/range menu
├─────────────────────────────────────────┤
│  ╔═════════════════════════════════════╗│
│  ║   Solid                             ║│  ← One-word verdict (lede)
│  ║   7h 42m last night                 ║│  ← total
│  ║   ▸ Deep 1h 12m  ▸ REM 1h 38m       ║│  ← key signals only (tap → detail sheet)
│  ║   ▸ HRV 52ms  +3% vs 30-day         ║│  ← recovery signal pulled forward
│  ╚═════════════════════════════════════╝│
│                                          │
│   This week                              │
│  ┌─────────────────────────────────────┐│
│  │  Avg sleep      7h 28m              ││
│  │  Consistency    Solid  ⓘ            ││  ← label only; tap → "bedtime ±18m"
│  │  Avg deep       1h 02m  (13.8%)     ││
│  │  Avg REM        1h 24m  (18.7%)     ││
│  └─────────────────────────────────────┘│
│                                          │
│  [7-day stacked bars — sleep stages]    │  ← chart 1: sleep
│  [7-day sparkline — HRV]                │  ← chart 2: HRV (separate, not overlay)
│                                          │
│  [Day] [Week] [Month] [3-Month]         │  ← range tabs (segmented)
│  Last synced 06:14 · Eight Sleep        │  ← provenance footer
└─────────────────────────────────────────┘
```

### Hierarchy decisions

- **Lede is the verdict.** "Solid / Light / Restless" computed from deep+REM thresholds, not the raw number. Total sits beneath. Stage detail is one tap away.
- **HRV pulled into the lede card.** Recovery is sleep + HRV; separating them makes the user navigate to compose the picture.
- **Consistency = label, not number.** "Solid" with an info-tap revealing "bedtime ±18m, waketime ±12m." Per Design review: "Score 78" reads as a B-grade, which is wrong cognitive frame.
- **Charts split, not overlaid.** Stacked sleep stages + HRV sparkline as two separate elements. At 375px, dual-axis is hostile (both Design voices flagged).
- **Range tabs, not nested cards.** Day = last night. Week / Month / 3-Month = aggregates. One mental model that scales.
- **Stage stack = proportional, NOT temporal.** Block bars labeled "Deep / REM / Core / Awake" left-to-right read as a hypnogram. We don't have minute-by-minute samples (yet). The viz uses `<MacroRing>` segments OR a labeled donut to make the proportion explicit, removing the temporal misread. (Stage Bar option in Open taste decisions.)

### Bad-night handling (rev — Design review #3)

When last night was <5h or sparse-stage, the verdict band adapts:
- **Light night.** Your 7-day average is still 7h 22m. ←lede swap
- **Restless start, solid recovery.** Surface a 7-day "best night" callout below.

The page should not punish a bad morning with a wall of red. The 7-day baseline is the friend; show it.

### State matrix (rev — copy + placement specified)

| State | Trigger | UI |
|---|---|---|
| Loading | Initial fetch | Skeleton (3 cards: lede / week / chart). 600ms minimum to avoid flash. |
| Last night present | Row exists for `wake_date = yesterday` (Europe/London) | Full lede card |
| Last night missing | No row | Lede shows "No data for last night" + "Last logged: 2 days ago" with "View last logged ›" link |
| Partial last night | `start_at` null OR `asleep_min == 0` | Lede shows total only; stage row says "Stage detail unavailable" with ⓘ tap → "Apple Watch was off-wrist most of the night" |
| HK sync in progress | sync_state has fresh `last_sync_at` (<60s) but rows haven't updated | Top inline banner: "Syncing sleep…" (auto-clears) |
| HK disconnected | `getHealthKitStatus().status !== 'connected'` | Replace lede with "HealthKit isn't connected" + button "Connect" → /settings |
| Window too sparse | <5 main nights in range | Consistency row: "Need 5+ nights" greyed out; averages still compute over what exists |
| HRV missing | No `hrv` rows in window | Hide HRV row in lede + averages; no banner (not an error, just unavailable) |
| Offline | navigator.onLine = false | Cached values + amber banner "Offline — showing cached data from $time" |
| TZ change in window | Latest night's local TZ differs from earliest's | Bronze banner: "Travel detected — consistency score paused" + the score itself shown as "—" |

### Accessibility (rev — Codex flagged this absence)

- All 4 range tabs are `<button>` semantic, 44px tap targets, focused state visible.
- Stage colors come with text equivalents (every stage row has both color block AND label).
- Charts have ARIA `role="img"` with summary text alternative ("7-day sleep totals: Mon 7h 22m, Tue 6h 48m, ...").
- WCAG AA contrast for stage colors against background (deep-blue meeting 4.5:1, etc).
- Dynamic Type-safe rows (no fixed pixel font sizes for content rows).
- `prefers-reduced-motion` honored — chart entry transitions off when set.

### Component split

```
src/app/sleep/
  page.tsx                     # ~120 lines, reads ?range= from searchParams
  LedeCard.tsx                 # verdict + total + key signals + HRV row
  WeeklyAveragesCard.tsx       # 4 stat rows
  StageStackChart.tsx          # recharts BarChart, stacked, 7 days
  HrvSparkline.tsx             # tiny LineChart, separate from stage chart
  RangeTabs.tsx                # Day / Week / Month / 3-Month
  StageRow.tsx                 # one labeled row, color + name + min + pct
  ProvenanceFooter.tsx         # "Last synced HH:MM · Source"

src/components/ui/
  StageBar.tsx                 # NEW — proportional segment bar (NOT temporal)
                               # reused inside LedeCard expanded sheet + StageStackChart cells
```

### `/wellbeing` reconciliation (rev — Design review #10)

The manual `sleep_hours` input on `/wellbeing` is removed. To preserve discoverability per Design review, we add a **deep-link sleep row** to `/wellbeing` showing last night's total + verdict, linking to `/sleep`:

```
─────── Sleep ─────────────────────────
Last night: 7h 42m · Solid       ›
  (tap → /sleep)
```

`wellbeing_logs.sleep_hours` column is preserved (don't drop, just hide the input).

---

## MCP tool — `get_health_sleep_summary` (rev — renamed)

v1: `get_sleep_summary`. v2: **`get_health_sleep_summary`** to match the `get_health_*` family (`get_health_snapshot`, `get_health_series`, `get_health_workouts`). Both DX voices flagged the original name as breaking the namespace pattern.

```ts
{
  name: 'get_health_sleep_summary',
  description:
    'Returns a sleep + recovery rollup for a date range. Combines per-stage averages, consistency score (circular stdev of bedtime/waketime in minutes, n>=5 required), HRV trend, and per-night detail. Use for "how was last week\'s sleep?" or "compare this week vs last." For a single night, use get_health_snapshot.sleep_last_night. For one metric trend (e.g., HRV alone), use get_health_series.',
  inputSchema: {
    type: 'object',
    properties: {
      start_date:  { type: 'string', description: 'YYYY-MM-DD inclusive (Europe/London). Optional if window_days set.' },
      end_date:    { type: 'string', description: 'YYYY-MM-DD inclusive; defaults to today.' },
      window_days: { type: 'number', description: 'Alternative to start_date. Default 7. Max 90.' },
      fields:      {
        type: 'array',
        items: { type: 'string', enum: ['range','averages','consistency','hrv','nights','data_quality'] },
        description: 'Optional projection. Omit for full result. Use to drop nights[] on long windows.',
      },
    },
  },
}
```

### Argument changes from v1

- **`include_nights: boolean` → `fields: string[]`** projection — matches `get_health_snapshot`'s `fields` pattern. Agent can ask for just `consistency` for a one-line answer (~30 tokens).
- **`window_days` alternative** — for "last week's sleep" the agent doesn't need to compute `start_date` from today. Default 7. If both `start_date` and `window_days` are given, `start_date` wins.
- **>90d input** → silently capped at 90 + `data_quality.window_capped: true` (Codex prefers an error; Claude DX prefers cap. Auto-decision: cap, because agents don't always paginate well — **flagged as taste**).

### Response shape (rev)

```ts
{
  range: {
    start_date: 'YYYY-MM-DD',
    end_date:   'YYYY-MM-DD',
    n_nights:   number,
    timezone:   'Europe/London',
  },
  averages: {              // null if n_nights == 0
    asleep_min,            // main nights only
    in_bed_min,
    deep_min, deep_pct,
    rem_min, rem_pct,
    core_min, core_pct,
    awake_min, awake_pct,
    sleep_efficiency_pct,
  } | null,
  consistency: {           // null if n_nights < 5
    score: 0-100,
    bedtime_stdev_min,
    waketime_stdev_min,
    typical_bedtime: 'HH:MM',
    typical_waketime: 'HH:MM',
  } | null,
  hrv: {                   // SAME shape as get_health_snapshot.hrv — type lifted
    avg_ms, baseline_30d_ms, delta_pct, n_days,
  } | null,
  nights: SleepNight[] | null,   // present if 'nights' in fields, else omitted
  data_quality: {
    missing_sleep_dates:    string[],   // dates with no row at all
    missing_envelope_dates: string[],   // dates with row but null start_at/end_at (consistency-blocking)
    sources:                string[],   // distinct source_keys seen
    window_capped:          boolean,    // true if input >90d
  },
}
```

### Errors (rev — was missing in v1)

Match the `get_health_snapshot` `not_connected` shape and add range validators:

```ts
// not connected
{ status: 'not_connected', reason: '...', message: '...' }

// invalid range
{ status: 'invalid_range', message: 'start_date must be ≤ end_date',         hint: 'Pass YYYY-MM-DD strings.' }
{ status: 'invalid_range', message: 'end_date cannot be in the future',      hint: 'Use today or earlier.' }
{ status: 'invalid_input', message: 'window_days must be 1..90',             hint: 'Default 7.' }
```

### Cross-references in tool descriptions (rev — DX review)

Append to the existing `get_health_snapshot` description:
> "For multi-day sleep rollups, see `get_health_sleep_summary`."

Append to the existing `get_health_series` description:
> "For sleep, prefer `get_health_sleep_summary` — returns all stages + consistency + HRV in one call."

### CLAUDE.md "Sleep workflow" stanza (rev — DX review)

Append to `CLAUDE.md` (parallel to the nutrition workflow already there):

```markdown
## Sleep workflow (for MCP agents)

Date conventions: same as nutrition (`YYYY-MM-DD` Europe/London for date params; ISO-8601 with offset for `*_at`).

Common workflows:
- **"How was last night?"** → `get_health_snapshot({ fields: ['sleep_last_night','hrv'] })`
- **"How was last week's sleep?"** → `get_health_sleep_summary({ window_days: 7 })`
- **"Compare this week to last"** → two `get_health_sleep_summary` calls with `start_date` shifted
- **"HRV trend only"** → `get_health_series({ metric: 'hrv', from })` (still the right tool for single-metric trends)

Tool selection:
- `get_health_snapshot` = current state, last night
- `get_health_sleep_summary` = window aggregate + consistency
- `get_health_series` = one metric, trend chart
```

---

## Implementation order (rev — Step 1 deleted)

| Step | What | Why this order |
|---|---|---|
| 1 ~~Capacitor plugin~~ | DELETED — `start_at`/`end_at` already in payload (`src/lib/healthkit.ts:71`) | n/a |
| 1 | Migration 025 + sync route persistence (start_at, end_at, sources, is_main filter, deletion handler, anchor reset for backfill) | Schema + ingest before consumers |
| 2 | `get_health_sleep_summary` MCP tool + cross-reference edits to existing tool descriptions | Server-side, no UI dependency |
| 3 | Page primitives: `StageBar`, `RangeTabs`, layout shell | Load-bearing |
| 4 | `LedeCard` (verdict + total + key signals + HRV inline) reads from `healthkit_sleep_nights` (canonical row) | First visible win |
| 5 | `WeeklyAveragesCard` calls `get_health_sleep_summary` via internal API route | Reuses tool |
| 6 | `StageStackChart` (7-day stacked bars, gaps for missing nights) | Trend viz |
| 7 | `HrvSparkline` separate chart | Per Design review — no dual-axis |
| 8 | Day / Week / Month / 3-Month tabs with distinct viz per range (per Design review #8) | Cohesion |
| 9 | `/wellbeing` cleanup: remove `<input sleep_hours>`, add deep-link sleep row | Cleanup |
| 10 | `CLAUDE.md` Sleep workflow stanza + cross-refs in tool descriptions | Agent discoverability |

Steps 1-5 are MVP. 6-10 are polish.

---

## Tests (rev — added the dangerous ones)

| Codepath | Test | Type |
|---|---|---|
| Migration 025 forward + idempotent re-run | Apply twice; second is no-op | integration |
| Migration 025 anchor reset | After migration, `last_anchor` for sleep is NULL | integration |
| Sleep nights upsert by (wake_date, source_key) | Same source re-syncs → updates; different source same date → second row | integration |
| `is_main` filter — short nap | 30-min in_bed + 02:00 end → `is_main = false` | unit |
| `is_main` filter — main night | 7h in_bed + 07:00 end → `is_main = true` | unit |
| Cross-midnight nap pollution | Nap with wake_date = today doesn't poison consistency stdev | integration |
| Multi-source same night | Eight Sleep + Apple Watch both write → 2 rows; `MAX(in_bed_min)` picks canonical | integration |
| HK deletion of a sleep sample | Sync re-materializes affected wake_date; stale row removed | integration |
| Backfill on first deploy | Migration 025 → next sync pulls last 90 days into nights table | integration |
| Sync ignores `deleted` array bug | Pre-fix `healthSync.ts:148` test should fail; post-fix passes | regression |
| `get_health_sleep_summary` empty window | `range.n_nights: 0`, `averages: null`, `consistency: null` | unit |
| `get_health_sleep_summary` 4 nights | `consistency: null` (<5 threshold), averages = the 4 nights | unit |
| `get_health_sleep_summary` 7 nights | All branches populated | integration |
| `fields` projection | Pass `fields:['consistency']` → only consistency + range returned | unit |
| `window_days` alt | Pass `window_days:7` no start_date → range computed from today | unit |
| >90d input | `window_capped: true`, range capped at 90 | unit |
| Future end_date | Returns `{status:'invalid_range', ...}` | unit |
| start > end | Returns `{status:'invalid_range', ...}` | unit |
| Not connected | Returns `{status:'not_connected', ...}` matching snapshot shape | unit |
| Consistency circular stats wrap midnight | Bedtimes [23:55, 00:05, 23:50] → stdev ~5min | unit |
| Consistency uses Europe/London not getHours() | Server in Brisbane TZ, bedtime 23:00 London → still 23:00 minutes | unit |
| Consistency 5-night threshold | 4 nights → null; 5 → score | unit |
| Score formula example | Bed stdev 14m + wake stdev 14m → score 86 (matches doc) | unit |
| HRV missing | `hrv: null`, sleep averages still returned | unit |
| Daily aggregate matches nightly canonical | `SUM(asleep_min canonical+main)` == `healthkit_daily.sleep_asleep` for the date | integration |
| `LedeCard` no data | "No data for last night" + last-logged link | component |
| `LedeCard` partial (no stages) | Total only, "Stage detail unavailable" row | component |
| `LedeCard` bad night | Light-night verdict shown, 7-day baseline surfaced | component |
| `WeeklyAveragesCard` consistency null | "Need 5+ nights" placeholder | component |
| `StageStackChart` missing nights | Dashed-outline column with "—", not zero-height | component |
| Travel banner | TZ change in window → "Travel detected — consistency paused" | component |
| Range tabs accessibility | All 4 are buttons, 44px, focused state visible, ARIA labeled | component |
| Stage chart screen-reader summary | Has `role="img"` + alt summary text | component |
| `/wellbeing` manual input removed | No regression on logs page; deep-link row visible | regression |
| DST spring-forward | Window spanning the 23-hour day computes consistency without crash | integration |
| 2am snapshot edge | At 02:00 local, "last night" = wake_date today, snapshot returns it | regression |

---

## Failure modes registry (rev)

| # | Failure | Severity | Likelihood | Plan addresses |
|---|---|---|---|---|
| 1 | Old samples lack start_at/end_at | high | medium | NULLABLE columns + consistency falls back to null |
| 2 | Eight Sleep + Apple Watch double-write | medium | high | (wake_date, source_key) PK; canonical = MAX(in_bed_min); sources[] in response |
| 3 | Naps pollute aggregates | high | high | `is_main` filter (in_bed≥4h AND end≥04:00); aggregates `WHERE is_main` |
| 4 | HK deletes a sleep sample | high | medium | `deleted` array carried through sync; affected wake_date re-materialized |
| 5 | Backfill empty post-deploy | high | certain | Anchor reset in migration 025 → next sync pulls 90d |
| 6 | Server TZ ≠ Europe/London → wrong clock minutes | high | high | Circular stats use `Intl.DateTimeFormat({timeZone:'Europe/London'})` |
| 7 | DST 23h day breaks consistency math | medium | low | Circular stats unaffected (works on angles); test added |
| 8 | TZ travel produces erratic consistency | low | low | Travel-banner UX; score paused |
| 9 | Daily and nightly aggregates drift | medium | medium | Cross-check unit test on canonical sum |
| 10 | `>90d` window crashes | medium | low | Capped server-side + `window_capped: true` |
| 11 | Naming inconsistency between snapshot and summary HRV | low | low | Lift HRV type from snapshot; one source |
| 12 | Migration 025 rollback corrupts existing health data | critical | low | New table only; rollback = `DROP TABLE healthkit_sleep_nights` |
| 13 | Stage stack viz misread as hypnogram | medium | medium | `<StageBar>` proportional, never temporal; design review caught |
| 14 | Manual `sleep_hours` removal breaks wellbeing logs | low | low | Column kept; UI only removed; regression test |
| 15 | Score "78" reads as B-grade | medium | high | UI shows label only; number behind ⓘ tap |
| 16 | `include_nights` style inconsistency | low | certain | Replaced with `fields[]` projection (matches snapshot) |
| 17 | Agents read `get_health_series` for sleep, miss summary | medium | medium | Cross-ref in series description; CLAUDE.md stanza |
| 18 | Last night card always-on stale at 30h | low | low | Provenance footer "last synced HH:MM" + stale banner if >24h |

---

## Open taste decisions (gate)

These are surfaced for Lou's call. v2 has a recommendation on each.

1. **Stage stack viz: `<StageBar>` proportional vs full hypnogram.** Hypnogram is more honest and emotionally resonant (Design review subagent #7) but requires raw HK samples (we don't fetch them today). Proportional bar reuses the data we have. Recommended: **proportional now, hypnogram in a follow-up issue** if we add sample-level fetching.
2. **Top-level `/sleep` vs `/recovery` route.** Codex Eng flagged: the page is sleep + HRV + readiness — that's "recovery." Lou's prior chat said "sleep tracking." Recommended: **`/sleep`** — single source-of-truth metric (sleep) is what Lou actually asked for; HRV is supportive context, not a co-equal pillar.
3. **Manual sleep input on `/wellbeing`: remove + deep-link row.** Recommended: **remove the input, add the deep-link row**. Eight Sleep is reliable; the input was vestigial.
4. **>90d window: cap silently vs error.** Recommended: **cap silently with `data_quality.window_capped: true`**. Agents handle truncation poorly; safer to deliver partial data.
5. **Consistency n threshold: 5 vs 7.** Recommended: **5** (a working week minus 2 missed nights).
6. **`fields[]` projection vs `detail: 'summary'|'nights'` enum.** DX subagent prefers `fields[]` (matches snapshot); Codex DX prefers `detail` enum (cleaner mental model). Recommended: **`fields[]`** for consistency with `get_health_snapshot`.
7. **Score visibility: hidden number + label vs both visible.** Recommended: **hidden number**. "78" reads as a B-grade.
8. **Range tabs include "Day" or only Week/Month/3-Month?** Day = last night, basically the lede card alone. Recommended: **include Day** so the page has a primary-control mental model that scales (Design review #6).

---

## User challenge (gate)

**Both Eng voices independently challenged your stated framing.**

You said (in the prior chat): "this is a views/aggregation problem, not an ingestion problem."

Both models recommend: **add ingestion-side fixes to scope.** Specifically: process HK deletions, filter naps with `is_main`, dedup multi-source nights, anchor-reset for backfill, fix `getHours()` → Europe/London.

Why: the pipes carry the data, but they have edges nobody hit before because nothing read them carefully. Skipping the ingestion fixes means the views show wrong numbers (consistency null for 90d post-deploy, naps polluting averages, multi-source double-counting).

What we might be missing: you may already know about these gaps and have explicitly chosen to ship views first and fix ingestion later. That's a valid sequencing call, but the plan should say so explicitly rather than imply ingestion is "done."

If we're wrong (and views-first IS the right call), the cost is: consistency score is null for 90 days after deploy and the weekly view shows occasional 14h "sleep" days when you nap. Recoverable, but visible to you.

**Default in v2: ingestion fixes are in scope** (this is the recommended state of the plan). To override, say "views-first only" and we'll move steps 1's ingestion fixes (deletions, dedup, is_main, backfill) to a phase-2 PR.

---

## Design dual voices — consensus table

```
DESIGN DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════════════
  Dimension                            Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────────
  1. Information hierarchy correct?    NO       NO     CONFIRMED — flip
  2. Missing states designed?          NO       NO     CONFIRMED — copy/placement added
  3. Emotional arc / bad-night UX?     NO(crit) —      Claude only — added
  4. Specificity adequate?             NO       NO     CONFIRMED — concrete copy added
  5. Score readable?                   NO       —      Claude only — label-only
  6. Last-night vs week tension?       NO       —      Claude only — range tabs primary
  7. Stage viz honest?                 NO       NO     CONFIRMED — proportional, not temporal
  8. Mobile / 375px works?             NO       NO     CONFIRMED — split charts
  9. Accessibility addressed?          —        NO     Codex only — section added
  10. /wellbeing cleanup complete?     NO       NO     CONFIRMED — deep-link row added
═══════════════════════════════════════════════════════════════════════
CONFIRMED = both flagged. Single voice = flagged regardless. 7/10 confirmed, 3/10 single-voice.
```

## Eng dual voices — consensus table

```
ENG DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════════════
  Dimension                            Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────────
  1. Architecture sound?               PARTIAL PARTIAL CONFIRMED — table OK, PK wrong
  2. SleepNight fields recognized?     NO       NO     CONFIRMED — already exist!
  3. Backfill story?                   NO       —      Claude only — anchor reset added
  4. HK deletions handled?             —        NO     Codex only — added
  5. Nap filtering?                    NO       —      Claude only — is_main added
  6. Multi-source dedup?               NO       NO     CONFIRMED — sources jsonb + canonical
  7. Consistency math correct?         NO       NO     CONFIRMED — circular stats + TZ fix
  8. Score formula matches example?    —        NO     Codex only — fixed
  9. Tests cover edges?                NO       —      Claude only — added DST/2am/naps
  10. Local-first / Dexie story?       NO       —      Claude only — online-only, banner
═══════════════════════════════════════════════════════════════════════
CONFIRMED = both flagged. 5/10 confirmed, 5/10 single-voice.
The "SleepNight fields already exist" finding is the biggest single simplification in v2.
```

## DX dual voices — consensus table

```
DX DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════════════
  Dimension                            Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────────
  1. Naming fits get_health_* family?  NO       NO     CONFIRMED — renamed
  2. include_nights vs fields shape?   NO       —      Claude only — fields[]
  3. Error shape specified?            NO       NO     CONFIRMED — added
  4. Cross-refs to other tools?        NO       NO     CONFIRMED — added
  5. window_days alt for "last week"?  NO       —      Claude only — added
  6. HRV shape consistent?             NO       NO     CONFIRMED — type lifted
  7. Composition with snapshot?        NO       NO     CONFIRMED — boundary documented
  8. CLAUDE.md stanza adequate?        NO       NO     CONFIRMED — full workflow added
  9. Token cost claim accurate?        NO       —      Claude only — fixed
  10. Default include_nights right?    NO       NO     CONFIRMED — fields[] sidesteps
═══════════════════════════════════════════════════════════════════════
CONFIRMED = both flagged. 8/10 confirmed, 2/10 single-voice.
The DX surface needed the most renaming/consistency work.
```

---

## Decision audit trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | Eng | Drop Capacitor plugin step (use existing start_at/end_at) | Mechanical | P3 pragmatic | Code already provides; ~50 LOC saved |
| 2 | Eng | PK = (wake_date, source_key) not hk_uuid | Mechanical | P5 explicit | Native already groups samples; no canonical envelope UUID |
| 3 | Eng | start_at/end_at NULLABLE | Mechanical | P1 completeness | Historical samples lack envelope |
| 4 | Eng | `is_main` filter for naps | Auto | P1 completeness | Otherwise pollutes consistency + averages |
| 5 | Eng | Carry HK `deleted` array; re-materialize wake_date | Auto | P1 completeness | Stale rows after iOS Health edits |
| 6 | Eng | Migration 025 anchor reset for backfill | Auto | P1 completeness | Without it, table empty 90d post-deploy |
| 7 | Eng | Circular statistics for consistency | Auto | P1 completeness | Linear math broken at midnight + redeyes |
| 8 | Eng | Europe/London via Intl.DateTimeFormat | Auto | P5 explicit | getHours() = runtime TZ; wrong |
| 9 | Eng | n threshold 3 → 5 | Auto | P5 explicit | 3 is statistically meaningless |
| 10 | Eng | Score formula: avg of stdevs (not sum) | Auto | P5 explicit | Match example "78" |
| 11 | Eng | sources jsonb + sample_count + canonical = MAX(in_bed) | Auto | P1 completeness | Multi-source dedup |
| 12 | Eng | Cross-check unit test (daily ≡ canonical+main) | Auto | P1 completeness | Drift detection |
| 13 | Eng | Online-only, no Dexie mirror | Auto | P3 pragmatic | Server-authoritative HK data; no offline write path needed |
| 14 | Design | Lede = verdict word, not stage stack | Auto | P1 completeness | Recovery-first hierarchy |
| 15 | Design | HRV inline in lede card | Auto | P1 completeness | Recovery is sleep+HRV |
| 16 | Design | Charts split (sleep stacked + HRV sparkline) | Auto | P1 completeness | Both voices flagged 375px density |
| 17 | Design | Range tabs primary control (Day/Week/Month/3M) | Auto | P5 explicit | One mental model that scales |
| 18 | Design | Stage viz = proportional, never temporal | Auto | P5 explicit | Stage stack misreads as hypnogram |
| 19 | Design | Bad-night UX adapts lede + surfaces 7-day baseline | Auto | P1 completeness | Avoid punishing bad mornings |
| 20 | Design | Score = label only; number behind ⓘ | Auto | P5 explicit | "78" reads as B-grade |
| 21 | Design | Accessibility section explicit | Auto | P1 completeness | A11y aspirational by omission |
| 22 | Design | `/wellbeing` deep-link row | Auto | P5 explicit | Discoverability after input removal |
| 23 | DX | Rename → get_health_sleep_summary | Auto | P5 explicit | Match get_health_* family |
| 24 | DX | `fields[]` projection (not include_nights bool) | Auto | P5 explicit | Match get_health_snapshot pattern |
| 25 | DX | Errors section: not_connected, invalid_range, invalid_input | Auto | P1 completeness | Was missing |
| 26 | DX | Cross-refs in snapshot + series descriptions | Auto | P1 completeness | Discoverability |
| 27 | DX | window_days alternative param | Auto | P3 pragmatic | "Last week" doesn't need start_date math |
| 28 | DX | HRV shape lifted from snapshot | Auto | P4 DRY | Same data; one type |
| 29 | DX | CLAUDE.md "Sleep workflow" full stanza | Auto | P1 completeness | One bullet wasn't enough |
| 30 | DX | >90d cap silently with window_capped flag | Auto+taste | P3 pragmatic | Surfaced as taste #4 |

---

## Cross-phase themes

- **The plan invented things that already exist.** `start_at`/`end_at` (Eng), proportional stage viz (Design picked it as proportional even though plan said "stack"), `not_connected` shape (DX). Pattern: when the plan describes a "new" thing, search the codebase first.
- **Three phases independently flagged "make it match an existing pattern":** Eng on the daily/nightly drift (match `healthkit_workouts` shape), Design on iOS list patterns (match nutrition/wellbeing), DX on tool naming (match `get_health_*`). High-confidence signal: existing patterns are load-bearing in this codebase.
- **Single-user assumptions are doing work.** TZ is hardcoded Europe/London, no RLS, no migrations need backwards-compat. The plan assumes this freely. Continue to.

---

## Summary

The hard part of sleep tracking — ingestion — is mostly done; the *edges* of ingestion (deletions, naps, multi-source, backfill, TZ) need fixing alongside the views. v2 expands scope from "views only" to "views + ingestion edges":

1. Migration 025: `healthkit_sleep_nights` table, source-aware, nullable envelope, `is_main` filter, anchor-reset backfill.
2. Sync changes: persist envelope + sample_count + `is_main` + handle `deleted` array.
3. Consistency score: circular statistics, Europe/London-aware, n=5 threshold.
4. `get_health_sleep_summary` MCP tool: `fields[]` projection, error shape mirroring snapshot, cross-refs in snapshot+series.
5. `/sleep` page: verdict-first lede, HRV inline, split charts, range tabs primary, accessibility specified, bad-night-friendly copy.
6. `/wellbeing` cleanup: input removed, deep-link row added.

Estimated effort: ~1.5d CC for migration + sync + tool + tests; ~0.5d CC for the page; ~0.25d CC for /wellbeing cleanup + CLAUDE.md docs. Total ~2.25d CC.
