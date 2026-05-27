---
name: program-review
description: >
  Review Lou's current training program against the androgodess spec and rewrite
  it with 3 critique iterations + an adversarial gate. Use when Lou says
  "program review", "rewrite the program", "redesign the routine", "the program
  feels off", "5-day split", "mid-quarter program change", "we've learned things
  about the program", or similar. Sub-commands: "review" (default — diagnostic
  only, no rewrite), "rewrite" (full program rewrite via 3-iteration critique
  loop). Never writes to Rebirth unless invoked with `--apply` AND Lou explicitly
  confirms in-turn AND 3-gate recovery criteria all clear. Source of truth =
  Rebirth (MCP) + the /androgodess skill + the embedded per-muscle recovery
  research table.
---

# /program-review

Lou's training program is the load-bearing input for the androgodess plan. This skill
exists because mid-quarter learnings (mockups, session-length reality, spec drift,
recovery debt) need a structured rewrite path, not vibes.

The output is a proposal markdown file under `.claude/program-proposals/`. **MCP writes
are never automatic** — Lou reviews the file, then approves an apply step separately,
AND the 3-gate recovery criteria must clear.

## Identity reminder
- **Lou (they/them).** Never Lewis. Never he/him.
- Single-user app. Lou is the only user, ever.

## Invocation modes

| Args | Behavior |
|---|---|
| _(none)_ or `review` | Diagnostic only. Pull state, surface gaps vs spec, propose direction. No full draft. No critique loop. ~10 tool calls. |
| `rewrite` | Full rewrite: scope-confirm → draft v1 → 3 critique iterations → adversarial gate → proposal file. |
| `rewrite --days=N` | Constrain to N training days/week. |
| `rewrite --weekends-off` | Hard constraint: no Saturday or Sunday training. |
| `rewrite --apply` | After Lou confirms the final proposal AND 3-gate clears, apply via MCP. Default = propose only. |

The `--apply` flag is necessary but not sufficient. Even with the flag set, you MUST:
1. Get an explicit in-turn "apply / go / do it" from Lou in the same conversation
2. Verify all 3 gates clear (see "Apply gates" below)
3. Prefix every proposed MCP call with `# GATED:` in the proposal file as a runtime safety

## Apply gates (ALL must clear before any MCP write)

1. **Lou explicitly says "apply"** in the current conversation
2. **SMM holding or up** vs the most recent baseline reading (next InBody scan must show)
3. **HRV recovery state acceptable AND enough valid data to read it:**
   - Use `worse_of(delta_pct, window_avg_delta_pct)` from `get_health_snapshot` + `get_health_sleep_summary`. The window_avg signal is more trustworthy than the single-night delta_pct — but the gate uses the worse of the two so we don't get fooled by either being good in isolation.
   - Threshold: worse_of ≥ −15%
   - **≥ 7 valid in-bed nights in the last 10 calendar nights** (Eight Sleep data source — see below)
   - 21–28 day HRV trend not sharply negative unless there's an explicit deload/recovery explanation

**Sleep + HRV data source: Eight Sleep mattress, NOT Apple Watch.** When Lou travels there is no data because the bed stays home. Never refer to the source as "watch" or "Apple Watch." When sleep data is missing, the most likely cause is travel — not flakiness. The 7-of-last-10-valid-nights gate protects against applying based on rebound-sleep data immediately after a travel-heavy period.

## Source of truth

Authoritative order when sources disagree:
1. **Rebirth (MCP)** — live state. `get_active_*` tools.
2. **`/androgodess` skill** at `~/.claude/skills/androgodess/SKILL.md` — codified spec, science cliff-notes, guardrails. Read during scope-confirm and pass its constraints to every critic.
3. **Plan doc** at `/Users/lewis/Downloads/androgodess_master_plan.docx` — descriptive only.
4. **Lou's in-turn statements** — override all of the above when explicit.

If Rebirth disagrees with /androgodess skill, surface the delta to Lou before drafting. Don't quietly resolve it.

## Mandatory guardrails (NEVER violate, even with `--apply`)

