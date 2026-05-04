import { NextResponse } from 'next/server';
import { query } from '@/db/db';

// ─── /api/sync/push ───────────────────────────────────────────────────────────
//
// Accepts a payload of unsynced rows from any subset of the synced tables
// and upserts them to Postgres. CDC triggers (see migration 019) fire on
// each upsert and append to change_log so MCP-side and other clients see
// the change on their next pull.
//
// Single-user app — last-write-wins by row, no conflict detection. The
// client guarantees rows it sends are newer than its last_seq cursor, so
// a server row with strictly greater updated_at than the client's would
// only happen if MCP wrote between the client's last pull and this push.
// In that race, the client's write wins (overwrites MCP) — this is the
// stated trade-off for single-user simplicity. See plan-eng-review
// 2026-04-30.
//
// Each table has its own column list and INSERT...ON CONFLICT shape because
// the schemas differ. The list is mechanical but kept explicit (not factored
// into a generic helper) so each upsert is auditable in isolation and a
// schema change in one table doesn't quietly affect others.

interface PushPayload {
  workouts?: Array<Record<string, unknown>>;
  workout_exercises?: Array<Record<string, unknown>>;
  workout_sets?: Array<Record<string, unknown>>;
  bodyweight_logs?: Array<Record<string, unknown>>;
  exercises?: Array<Record<string, unknown>>;
  workout_plans?: Array<Record<string, unknown>>;
  workout_routines?: Array<Record<string, unknown>>;
  workout_routine_exercises?: Array<Record<string, unknown>>;
  workout_routine_sets?: Array<Record<string, unknown>>;
  body_spec_logs?: Array<Record<string, unknown>>;
  measurement_logs?: Array<Record<string, unknown>>;
  inbody_scans?: Array<Record<string, unknown>>;
  body_goals?: Array<Record<string, unknown>>;
  body_vision?: Array<Record<string, unknown>>;
  body_plan?: Array<Record<string, unknown>>;
  plan_checkpoint?: Array<Record<string, unknown>>;
  nutrition_logs?: Array<Record<string, unknown>>;
  nutrition_week_meals?: Array<Record<string, unknown>>;
  nutrition_day_notes?: Array<Record<string, unknown>>;
  nutrition_targets?: Array<Record<string, unknown>>;
  hrt_timeline_periods?: Array<Record<string, unknown>>;
  lab_draws?: Array<Record<string, unknown>>;
  lab_results?: Array<Record<string, unknown>>;
  wellbeing_logs?: Array<Record<string, unknown>>;
  dysphoria_logs?: Array<Record<string, unknown>>;
  clothes_test_logs?: Array<Record<string, unknown>>;
  progress_photos?: Array<Record<string, unknown>>;
}

export async function POST(req: Request) {
  try {
    const body: PushPayload = await req.json();

    // Push parents before children so foreign keys never reference a
    // not-yet-pushed row. Order matches src/lib/sync.ts SYNCED_TABLES.

    for (const r of body.exercises ?? []) await pushExercise(r);

    for (const r of body.workouts ?? []) await pushWorkout(r);
    for (const r of body.workout_exercises ?? []) await pushWorkoutExercise(r);
    for (const r of body.workout_sets ?? []) await pushWorkoutSet(r);

    for (const r of body.workout_plans ?? []) await pushWorkoutPlan(r);
    for (const r of body.workout_routines ?? []) await pushWorkoutRoutine(r);
    for (const r of body.workout_routine_exercises ?? []) await pushWorkoutRoutineExercise(r);
    for (const r of body.workout_routine_sets ?? []) await pushWorkoutRoutineSet(r);

    for (const r of body.bodyweight_logs ?? []) await pushBodyweight(r);
    for (const r of body.body_spec_logs ?? []) await pushBodySpec(r);
    for (const r of body.measurement_logs ?? []) await pushMeasurement(r);
    for (const r of body.inbody_scans ?? []) await pushInbody(r);
    for (const r of body.body_goals ?? []) await pushBodyGoal(r);

    // Strategic layer — vision before plan (FK), plan before checkpoint (FK).
    for (const r of body.body_vision ?? []) await pushBodyVision(r);
    for (const r of body.body_plan ?? []) await pushBodyPlan(r);
    for (const r of body.plan_checkpoint ?? []) await pushPlanCheckpoint(r);

    for (const r of body.nutrition_logs ?? []) await pushNutritionLog(r);
    for (const r of body.nutrition_week_meals ?? []) await pushNutritionWeekMeal(r);
    for (const r of body.nutrition_day_notes ?? []) await pushNutritionDayNote(r);
    for (const r of body.nutrition_targets ?? []) await pushNutritionTargets(r);

    for (const r of body.hrt_timeline_periods ?? []) await pushHrtTimelinePeriod(r);
    for (const r of body.lab_draws ?? []) await pushLabDraw(r);
    for (const r of body.lab_results ?? []) await pushLabResult(r);

    for (const r of body.wellbeing_logs ?? []) await pushWellbeing(r);
    for (const r of body.dysphoria_logs ?? []) await pushDysphoria(r);
    for (const r of body.clothes_test_logs ?? []) await pushClothesTest(r);

    for (const r of body.progress_photos ?? []) await pushProgressPhoto(r);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('sync/push error:', err);
    return NextResponse.json({ error: 'Push failed' }, { status: 500 });
  }
}

