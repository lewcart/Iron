## iPad — future work (deferred from 2026-04-20 web-first pivot)

- [ ] If iPad usage is real, evaluate native universal binary + one wedge feature
      (Pencil on progress photos OR InBody scan scrub-compare OR weekly review cockpit)
- [ ] If going native: update FitspoControlExtension + RestTimerLiveActivity
      device family to 1,2 for widget parity
- [ ] Consider Stage Manager / keyboard shortcut / macOS Catalyst surfaces at that point
- [ ] Chart enrichment polish round — currently added reference lines + multi-site overlay
      at lg:+; consider making trend metric selectable (weight, SMM, BMR) rather than hardcoded PBF%
- [ ] ios-section / ios-row standardization — both reviewers flagged as visual debt,
      out of scope for the 2026-04-20 iPad pass
- [ ] Success metric before graduating to native: N weekly iPad sessions, mostly on
      /measurements or /body-spec

## Local-first migration follow-ups (deferred from 2026-04-30 /plan-eng-review)

- [ ] **change_log retention policy.** After the local-first migration ships, the
      `change_log` Postgres table grows unbounded — every INSERT/UPDATE/DELETE on
      a synced domain table appends a row. With single-user usage, growth is slow,
      but after ~12-18 months first-pull pagination will start to feel sluggish and
      after years it could become real Postgres bloat. Add a Vercel cron in
      `vercel.ts` that nightly deletes `change_log` rows older than 90 days
      (or older than `MIN(last_seen_seq) - 90 days` if a "last seen" cursor is
      tracked server-side per device). The seq is monotonic so retention is just
      `DELETE WHERE created_at < NOW() - INTERVAL '90 days'`. Pre-req: confirm
      sync clients always pull within 90 days (foreground sync + 15s polling
      makes this safe).

- [ ] **Photo upload queue parity for body-spec and progress photos.** The
      `inspo_photos` Dexie table has full offline-capture + upload-retry
      semantics (Blob field, `uploaded: '0'/'1'` flag, retries until upload
      succeeds). The local-first migration only caches photo metadata + lazy
      thumbnails for body-spec/progress photos — capture-while-offline doesn't
      work for those flows. Extend the inspo_photos pattern: add Blob fields
      and upload retry to body-spec and progress photo Dexie tables; share an
      upload-queue worker. ~1.5 hours with CC. Reason for deferral: out of
      scope of the user-stated pain (instant render + MCP-seamlessness +
      no-zoom); offline photo capture is a separate UX win.

- [ ] **Evaluate generic `defineDomain<T>()` factory after migration ships.**
      Codex flagged that copy-pasting the mutations + useLocalDB pattern across
      8 domains will drift. We chose copy-paste to avoid premature abstraction.
      After shipping, audit the 8 mutations modules for actual drift. If two
      domains diverge on `_synced` filter or `_updated_at` semantics or sync
      envelope serialization → extract a `defineDomain` factory from working
      code. If they stayed clean → leave it. Don't extract until you can see
      the abstraction in three working examples.

- [ ] **Split mcp-tools.ts (2693 lines) and queries.ts (2552 lines) per-domain.**
      Pre-existing tech debt, surfaced during the local-first migration review.
      Both files become more painful to navigate after the migration adds 8 new
      domain mutation surfaces. Recommended split: `mcp-tools-{workouts,plans,
      nutrition,measurements,wellbeing,hrt,body-spec,exercises,inbody,inspo,
      healthkit}.ts` and similar for queries. Mechanical refactor, ~2 hours.

- [ ] **Audit remaining online fetches** (`/settings`, `/inspo`, exercise
      history/detail, workout repeat/history endpoints, HealthKit writeback,
      imports, upload routes, global capture components). Local-first covered
      the 8 main pages; auxiliary paths still hit production. Decide per-path
      whether to migrate or accept online-only.

- [ ] **HealthKit conflict resolution with newly-local domains.** When
      nutrition/InBody/bodyweight become local-first, HealthKit writeback +
      mirror records race with local writes. Define explicit precedence:
      who wins between (a) local Dexie write, (b) HealthKit→Postgres mirror
      write, (c) MCP write. Currently implicit; document and test.