These map to /androgodess "Guardrails" section. Re-read every run.

1. **No MCP writes without `--apply` AND in-turn confirmation AND 3-gate clearance** in the same conversation.
2. **No BF% targets.** InBody BF% reads ~7–8 points low for Lou.
3. **No HRT regimen recommendations.** Surface options/research; prescriber decides doses.
4. **Pallof PRESS, not rotations.** Anti-rotation only. No high-volume direct oblique hypertrophy.
5. **WHR target = 0.74.** Not 0.78.
6. **No chest/breast development work.** Raloxifene-blocked intentionally. Chest at ≤6 sets/wk shape work only (incline DB + low-to-high cable flye), NOT mass-chasing (no flat barbell, decline, dips).
7. **Watch small-muscle MRV ceilings.** Rotator cuff HARD CAP **8 sets/wk total** including all secondary credit. Compute realistic effective load (~half of labeled secondary), but the cap is on labeled-secondary too as a margin of safety.
8. **Canonical 18 muscle slugs only.** Call `list_muscles` to verify. `create_exercise` rejects non-canonical input. Sub-bucket intent (lateral/rear/long-head/width) lives in exercise notes, NEVER in the volume table.
9. **No 5-day schedule that creates week-boundary stacks.** Sat→Sun→Mon→Tue = 4 in a row across the week is worse than 5 in a row Mon–Fri. If Lou says "no weekends," do Mon–Fri only.

## Per-muscle recovery research table (LOAD-BEARING — pull at Phase 1, use as structural constraint)

This table drives day distribution. NOT a critique afterthought.

| Muscle | Heavy recovery | Moderate recovery | Max weekly freq | Source |
|---|---|---|---|---|
| Glutes | 48–72h | 36–48h | 3–4×/wk | Schoenfeld 2016/2019; Contreras |
| Hamstrings | 48–72h | 48h | 2–3×/wk | Schoenfeld 2019 eccentric damage |
| Quads | 48–72h | 48h | 2–3×/wk | Schoenfeld 2019 |
| Hip abductors | 24–48h | 24–36h | 3–4×/wk | Helms; RP |
| Calves | 24h | 24h | 3–6×/wk tolerable | Schoenfeld 2016 |
| Chest | 48h | 36–48h | 2–3×/wk | Schoenfeld 2019 |
| Delts (lateral) | 24–48h | 24h | 3–4×/wk | Schoenfeld; Pedrosa 2022 lengthened-bias |
| Delts (rear) | 24–48h | 24h | 3×/wk | Schoenfeld |
| Lats | 48h | 36–48h | 2–3×/wk | Schoenfeld |
| Rhomboids / mid-traps | 24–48h | 24h | 2–3×/wk | Helms |
| Rotator cuff | 24h | 24h | **HARD CAP 8 sets/wk** | Overuse-injury |
| Biceps | 24–48h | 24h | 2–3×/wk | Helms |
| Triceps | 48h | 24–36h | 2–3×/wk | Helms (press overlap) |
| Core (rectus) | 24–48h | 24h | 3–4×/wk | RP |
| Core (anti-rot) | 24h | 24h | Daily-tolerable | Stiffness training |
| Erectors | 48–72h | 48h | 2×/wk | Deadlift-pattern |
| Forearms | 24h | 24h | Daily-tolerable | Grip work |

**HRT context for ALL critics:** Estradiol's effect on recovery is net POSITIVE (reduced exercise-induced damage, increased satellite cell activity, anti-inflammatory). HRT does NOT lengthen recovery times. It DOES cap absolute MPS capacity → lower total weekly volume ceiling. Frequency is NOT reduced.

**Day-distribution rules derived from table:**
1. Heavy session of muscle X → 48h before moderate session of muscle X → 48h before light session
2. Upper days bracket lower days so quad/glute recovery isn't compromised
3. Erectors only 2×/wk total (RDL + back ext is the typical split)
4. Rotator cuff cap on labeled-secondary across the whole week
5. Frequency-stagger principle: 3× staggered intensity > 2× concentrated for total weekly volume capacity