// ─── Per-table upsert helpers ────────────────────────────────────────────────

async function pushWorkout(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM workouts WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO workouts (uuid, start_time, end_time, title, comment, is_current, workout_routine_uuid, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
       title = EXCLUDED.title, comment = EXCLUDED.comment,
       is_current = EXCLUDED.is_current, workout_routine_uuid = EXCLUDED.workout_routine_uuid,
       updated_at = NOW()`,
    [r.uuid, r.start_time, r.end_time, r.title, r.comment, r.is_current, r.workout_routine_uuid],
  );
}

async function pushWorkoutExercise(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM workout_exercises WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO workout_exercises (uuid, workout_uuid, exercise_uuid, comment, order_index, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       comment = EXCLUDED.comment, order_index = EXCLUDED.order_index, updated_at = NOW()`,
    [r.uuid, r.workout_uuid, r.exercise_uuid, r.comment, r.order_index],
  );
}

async function pushWorkoutSet(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM workout_sets WHERE uuid = $1', [r.uuid]);
    return;
  }

  // Server-side RPE→RIR bridge for time-mode sets. Single source of truth
  // for the bridge formula: clients only need to send `rpe`; the server
  // derives `rir = clamp(10 - rpe, 0, 5)` so the existing RIR-based
  // effective_set_count weighting (queries.ts:1367-1372) keeps crediting
  // time-mode sets without a SQL change. Client-pushed `rir` is ignored
  // for time-mode rows. See PLAN-exercise-timer.md.
  const trackingModeRows = await query<{ tracking_mode: 'reps' | 'time' }>(
    `SELECT e.tracking_mode FROM exercises e
     JOIN workout_exercises we ON we.exercise_uuid = e.uuid
     WHERE we.uuid = $1`,
    [r.workout_exercise_uuid],
  );
  const trackingMode = trackingModeRows[0]?.tracking_mode ?? 'reps';

  const rpeRaw = r.rpe;
  const rpeNum = typeof rpeRaw === 'number' ? rpeRaw : null;
  const clientRir = typeof r.rir === 'number' ? r.rir : null;

  let rirParam: number | null;
  if (trackingMode === 'time' && rpeNum != null) {
    rirParam = Math.max(0, Math.min(5, 10 - Math.round(rpeNum)));
  } else {
    rirParam = clientRir;
  }

  await query(
    `INSERT INTO workout_sets (uuid, workout_exercise_uuid, weight, repetitions, min_target_reps, max_target_reps, rpe, rir, tag, comment, is_completed, is_pr, order_index, duration_seconds, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       weight = EXCLUDED.weight, repetitions = EXCLUDED.repetitions,
       min_target_reps = EXCLUDED.min_target_reps, max_target_reps = EXCLUDED.max_target_reps,
       rpe = EXCLUDED.rpe, rir = EXCLUDED.rir, tag = EXCLUDED.tag, comment = EXCLUDED.comment,
       is_completed = EXCLUDED.is_completed, is_pr = EXCLUDED.is_pr,
       order_index = EXCLUDED.order_index,
       duration_seconds = EXCLUDED.duration_seconds, updated_at = NOW()`,
    [r.uuid, r.workout_exercise_uuid, r.weight, r.repetitions, r.min_target_reps, r.max_target_reps, rpeNum, rirParam, r.tag, r.comment, r.is_completed, r.is_pr, r.order_index, r.duration_seconds ?? null],
  );
}

