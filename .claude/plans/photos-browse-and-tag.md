# Photos: Browse, Compare, and AI-Tag — Implementation Plan

## 1. Summary

Lou wants the photos surface to graduate from "scrolling list of upload cards" into a real progress-tracking tool: a tight 5-most-recent strip on the photos tab (expand for more), a pose-filtered viewer that flicks through every Front / Side / Back photo chronologically, and a compare mode that lays 2–4 selected dates side-by-side. The block on this is data: of the **141 photos in `progress_photos` today, 100% are tagged `pose='front'`** because that's the form's default and Lou never changed it. The pose column is technically populated, but semantically all rows are unlabeled.

The work splits into a one-time AI backfill (vision-classify each photo's pose, write back), a small schema augmentation to track tag provenance/confidence, and three UI surfaces (capped recent list, pose-filtered flickable viewer, compare mode). Everything plugs into the existing local-first architecture: Dexie already indexes `pose, taken_at`, sync triggers already fire on `progress_photos`, the Sheet primitive is in place, and a sibling agent has already extracted upload into `PhotoSheet.tsx`. The AI piece reuses the OpenAI SDK already in `package.json` (no new dependency) — `gpt-4o-mini` vision is the cheapest credible option here, ~$0.0002/image, ~$0.03 for the whole 141-photo backfill. Each phase is independently shippable.

## 2. Current state

**Schema** (`src/db/migrations/002_rebirth_modules.sql:205`, `019_local_first_sync_layer.sql:282`):
```sql
CREATE TABLE progress_photos (
  uuid TEXT PRIMARY KEY,
  blob_url TEXT NOT NULL,
  pose TEXT NOT NULL CHECK(pose IN ('front', 'side', 'back')),
  notes TEXT,
  taken_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_progress_photos_taken_at ON progress_photos(taken_at DESC);
```

NOT NULL + 3-value CHECK; no `'other'` bucket; no confidence column; no `pose_source` column. No `(pose, taken_at)` composite index.

**Type system** (`src/types.ts:303`): `ProgressPhotoPose = 'front' | 'side' | 'back'`. Mirrored in `src/db/local.ts:439`.

**Live data** (queried Postgres, read-only):
- 141 total photos, range 2019-07-29 → 2026-04-14
- `by_pose: [{ pose: 'front', n: 141 }]` — every photo tagged front (form default)
- Blob URLs are public

**Local-first wiring** (already complete):
- Dexie table `progress_photos: 'uuid, taken_at, pose, _synced, _updated_at'` (`src/db/local.ts:554`)
- `useProgressPhotos(limit)` hook at `src/lib/useLocalDB-measurements.ts:91`
- `recordProgressPhoto` / `deleteProgressPhoto` at `src/lib/mutations-measurements.ts:128,147`
- Sync push: `src/app/api/sync/push/route.ts:765-781`
- Sync pull: `src/app/api/sync/changes/route.ts:311`
- Server REST: `src/app/api/progress-photos/...`
- MCP: `upload_progress_photo`, `list_progress_photos`

**UI** (`src/app/measurements/page.tsx:483-588`):
- Photos live on the `?tab=photos` tab of `/measurements` — there is **no dedicated `/photos` route**
- Current gallery: `photos.map(...)` over up to 50 photos, full-width images stacked
- Pose selector + upload form is being moved into `PhotoSheet.tsx` by a sibling agent

**AI infra**:
- `package.json` has `openai` already installed
- Pattern at `src/app/api/exercises/[uuid]/generate-images/route.ts:66`
- Only `OPENAI_API_KEY` is wired (no Anthropic / Gemini)
- `scripts/backfill-progress-photos.mjs` exists as a script template

## 3. Data model

Single new migration `029_progress_photos_pose_tagging.sql`:

```sql
BEGIN;

ALTER TABLE progress_photos DROP CONSTRAINT IF EXISTS progress_photos_pose_check;
ALTER TABLE progress_photos
  ADD CONSTRAINT progress_photos_pose_check
  CHECK (pose IN ('front', 'side', 'back', 'other'));

ALTER TABLE progress_photos
  ADD COLUMN IF NOT EXISTS pose_source TEXT
    NOT NULL DEFAULT 'manual'
    CHECK (pose_source IN ('manual', 'ai', 'unverified'));

ALTER TABLE progress_photos
  ADD COLUMN IF NOT EXISTS pose_confidence REAL;

CREATE INDEX IF NOT EXISTS idx_progress_photos_pose_taken_at
  ON progress_photos(pose, taken_at DESC);

UPDATE progress_photos SET pose_source = 'unverified' WHERE pose_source = 'manual';

COMMIT;
```

Sync push and pull need to be widened to include `pose_source` + `pose_confidence`. Same for `LocalProgressPhoto` interface. Bump Dexie version. Add `'other'` to `ProgressPhotoPose` type. Widen the MCP `upload_progress_photo` enum.

## 4. AI tagging design

**Model: OpenAI `gpt-4o-mini`** (vision-capable, already-installed SDK, no new key needed).

Why not the alternatives:
- Gemini Flash: cheaper, but no SDK / key wired
- Claude Haiku 4.5: excellent vision, but no SDK / key
- Local CoreML: no model checked in, would need conversion

Per-image cost: ~$0.0002 at `detail: low`. **141 photos = ~$0.03.**

**Pipeline**: filter `pose_source IN ('unverified','ai')` → public blob_url → OpenAI vision call with strict JSON schema → confidence ≥ 0.75 sets pose, < 0.75 → `other` with `pose_source='ai'`.

**Prompt** (system/user, with `response_format: { type: 'json_schema', strict: true }` — pose enum + confidence 0..1 + reasoning string).

**Backfill script**: `scripts/tag-photo-poses.mjs`. Idempotent, batched 5 concurrent, dry-run flag. ~3 minutes for the 141 rows.

**Live auto-tag-on-upload**: `src/lib/photo-pose-classifier.ts`, called from `POST /api/progress-photos/upload` (block on the ~1.5s classifier so the optimistic UI is correct from the start). Skip in MCP path (agents pass pose explicitly).

## 5. UI design

All three new views inside `/measurements?tab=photos`. No new top-level route.

### 5a. `RecentPhotosStrip` — capped 5 + expand
Replaces the inline gallery in `src/app/measurements/page.tsx:547-580`.

```tsx
function RecentPhotosStrip({ photos, onOpenViewer }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? photos.slice(0, 30) : photos.slice(0, 5);
  // grid grid-cols-5 gap-2 md:grid-cols-8
  // 80×80 thumbs with pose badge + unverified dot
}
```

### 5b. `PhotoViewerModal` — pose-filtered flickable viewer
Full-screen Sheet (`height: '100vh'`, black bg, edge-to-edge image).

```tsx
interface ViewerProps {
  open: boolean;
  initialPose: 'front'|'side'|'back'|'other'|'all';
  initialUuid?: string;
  onClose: () => void;
  onEnterCompareMode: (uuid: string) => void;
}
```

Interactions: keyboard ←/→/Esc/c (web), swipe (iOS), bottom pose pills, pose-correction overflow when `pose_source !== 'manual'`, "Add to compare" pin.

### 5c. `CompareView` — side-by-side
2/3/4 photos in a CSS grid (4 → 2×2 on portrait). Each photo has date caption + remove button. Hard cap at 4.

### Other UI touches
- Pose-confidence banner if any unverified rows
- New `useProgressPhotosByPose(pose, limit?)` hook (Dexie indexed)
- New `updateProgressPhotoPose(uuid, pose)` mutation

## 6. Phased rollout

Each phase independently shippable.

### Phase 1 — Schema + AI backfill (no UI)
- Migration 029
- Type widen, sync push/pull widen, Dexie bump
- `src/lib/photo-pose-classifier.ts`
- `scripts/tag-photo-poses.mjs` — dry-run first, eyeball ~10, then commit
- **Ship gate**: ≥90% of 141 tag as `ai AND pose != 'other'`. If not, drop threshold to 0.6 and re-run.

### Phase 2 — Recent strip + expand
- Wait for sibling `PhotoSheet.tsx` to land
- New `RecentPhotosStrip.tsx` + `Thumb.tsx`
- Existing `useProgressPhotos(50)` unchanged
- **Ship gate**: visual QA on iPad portrait + iPhone simulator, render <50ms after Dexie hydrates.

### Phase 3 — Pose-filtered viewer modal
- New `PhotoViewerModal.tsx`
- New `useProgressPhotosByPose` hook + `updateProgressPhotoPose` mutation + server widening
- Wired from `RecentPhotosStrip`
- Keyboard + swipe; pose pills; correction picker
- **Ship gate**: keyboard + swipe both navigate without losing position; pose-correction round-trip works.

### Phase 4 — Compare mode
- Compare-set state in `PhotoViewerModal`
- New `CompareView` component, switched in when set ≥ 2
- Hard cap 4
- **Ship gate**: pick 2/3/4 across poses, remove one, close, reopen — state correctly resets.

### Phase 5 — Auto-tag-on-upload
- `POST /api/progress-photos/upload` returns classified pose
- `PhotoSheet.tsx` adds "Auto-detect" pose pill (default)
- If user explicitly picks → `pose_source='manual'`. Auto → `pose_source='ai'`
- MCP path keeps `pose` required
- **Ship gate**: auto-detect upload of clearly-front and clearly-side photos lands correct without manual selection.

## 7. Risks & open questions for Lou

1. **Photo privacy / third-party AI**. 141 body photos to OpenAI is a real privacy decision. OpenAI doesn't train on API data by default but retains 30 days for abuse monitoring. **Question: OK with sending body photos to OpenAI?** If no: defer Phases 1 + 5; Phases 2–4 work fine on manually-tagged data.

2. **Default upload pose is "front"**. Form forces a wrong-2/3-of-the-time default. Even without AI, an "Auto-detect" or "force-pick" approach would help. **Question: prefer auto-detect default, or force-pick (no default) and skip the AI on upload?**

3. **Notes overload from AI**. Plan currently doesn't persist `reasoning`. **Easy to add later.**

4. **`/photos` as a top-level route**. Plan keeps it on the measurements tab. **Question: graduate to `/photos` with own bottom-tab entry?** Defaulting no — bottom nav already has 5 entries.

5. **Confidence threshold**. 0.75 is a guess. Will see in Phase 1.

6. **Old `front`-tagged photos that really *are* front**. Migration marks all `unverified`. AI reconfirms most. If API key unset, banner never goes away. **Mitigation**: manual pose-correction picker in viewer (Phase 3) lets Lou tap-and-flip without AI.

7. **Mirror selfies / partial body**. Exact `other` use-case. Plan handles. Lou should check first batch of `other`-tagged to confirm threshold feel.

---

## Critical Files for Implementation

- `src/app/measurements/page.tsx`
- `src/app/measurements/PhotoSheet.tsx`
- `src/lib/mutations-measurements.ts`
- `src/lib/useLocalDB-measurements.ts`
- `src/db/local.ts`
- `src/app/api/sync/push/route.ts`
- `src/app/api/progress-photos/upload/route.ts`
- `src/types.ts`

## 8. Inspo photos integration

- Inspo photos (goal/aspiration photos) live in the local-only `inspo_photos` table — present in Postgres + Dexie but **not** part of the change_log CDC sync layer (see `SYNCED_TABLES` in `src/lib/sync.ts`). The capture path writes to Dexie, uploads to Vercel Blob, and POSTs to `/api/inspo-photos`; the gallery reads via REST.
- Compare mode (Phase 4) extends to mix progress + inspo photos. Compare-set entries become `{type: 'progress'|'inspo', uuid}` instead of just `uuid`.
- Inspo gets the same `pose` column (Migration 030 + Phase 1.5) so the pose-filtered viewer can include them: a "Show inspo too" toggle in the viewer's pose pills brings inspo photos of the matching pose into the chronological strip.
- Inspo photos in the viewer need a small badge to distinguish from progress photos (e.g. star icon top-left).
- Surface on /strategy: a "Goals" + "Inspo" section so the Vision page actually feels complete (shipped — `src/app/strategy/page.tsx`).
- Migration 030 adds `pose TEXT CHECK (pose IS NULL OR pose IN ('front','side','back','other'))` and `idx_inspo_photos_pose`. NULL = legacy / not-yet-categorized.
- Server: `POST /api/inspo-photos` accepts `pose`; new `PATCH /api/inspo-photos/[uuid]` lets a caller (or the post-burst picker) tag pose retroactively without re-uploading.
- Client: `InspoCaptureButton` now shows a non-blocking pose picker after the burst completes — taps any of front/side/back/other to apply pose to all 5 frames; "Skip" leaves them as null.
- Dexie: bumped to v12 with a `pose` index and a backfill setting `pose: null` on legacy rows.