## Workflow — `rewrite` mode

### Phase 0: Identity + guardrails reload

Re-read this skill's "Mandatory guardrails" + "Per-muscle recovery research table" sections. Re-read `~/.claude/skills/androgodess/SKILL.md` sections: "What we ARE building", "What we are NOT building", "Science cliff-notes", "Guardrails".

### Phase 1: Pull current state (parallel)

Run in parallel via batched MCP calls:

- `get_active_vision`
- `get_active_plan` + `get_plan_progress`
- `get_active_routine`
- `list_training_blocks`
- `list_muscles`
- `list_rep_windows`
- `get_sets_per_muscle({ week_offset: 0 })`, `-1`, `-2`, `-3` — 4-week trend
- `get_weekly_summary({ week_offset: 0 })`
- `get_recent_workouts({ days: 28 })` — actual session times + RIR distribution
- `list_coaching_notes({ pinned_only: true })` — monitoring protocol + log + pending program-change notes
- `get_health_sleep_summary({ window_days: 28 })` — note Eight Sleep travel gaps
- `get_health_snapshot({ fields: ['hrv','resting_hr'] })`
- `find_exercises` for any exercise the new program might use (UUID reuse pre-flight check)

**Cache all results. Every critic in Phase 5/6/7 + codex reads them.**

### Phase 2: Spec reconciliation

Build delta table: Rebirth vision build_emphasis vs /androgodess spec vs Lou's in-turn amendments. Surface to Lou.

### Phase 3: STOP — scope confirmation (AskUserQuestion)

Required questions:

1. **Day count + which days.** If Lou says "no weekends," HARD CONSTRAINT to Mon–Fri only.
2. **Session-length cap.** Default 60-min cap. Confirm.
3. **Spec amendments.** Show the delta table, confirm each addition/deferral.
4. **Exclusion confirmations.** Re-confirm chest=shape-only, quads=anti-dominant, traps=NO, neck=NO, direct obliques=NO.
5. **Apply gating posture.** Default = propose-only with 3-gate. Confirm Lou wants this (vs override).

Capture answers as hard constraints for Phase 4+.

### Phase 4: Draft v1 — use the recovery research table as the structural driver

For the day distribution specifically:
- If Lou wants higher total weekly volume on a priority muscle, USE FREQUENCY-STAGGER (3× heavy/moderate/light) over CONCENTRATION (2× near-MAV).
- Validate every day's exercise list against the recovery table — does this session land in the recoverable range given what the previous session loaded?
- Compute realistic effective rotator_cuff load and verify ≤8 sets/wk on labeled-secondary (not just primary).
- For every BUILD muscle: verify ≥2× direct frequency.

Output structure:
- Per-muscle weekly volume target table (canonical 18 slugs)
- Day-by-day with: exercise, sets×reps, window, primary, secondary, RIR, rest, **tempo + cues**
- Honest session-length estimates (rest math: sets × (rep_time + rest) + warm-up + transitions)
- Frequency check per muscle
- Pre-migration spec amendments (`update_vision` body_md spelled out literally)

### Phase 5: Critique iteration 1 — Multi-persona panel (PARALLEL)

Spawn 4 Agent calls in parallel:

- **A — Hypertrophy/programming:** Schoenfeld dose-response, MEV/MAV/MRV per muscle, frequency, fatigue interference, exercise selection (compound→isolation order, stretch-emphasis, hip thrust vs squat for GMax), RIR targets, rest realism. **Specifically check: does the set-math in the table actually match what the exercise list delivers (no double-counting, no overstated frequency)?**
- **B — Recovery/HRT:** HRT impact (estradiol POSITIVE on recovery, NEGATIVE on absolute MPS ceiling), CNS load, HRV cost, deload positioning, weekly fatigue distribution, Eight Sleep data validity, pre/post nutrition timing.
- **C — Body-comp/aesthetics:** silhouette match vs androgodess spec, exercise selection delivering visual outcome (not just "more muscle"), lengthened-vs-shortened bias, regional emphasis within multi-head muscles, aesthetic backfires (blocky biceps, oblique thickening, trap creep).
- **D — /androgodess invariants:** read `~/.claude/skills/androgodess/SKILL.md`, verify EVERY guardrail. List violations + Rebirth-live state mismatches + spec amendments needed before migration. **Specifically check: canonical slug discipline, rotator cuff cap on labeled-secondary (not just primary), PB-history protection via UUID reuse, literal vision body_md template completeness.**