async function pushBodyweight(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM bodyweight_logs WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO bodyweight_logs (uuid, weight_kg, logged_at, note, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       weight_kg = EXCLUDED.weight_kg, logged_at = EXCLUDED.logged_at,
       note = EXCLUDED.note, updated_at = NOW()`,
    [r.uuid, r.weight_kg, r.logged_at, r.note],
  );
}

async function pushExercise(r: Record<string, unknown>): Promise<void> {
  // The exercises table is in the CDC sync layer. Catalog and custom rows
  // both push through here when the client edits them — text editing in
  // ExerciseDetail (description/steps/tips), the in-app image generator,
  // create-exercise form, etc. Server-side validation guards garbage
  // youtube_url because MCP/import paths can bypass form validation.
  if (r._deleted) {
    await query('DELETE FROM exercises WHERE uuid = $1', [String(r.uuid).toLowerCase()]);
    return;
  }

  // Validate youtube_url shape using the same regex the client helper does
  // (looksLikeYouTubeUrl). MCP/import paths can't bypass — anything that
  // doesn't look like a youtube host gets coerced to null. Single source
  // of truth would be ideal but server importing client-side helper is
  // awkward; the regex is duplicated and easy to keep in sync.
  const ytRaw = r.youtube_url;
  let ytClean: string | null = null;
  if (typeof ytRaw === 'string' && ytRaw.trim().length > 0) {
    if (/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?(?:youtube\.com|youtu\.be)\//i.test(ytRaw.trim())) {
      ytClean = ytRaw.trim();
    }
  } else if (ytRaw === null) {
    ytClean = null;
  }

  // image_urls is owned by the AI-gen endpoint, NOT routine client pushes.
  // If the client explicitly sent an array, accept it. If absent (undefined)
  // we use COALESCE in the upsert to preserve whatever the server already
  // had — otherwise a stale-Dexie sync push would null out fresh AI URLs.
  // image_count gets the same treatment: if the client doesn't supply it,
  // we keep the server's existing value. This is critical because the AI
  // generation flow updates these two columns directly via SQL, bypassing
  // the client → sync layer.
  const clientSentImageCount = typeof r.image_count === 'number';
  const imageUrlsArr = Array.isArray(r.image_urls) ? r.image_urls as unknown[] : null;
  const clientSentImageUrls = imageUrlsArr !== null;
  const imageUrlsParam = imageUrlsArr !== null
    ? (imageUrlsArr.length > 0 ? imageUrlsArr : null)
    : null; // sentinel: the SQL branch on clientSentImageUrls preserves existing value
  const imageCountParam = clientSentImageCount ? r.image_count : 0;

  await query(
    `INSERT INTO exercises (uuid, everkinetic_id, title, alias, description, primary_muscles, secondary_muscles, equipment, steps, tips, is_custom, is_hidden, movement_pattern, tracking_mode, image_count, youtube_url, image_urls, has_sides, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       title = EXCLUDED.title, alias = EXCLUDED.alias, description = EXCLUDED.description,
       primary_muscles = EXCLUDED.primary_muscles, secondary_muscles = EXCLUDED.secondary_muscles,
       equipment = EXCLUDED.equipment, steps = EXCLUDED.steps, tips = EXCLUDED.tips,
       is_custom = EXCLUDED.is_custom, is_hidden = EXCLUDED.is_hidden,
       movement_pattern = EXCLUDED.movement_pattern,
       tracking_mode = EXCLUDED.tracking_mode,
       image_count = ${clientSentImageCount ? 'EXCLUDED.image_count' : 'exercises.image_count'},
       youtube_url = EXCLUDED.youtube_url,
       image_urls = ${clientSentImageUrls ? 'EXCLUDED.image_urls' : 'exercises.image_urls'},
       has_sides = EXCLUDED.has_sides,
       updated_at = NOW()`,
    [
      String(r.uuid).toLowerCase(), r.everkinetic_id, r.title,
      JSON.stringify(r.alias ?? []), r.description,
      JSON.stringify(r.primary_muscles ?? []), JSON.stringify(r.secondary_muscles ?? []),
      JSON.stringify(r.equipment ?? []), JSON.stringify(r.steps ?? []), JSON.stringify(r.tips ?? []),
      Boolean(r.is_custom), Boolean(r.is_hidden), r.movement_pattern,
      r.tracking_mode ?? 'reps',
      imageCountParam,
      ytClean,
      imageUrlsParam,
      Boolean(r.has_sides),
    ],
  );
}

// ─── Plans / routines ────────────────────────────────────────────────────────

async function pushWorkoutPlan(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM workout_plans WHERE uuid = $1', [r.uuid]);
    return;
  }
  // is_active has a UNIQUE INDEX WHERE is_active = true (migration 006), so
  // setting one plan active means deactivating all others. Do that in a
  // transaction-equivalent: pre-clear if this plan is becoming active.
  if (r.is_active) {
    await query('UPDATE workout_plans SET is_active = false, updated_at = NOW() WHERE is_active = true AND uuid <> $1', [r.uuid]);
  }
  await query(
    `INSERT INTO workout_plans (uuid, title, order_index, is_active, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       title = EXCLUDED.title, order_index = EXCLUDED.order_index,
       is_active = EXCLUDED.is_active, updated_at = NOW()`,
    [r.uuid, r.title, r.order_index ?? 0, Boolean(r.is_active)],
  );
}

async function pushWorkoutRoutine(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM workout_routines WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO workout_routines (uuid, workout_plan_uuid, title, comment, order_index, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       title = EXCLUDED.title, comment = EXCLUDED.comment,
       order_index = EXCLUDED.order_index, updated_at = NOW()`,
    [r.uuid, r.workout_plan_uuid, r.title, r.comment, r.order_index],
  );
}

async function pushWorkoutRoutineExercise(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM workout_routine_exercises WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, comment, order_index, goal_window, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       comment = EXCLUDED.comment, order_index = EXCLUDED.order_index,
       goal_window = EXCLUDED.goal_window, updated_at = NOW()`,
    [r.uuid, r.workout_routine_uuid, String(r.exercise_uuid).toLowerCase(), r.comment, r.order_index, r.goal_window ?? null],
  );
}

async function pushWorkoutRoutineSet(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM workout_routine_sets WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, tag, comment, order_index, target_duration_seconds, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       min_repetitions = EXCLUDED.min_repetitions, max_repetitions = EXCLUDED.max_repetitions,
       tag = EXCLUDED.tag, comment = EXCLUDED.comment,
       order_index = EXCLUDED.order_index,
       target_duration_seconds = EXCLUDED.target_duration_seconds, updated_at = NOW()`,
    [r.uuid, r.workout_routine_exercise_uuid, r.min_repetitions, r.max_repetitions, r.tag, r.comment, r.order_index, r.target_duration_seconds ?? null],
  );
}

// ─── Body ────────────────────────────────────────────────────────────────────

async function pushBodySpec(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM body_spec_logs WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO body_spec_logs (uuid, height_cm, weight_kg, body_fat_pct, lean_mass_kg, notes, measured_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       height_cm = EXCLUDED.height_cm, weight_kg = EXCLUDED.weight_kg,
       body_fat_pct = EXCLUDED.body_fat_pct, lean_mass_kg = EXCLUDED.lean_mass_kg,
       notes = EXCLUDED.notes, measured_at = EXCLUDED.measured_at, updated_at = NOW()`,
    [r.uuid, r.height_cm, r.weight_kg, r.body_fat_pct, r.lean_mass_kg, r.notes, r.measured_at],
  );
}

async function pushMeasurement(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM measurement_logs WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO measurement_logs (uuid, site, value_cm, notes, measured_at, source, source_ref, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       site = EXCLUDED.site, value_cm = EXCLUDED.value_cm,
       notes = EXCLUDED.notes, measured_at = EXCLUDED.measured_at,
       source = EXCLUDED.source, source_ref = EXCLUDED.source_ref, updated_at = NOW()`,
    [r.uuid, r.site, r.value_cm, r.notes, r.measured_at, r.source, r.source_ref],
  );
}

async function pushInbody(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM inbody_scans WHERE uuid = $1', [r.uuid]);
    return;
  }
  // InBody has 50+ columns; pass the entire row as JSONB to a server-side
  // helper that handles upsert column-by-column. Simpler than maintaining
  // a 50-arg SQL string here.
  await query(
    `INSERT INTO inbody_scans (uuid, scanned_at, device, venue, age_at_scan, height_cm,
       weight_kg, total_body_water_l, intracellular_water_l, extracellular_water_l,
       protein_kg, minerals_kg, bone_mineral_kg, body_fat_mass_kg, smm_kg,
       bmi, pbf_pct, whr, inbody_score, visceral_fat_level, bmr_kcal,
       body_cell_mass_kg, ecw_ratio,
       seg_lean_right_arm_kg, seg_lean_right_arm_pct,
       seg_lean_left_arm_kg, seg_lean_left_arm_pct,
       seg_lean_trunk_kg, seg_lean_trunk_pct,
       seg_lean_right_leg_kg, seg_lean_right_leg_pct,
       seg_lean_left_leg_kg, seg_lean_left_leg_pct,
       seg_fat_right_arm_kg, seg_fat_right_arm_pct,
       seg_fat_left_arm_kg, seg_fat_left_arm_pct,
       seg_fat_trunk_kg, seg_fat_trunk_pct,
       seg_fat_right_leg_kg, seg_fat_right_leg_pct,
       seg_fat_left_leg_kg, seg_fat_left_leg_pct,
       circ_neck_cm, circ_chest_cm, circ_abdomen_cm, circ_hip_cm,
       circ_right_arm_cm, circ_left_arm_cm, circ_right_thigh_cm, circ_left_thigh_cm,
       arm_muscle_circumference_cm, soft_lean_mass_kg, fat_free_mass_kg,
       target_weight_kg, weight_control_kg, fat_control_kg, muscle_control_kg,
       balance_upper, balance_lower, balance_upper_lower,
       impedance, notes, raw_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
       $24, $25, $26, $27, $28, $29, $30, $31, $32, $33,
       $34, $35, $36, $37, $38, $39, $40, $41, $42, $43,
       $44, $45, $46, $47, $48, $49, $50, $51,
       $52, $53, $54, $55, $56, $57, $58,
       $59, $60, $61, $62, $63, $64, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       scanned_at = EXCLUDED.scanned_at, device = EXCLUDED.device, venue = EXCLUDED.venue,
       age_at_scan = EXCLUDED.age_at_scan, height_cm = EXCLUDED.height_cm,
       weight_kg = EXCLUDED.weight_kg, total_body_water_l = EXCLUDED.total_body_water_l,
       intracellular_water_l = EXCLUDED.intracellular_water_l, extracellular_water_l = EXCLUDED.extracellular_water_l,
       protein_kg = EXCLUDED.protein_kg, minerals_kg = EXCLUDED.minerals_kg,
       bone_mineral_kg = EXCLUDED.bone_mineral_kg, body_fat_mass_kg = EXCLUDED.body_fat_mass_kg,
       smm_kg = EXCLUDED.smm_kg, bmi = EXCLUDED.bmi, pbf_pct = EXCLUDED.pbf_pct, whr = EXCLUDED.whr,
       inbody_score = EXCLUDED.inbody_score, visceral_fat_level = EXCLUDED.visceral_fat_level,
       bmr_kcal = EXCLUDED.bmr_kcal, body_cell_mass_kg = EXCLUDED.body_cell_mass_kg,
       ecw_ratio = EXCLUDED.ecw_ratio,
       seg_lean_right_arm_kg = EXCLUDED.seg_lean_right_arm_kg, seg_lean_right_arm_pct = EXCLUDED.seg_lean_right_arm_pct,
       seg_lean_left_arm_kg = EXCLUDED.seg_lean_left_arm_kg, seg_lean_left_arm_pct = EXCLUDED.seg_lean_left_arm_pct,
       seg_lean_trunk_kg = EXCLUDED.seg_lean_trunk_kg, seg_lean_trunk_pct = EXCLUDED.seg_lean_trunk_pct,
       seg_lean_right_leg_kg = EXCLUDED.seg_lean_right_leg_kg, seg_lean_right_leg_pct = EXCLUDED.seg_lean_right_leg_pct,
       seg_lean_left_leg_kg = EXCLUDED.seg_lean_left_leg_kg, seg_lean_left_leg_pct = EXCLUDED.seg_lean_left_leg_pct,
       seg_fat_right_arm_kg = EXCLUDED.seg_fat_right_arm_kg, seg_fat_right_arm_pct = EXCLUDED.seg_fat_right_arm_pct,
       seg_fat_left_arm_kg = EXCLUDED.seg_fat_left_arm_kg, seg_fat_left_arm_pct = EXCLUDED.seg_fat_left_arm_pct,
       seg_fat_trunk_kg = EXCLUDED.seg_fat_trunk_kg, seg_fat_trunk_pct = EXCLUDED.seg_fat_trunk_pct,
       seg_fat_right_leg_kg = EXCLUDED.seg_fat_right_leg_kg, seg_fat_right_leg_pct = EXCLUDED.seg_fat_right_leg_pct,
       seg_fat_left_leg_kg = EXCLUDED.seg_fat_left_leg_kg, seg_fat_left_leg_pct = EXCLUDED.seg_fat_left_leg_pct,
       circ_neck_cm = EXCLUDED.circ_neck_cm, circ_chest_cm = EXCLUDED.circ_chest_cm,
       circ_abdomen_cm = EXCLUDED.circ_abdomen_cm, circ_hip_cm = EXCLUDED.circ_hip_cm,
       circ_right_arm_cm = EXCLUDED.circ_right_arm_cm, circ_left_arm_cm = EXCLUDED.circ_left_arm_cm,
       circ_right_thigh_cm = EXCLUDED.circ_right_thigh_cm, circ_left_thigh_cm = EXCLUDED.circ_left_thigh_cm,
       arm_muscle_circumference_cm = EXCLUDED.arm_muscle_circumference_cm,
       soft_lean_mass_kg = EXCLUDED.soft_lean_mass_kg, fat_free_mass_kg = EXCLUDED.fat_free_mass_kg,
       target_weight_kg = EXCLUDED.target_weight_kg, weight_control_kg = EXCLUDED.weight_control_kg,
       fat_control_kg = EXCLUDED.fat_control_kg, muscle_control_kg = EXCLUDED.muscle_control_kg,
       balance_upper = EXCLUDED.balance_upper, balance_lower = EXCLUDED.balance_lower,
       balance_upper_lower = EXCLUDED.balance_upper_lower,
       impedance = EXCLUDED.impedance, notes = EXCLUDED.notes, raw_json = EXCLUDED.raw_json,
       updated_at = NOW()`,
    [
      r.uuid, r.scanned_at, r.device ?? 'InBody 570', r.venue, r.age_at_scan, r.height_cm,
      r.weight_kg, r.total_body_water_l, r.intracellular_water_l, r.extracellular_water_l,
      r.protein_kg, r.minerals_kg, r.bone_mineral_kg, r.body_fat_mass_kg, r.smm_kg,
      r.bmi, r.pbf_pct, r.whr, r.inbody_score, r.visceral_fat_level, r.bmr_kcal,
      r.body_cell_mass_kg, r.ecw_ratio,
      r.seg_lean_right_arm_kg, r.seg_lean_right_arm_pct,
      r.seg_lean_left_arm_kg, r.seg_lean_left_arm_pct,
      r.seg_lean_trunk_kg, r.seg_lean_trunk_pct,
      r.seg_lean_right_leg_kg, r.seg_lean_right_leg_pct,
      r.seg_lean_left_leg_kg, r.seg_lean_left_leg_pct,
      r.seg_fat_right_arm_kg, r.seg_fat_right_arm_pct,
      r.seg_fat_left_arm_kg, r.seg_fat_left_arm_pct,
      r.seg_fat_trunk_kg, r.seg_fat_trunk_pct,
      r.seg_fat_right_leg_kg, r.seg_fat_right_leg_pct,
      r.seg_fat_left_leg_kg, r.seg_fat_left_leg_pct,
      r.circ_neck_cm, r.circ_chest_cm, r.circ_abdomen_cm, r.circ_hip_cm,
      r.circ_right_arm_cm, r.circ_left_arm_cm, r.circ_right_thigh_cm, r.circ_left_thigh_cm,
      r.arm_muscle_circumference_cm, r.soft_lean_mass_kg, r.fat_free_mass_kg,
      r.target_weight_kg, r.weight_control_kg, r.fat_control_kg, r.muscle_control_kg,
      r.balance_upper, r.balance_lower, r.balance_upper_lower,
      JSON.stringify(r.impedance ?? {}), r.notes, JSON.stringify(r.raw_json ?? {}),
    ],
  );
}

async function pushBodyGoal(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM body_goals WHERE metric_key = $1', [r.metric_key]);
    return;
  }
  await query(
    `INSERT INTO body_goals (metric_key, target_value, unit, direction, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (metric_key) DO UPDATE SET
       target_value = EXCLUDED.target_value, unit = EXCLUDED.unit,
       direction = EXCLUDED.direction, notes = EXCLUDED.notes, updated_at = NOW()`,
    [r.metric_key, r.target_value, r.unit, r.direction, r.notes],
  );
}

// ─── Strategic layer ─────────────────────────────────────────────────────────

const VISION_STATUSES = new Set(['active', 'archived']);
function sanitizeVisionStatus(v: unknown): string {
  return typeof v === 'string' && VISION_STATUSES.has(v) ? v : 'active';
}

const PLAN_STATUSES = new Set(['active', 'archived', 'superseded']);
function sanitizePlanStatus(v: unknown): string {
  return typeof v === 'string' && PLAN_STATUSES.has(v) ? v : 'active';
}

const CHECKPOINT_STATUSES = new Set(['scheduled', 'completed']);
function sanitizeCheckpointStatus(v: unknown): string {
  return typeof v === 'string' && CHECKPOINT_STATUSES.has(v) ? v : 'scheduled';
}

const CHECKPOINT_ASSESSMENTS = new Set(['on_track', 'ahead', 'behind', 'reset_required']);
function sanitizeCheckpointAssessment(v: unknown): string | null {
  return typeof v === 'string' && CHECKPOINT_ASSESSMENTS.has(v) ? v : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(x => typeof x === 'string') as string[] : [];
}