Each agent returns:
```
## Top 3 issues
1. [BLOCK|MAJOR|MINOR] [one-line]: explanation + concrete fix
2. ...
3. ...

## Risks I'd watch
- ...

## Things I'd keep as-is
- ...
```

**Synthesize and apply block + major fixes → Draft v2.**

### Phase 6: Critique iteration 2 — forced novelty

Same 4 agents. Pass Draft v2 + iter 1 synthesis log. Prompt: "Do NOT repeat findings from previous round. Find what's still wrong, what the fixes introduced, second-order issues."

**Critic prompts in iter 2 should explicitly ask for:**
- Set-math double-counting (claimed primary credit where secondary is real, or vice versa)
- Frequency claims that the actual exercise table doesn't implement (e.g., "3× biceps" but day 2 has no bicep work)
- Slot-by-slot fatigue cascades within a day (pre-fatigued limiter muscles)
- "Summary doesn't match implementation" pattern

→ **Draft v3.**

### Phase 7: Critique iteration 3 — polish pass

Same 4 agents on Draft v3. Polish-level: warm-up specs, tempo cues, form cues, rest interval realism, nutrition timing, migration call ordering, watch-point completeness.

→ **Draft v4.**

### Phase 8: Adversarial gate — codex challenge

Run via Bash:
```bash
cat > /tmp/program-review-challenge.md <<'EOF'
[adversarial prompt: try to break the program. Find what 3 rounds of structured critique missed. Look for silent volume overlap, set-math double-counting, frequency claims not matching implementation, recovery debt, missing warm-ups, optimistic session times, gating breaches, vibes vs falsifiable signals.]
EOF
codex exec --skip-git-repo-check --sandbox read-only < /tmp/program-review-challenge.md 2>&1 | tee /tmp/program-review-codex-out.md
```

If codex finds material issues → apply fixes → **Final Draft.**
If codex finds only nits → **Final Draft = Draft v4.**