async function pushBodyVision(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM body_vision WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO body_vision (uuid, title, body_md, summary, principles, build_emphasis,
                              maintain_emphasis, deemphasize, status, archived_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       title = EXCLUDED.title, body_md = EXCLUDED.body_md, summary = EXCLUDED.summary,
       principles = EXCLUDED.principles, build_emphasis = EXCLUDED.build_emphasis,
       maintain_emphasis = EXCLUDED.maintain_emphasis, deemphasize = EXCLUDED.deemphasize,
       status = EXCLUDED.status, archived_at = EXCLUDED.archived_at, updated_at = NOW()`,
    [
      r.uuid, r.title, r.body_md ?? null, r.summary ?? null,
      asStringArray(r.principles), asStringArray(r.build_emphasis),
      asStringArray(r.maintain_emphasis), asStringArray(r.deemphasize),
      sanitizeVisionStatus(r.status), r.archived_at ?? null,
    ],
  );
}

async function pushBodyPlan(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM body_plan WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO body_plan (uuid, vision_id, title, summary, body_md, horizon_months,
                            start_date, target_date, north_star_metrics, programming_dose,
                            nutrition_anchors, reevaluation_triggers, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       vision_id = EXCLUDED.vision_id, title = EXCLUDED.title, summary = EXCLUDED.summary,
       body_md = EXCLUDED.body_md, horizon_months = EXCLUDED.horizon_months,
       start_date = EXCLUDED.start_date, target_date = EXCLUDED.target_date,
       north_star_metrics = EXCLUDED.north_star_metrics,
       programming_dose = EXCLUDED.programming_dose,
       nutrition_anchors = EXCLUDED.nutrition_anchors,
       reevaluation_triggers = EXCLUDED.reevaluation_triggers,
       status = EXCLUDED.status, updated_at = NOW()`,
    [
      r.uuid, r.vision_id, r.title, r.summary ?? null, r.body_md ?? null,
      r.horizon_months, r.start_date, r.target_date,
      JSON.stringify(r.north_star_metrics ?? []),
      JSON.stringify(r.programming_dose ?? {}),
      JSON.stringify(r.nutrition_anchors ?? {}),
      asStringArray(r.reevaluation_triggers),
      sanitizePlanStatus(r.status),
    ],
  );
}

async function pushPlanCheckpoint(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM plan_checkpoint WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO plan_checkpoint (uuid, plan_id, quarter_label, target_date, review_date,
                                  status, metrics_snapshot, assessment, notes, adjustments_made, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       quarter_label = EXCLUDED.quarter_label, target_date = EXCLUDED.target_date,
       review_date = EXCLUDED.review_date, status = EXCLUDED.status,
       metrics_snapshot = EXCLUDED.metrics_snapshot, assessment = EXCLUDED.assessment,
       notes = EXCLUDED.notes, adjustments_made = EXCLUDED.adjustments_made, updated_at = NOW()`,
    [
      r.uuid, r.plan_id, r.quarter_label, r.target_date, r.review_date ?? null,
      sanitizeCheckpointStatus(r.status),
      r.metrics_snapshot == null ? null : JSON.stringify(r.metrics_snapshot),
      sanitizeCheckpointAssessment(r.assessment),
      r.notes ?? null, asStringArray(r.adjustments_made),
    ],
  );
}

// ─── Nutrition ───────────────────────────────────────────────────────────────

// Whitelist for nutrition_logs.status — rejects unexpected enum values from
// untrusted client payloads.
const NUTRITION_LOG_STATUSES = new Set(['planned', 'deviation', 'added']);
function sanitizeLogStatus(v: unknown): string | null {
  return typeof v === 'string' && NUTRITION_LOG_STATUSES.has(v) ? v : null;
}

async function pushNutritionLog(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM nutrition_logs WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO nutrition_logs (uuid, logged_at, meal_type, meal_name, calories, protein_g, carbs_g, fat_g, notes, template_meal_id, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       logged_at = EXCLUDED.logged_at, meal_type = EXCLUDED.meal_type,
       meal_name = EXCLUDED.meal_name,
       calories = EXCLUDED.calories, protein_g = EXCLUDED.protein_g,
       carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
       notes = EXCLUDED.notes, template_meal_id = EXCLUDED.template_meal_id,
       status = EXCLUDED.status, updated_at = NOW()`,
    [
      r.uuid, r.logged_at, r.meal_type, r.meal_name ?? null,
      r.calories, r.protein_g, r.carbs_g, r.fat_g, r.notes,
      r.template_meal_id ?? null, sanitizeLogStatus(r.status),
    ],
  );
}