**Common codex catches to anticipate during drafting (informed by past runs):**
- Apply gate too narrow (gate on multiple recovery signals, not just one)
- Skip-day reality not honestly stated (don't claim "within target" if a skip materially undershoots)
- "Moderate" session disguised as a second heavy session
- Summary claims (e.g., "3× freq") not implemented in the day tables
- Eight Sleep data validity (post-travel rebound sleep can falsely clear gates)
- Rotator cuff arithmetic on labeled-secondary
- Lying-lateral / BSS 90s/side rest math optimism
- Progress-photo signals as vibes without standardization protocol

### Phase 9: Write proposal file

```bash
PROPOSAL_FILE=".claude/program-proposals/$(date +%Y-%m-%d)-$(echo "$SUMMARY_SLUG" | tr ' ' '-').md"
```

Required sections (see latest proposal under `.claude/program-proposals/` for the reference template):

1. Header (date, current routine, proposed, day count change, generated-by, spec amendments, structural redirects if any)
2. **🚫 GATED banner at top** — 3 gates spelled out + Eight Sleep travel caveat
3. Executive summary (≤3 sentences)
4. Spec amendments
5. Per-muscle recovery research table (so critics + future-Lou can audit the structural reasoning)
6. Current vs proposed at-a-glance
7. Per-muscle weekly volume targets (canonical slugs, both with-D-N and without-D-N if D-N is skippable)
8. Schedule + cutover ramp
9. Day-by-day structure (warm-up, exercise table with cues, totals)
10. Frequency check (honest, matching actual implementation)
11. Migration plan (LOCKED ORDER, `# GATED:` prefix on every MCP call, literal vision body_md template)
12. Watch-points post-cutover
13. 8-week progress photo signals + standardization protocol
14. Critic appendix (iter 1/2/3 + codex pass(es) — honest log)
15. Known remaining gaps (accepted, not fixed)
16. What to do with this file

### Phase 10: Surface to Lou

Reply ~400 words:
- Executive summary
- Headline structural changes
- 2–3 most consequential trade-offs the critique surfaced
- Path to file
- Ask what Lou wants next (read, push back, invoke `--apply`)

If `--apply` was set AND Lou confirms in-turn AND 3-gate clears → proceed to migration calls.
Otherwise stop here.

## Workflow — `review` mode (default)

Phases 0, 1, 2 only. Then output ~300-word reply: spec vs Rebirth vs last 4 weeks delivered, top 3 gaps, whether rewrite is warranted vs smaller fixes (a few `swap_exercise` + `update_set_targets`).

Do NOT generate a full program in `review` mode.

## Pre-migration MCP audit checklist (run BEFORE any `# GATED:` call)

1. `find_exercises` for every exercise in the new program → identify reuse-vs-create. **Preserve PB history by reusing UUIDs where possible.** Known reusable UUIDs (verify before relying):
   - `Lateral Raise: Cable (Standing)` — `121fc414-0e32-439e-8416-7a2ba9545b6b`
   - `Hyperextension: 45° Glute Bias` — `9dbef625-e40b-4f78-bead-d7294a1c042e`
   - Triceps Pushdown variants — search via `find_exercises({ query: "pushdown" })`
2. Read existing `chkpt-*` notes BEFORE `log_plan_checkpoint` → CONCATENATE, don't clobber (May 9 narrative must survive).
3. Verify the `update_vision` body_md template is complete (literal string, not "amend").
4. Verify rotator cuff total on labeled-secondary ≤ 8.
5. Verify every BUILD muscle ≥ 2× direct frequency in the actual exercise table (not the summary claim).

## Tool reference

Inherits from `/androgodess` skill's "Tool reference" table — same MCP surface.

## Failure modes + recovery

- **MCP timeout / 502 on Phase 1** — retry once after 60s. If still failing, surface to Lou.
- **Agent returns nothing useful** — one retry with pointed prompt. Then mark iteration as skipped in proposal appendix.
- **codex CLI missing / errors** — Phase 8 becomes self-critique pass with explicit "try to break it" prompt. Note skip in appendix.
- **Conflicting Phase 3 confirmations** — if Lou's amendments would violate a guardrail (e.g., direct oblique hypertrophy), STOP. Surface conflict explicitly.
- **Eight Sleep gap during gating window** — if travel-explained, suspend gates 3 until ≥7 valid in-bed nights accumulated. Do not approximate "missing = neutral."

## Completion status

End with one of:
- **DONE** — proposal written, summary delivered, awaiting Lou.
- **DONE_WITH_CONCERNS** — proposal written, unresolved tensions listed.
- **BLOCKED** — stuck in Phase 3, or guardrail conflict.
- **NEEDS_CONTEXT** — MCP unavailable, /androgodess missing, etc.

## Skill self-improvement log (update when codex surfaces new failure modes)

Update this section after each `rewrite` run if codex catches a category of issue the multi-persona panel missed. Pre-load future critic prompts to chase that category.

**Known patterns (May 2026):**
- "Summary claims don't match implementation" — multi-persona panel believes the volume table; codex audits the day tables and finds discrepancies. **Iter 2 critic prompts now explicitly ask for this.**
- Apply gate single-signal failure — v4 only gated on SMM, missed HRV recovery debt. Now 3-gate.
- Eight Sleep gap rebound risk — 5 post-travel nights can clear gates artificially. Now require 7-of-last-10.
- "Moderate" session disguised heavy — when stagger spec says heavy/moderate/light but exercise selection puts the moderate session near-MAV. Codex catches this by computing per-session fatigue cost.
- Set-math double-counting on rotator_cuff secondary across multiple delt/face-pull exercises.
- Sub-bucket muscle slugs (e.g., `delts (lateral)`) that don't exist in Rebirth's canonical 18.