// Whitelist for nutrition_week_meals.meal_slot — matches the CHECK constraint
// added in migration 036. Pre-036 rows arriving from a stale client get
// normalized so the constraint doesn't reject the push.
const NUTRITION_WEEK_MEAL_SLOTS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
function sanitizeMealSlot(v: unknown): string {
  if (typeof v !== 'string') return 'snack';
  const lower = v.toLowerCase();
  if (NUTRITION_WEEK_MEAL_SLOTS.has(lower)) return lower;
  if (lower.includes('breakfast')) return 'breakfast';
  if (lower.includes('lunch')) return 'lunch';
  if (lower.includes('dinner')) return 'dinner';
  return 'snack';
}

async function pushNutritionWeekMeal(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM nutrition_week_meals WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO nutrition_week_meals (uuid, day_of_week, meal_slot, meal_name, protein_g, carbs_g, fat_g, calories, quality_rating, sort_order, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       day_of_week = EXCLUDED.day_of_week, meal_slot = EXCLUDED.meal_slot,
       meal_name = EXCLUDED.meal_name, protein_g = EXCLUDED.protein_g,
       carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
       calories = EXCLUDED.calories, quality_rating = EXCLUDED.quality_rating,
       sort_order = EXCLUDED.sort_order, updated_at = NOW()`,
    [
      r.uuid, r.day_of_week, sanitizeMealSlot(r.meal_slot), r.meal_name,
      r.protein_g, r.carbs_g ?? null, r.fat_g ?? null,
      r.calories, r.quality_rating, r.sort_order,
    ],
  );
}

const APPROVED_STATUSES = new Set(['pending', 'approved']);
function sanitizeApprovedStatus(v: unknown): string {
  return typeof v === 'string' && APPROVED_STATUSES.has(v) ? v : 'pending';
}

async function pushNutritionDayNote(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM nutrition_day_notes WHERE uuid = $1', [r.uuid]);
    return;
  }
  // Conflict on `date` (the natural key) so an MCP-created row and a Dexie-
  // created row for the same calendar day merge instead of throwing on the
  // date UNIQUE constraint. The row's uuid is preserved on UPDATE.
  await query(
    `INSERT INTO nutrition_day_notes (uuid, date, hydration_ml, notes, approved_status, approved_at, template_applied_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (date) DO UPDATE SET
       hydration_ml = EXCLUDED.hydration_ml,
       notes = EXCLUDED.notes,
       approved_status = EXCLUDED.approved_status,
       approved_at = EXCLUDED.approved_at,
       template_applied_at = COALESCE(EXCLUDED.template_applied_at, nutrition_day_notes.template_applied_at),
       updated_at = NOW()`,
    [
      r.uuid, r.date, r.hydration_ml, r.notes,
      sanitizeApprovedStatus(r.approved_status),
      r.approved_at ?? null,
      r.template_applied_at ?? null,
    ],
  );
}

async function pushNutritionTargets(r: Record<string, unknown>): Promise<void> {
  // Singleton — id=1. _deleted means reset to all-null.
  await query(
    `INSERT INTO nutrition_targets (id, calories, protein_g, carbs_g, fat_g, bands, updated_at)
     VALUES (1, $1, $2, $3, $4, $5::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       calories = EXCLUDED.calories, protein_g = EXCLUDED.protein_g,
       carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
       bands = EXCLUDED.bands, updated_at = NOW()`,
    [
      r.calories, r.protein_g, r.carbs_g, r.fat_g,
      r.bands == null ? null : JSON.stringify(r.bands),
    ],
  );
}

// ─── HRT timeline + Labs ─────────────────────────────────────────────────────

async function pushHrtTimelinePeriod(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM hrt_timeline_periods WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO hrt_timeline_periods (uuid, name, started_at, ended_at, doses_e, doses_t_blocker, doses_other, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       name = EXCLUDED.name, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
       doses_e = EXCLUDED.doses_e, doses_t_blocker = EXCLUDED.doses_t_blocker,
       doses_other = EXCLUDED.doses_other, notes = EXCLUDED.notes, updated_at = NOW()`,
    [
      r.uuid, r.name, r.started_at, r.ended_at,
      r.doses_e, r.doses_t_blocker,
      JSON.stringify(r.doses_other ?? []),
      r.notes,
    ],
  );
}

async function pushLabDraw(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    // FK CASCADE removes any lab_results pointing at this draw — but they
    // also push their own _deleted tombstones, which become DELETE-no-ops.
    await query('DELETE FROM lab_draws WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO lab_draws (uuid, drawn_at, notes, source, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       drawn_at = EXCLUDED.drawn_at, notes = EXCLUDED.notes,
       source = EXCLUDED.source, updated_at = NOW()`,
    [r.uuid, r.drawn_at, r.notes, r.source ?? 'manual'],
  );
}

async function pushLabResult(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM lab_results WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO lab_results (uuid, draw_uuid, lab_code, value, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       draw_uuid = EXCLUDED.draw_uuid, lab_code = EXCLUDED.lab_code,
       value = EXCLUDED.value, updated_at = NOW()`,
    [r.uuid, r.draw_uuid, r.lab_code, r.value],
  );
}

// ─── Wellbeing / dysphoria / clothes ─────────────────────────────────────────

async function pushWellbeing(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM wellbeing_logs WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO wellbeing_logs (uuid, logged_at, mood, energy, sleep_hours, sleep_quality, stress, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       logged_at = EXCLUDED.logged_at, mood = EXCLUDED.mood, energy = EXCLUDED.energy,
       sleep_hours = EXCLUDED.sleep_hours, sleep_quality = EXCLUDED.sleep_quality,
       stress = EXCLUDED.stress, notes = EXCLUDED.notes, updated_at = NOW()`,
    [r.uuid, r.logged_at, r.mood, r.energy, r.sleep_hours, r.sleep_quality, r.stress, r.notes],
  );
}

async function pushDysphoria(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM dysphoria_logs WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO dysphoria_logs (uuid, logged_at, scale, note, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       logged_at = EXCLUDED.logged_at, scale = EXCLUDED.scale,
       note = EXCLUDED.note, updated_at = NOW()`,
    [r.uuid, r.logged_at, r.scale, r.note],
  );
}

async function pushClothesTest(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM clothes_test_logs WHERE uuid = $1', [r.uuid]);
    return;
  }
  await query(
    `INSERT INTO clothes_test_logs (uuid, logged_at, outfit_description, photo_url, comfort_rating, euphoria_rating, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       logged_at = EXCLUDED.logged_at, outfit_description = EXCLUDED.outfit_description,
       photo_url = EXCLUDED.photo_url, comfort_rating = EXCLUDED.comfort_rating,
       euphoria_rating = EXCLUDED.euphoria_rating, notes = EXCLUDED.notes, updated_at = NOW()`,
    [r.uuid, r.logged_at, r.outfit_description, r.photo_url, r.comfort_rating, r.euphoria_rating, r.notes],
  );
}

// ─── Photos ──────────────────────────────────────────────────────────────────

async function pushProgressPhoto(r: Record<string, unknown>): Promise<void> {
  if (r._deleted) {
    await query('DELETE FROM progress_photos WHERE uuid = $1', [r.uuid]);
    return;
  }
  // Note: progress_photos.blob is not part of sync push — JPEGs go through
  // /api/progress-photos/upload separately. Push only carries metadata
  // (URL pointer, pose, notes, taken_at) once the upload is complete.
  //
  // INVARIANT: mask_url is server-owned cache (set by POST .../mask via the
  // silhouette pipeline). Do NOT add it to the SET list below — a stale
  // client push would null a freshly-cached mask. New rows get NULL by
  // Postgres default, which is the right empty state.
  await query(
    `INSERT INTO progress_photos (uuid, blob_url, pose, notes, taken_at, crop_offset_y, crop_offset_x, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (uuid) DO UPDATE SET
       blob_url = EXCLUDED.blob_url, pose = EXCLUDED.pose,
       notes = EXCLUDED.notes, taken_at = EXCLUDED.taken_at,
       crop_offset_y = EXCLUDED.crop_offset_y,
       crop_offset_x = EXCLUDED.crop_offset_x,
       updated_at = NOW()`,
    [r.uuid, r.blob_url, r.pose, r.notes, r.taken_at, r.crop_offset_y ?? null, r.crop_offset_x ?? null],
  );
}
