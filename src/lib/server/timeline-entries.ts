import { query } from '@/db/db';

export type TimelineModule =
  | 'workout'
  | 'nutrition'
  | 'hrt'
  | 'measurement'
  | 'wellbeing'
  | 'photo'
  | 'bodyweight'
  | 'body_spec'
  | 'inbody_scan'
  | 'dysphoria';

export interface TimelineEntry {
  id: string;
  module: TimelineModule;
  icon: string;
  timestamp: string;
  summary: string;
}

export async function getTimelineEntries(days: number, limit: number): Promise<TimelineEntry[]> {
  const d = Math.min(days, 90);
  const lim = Math.min(limit, 200);

  const since = new Date();
  since.setDate(since.getDate() - d);
  const sinceIso = since.toISOString();

  const [
    workoutRows,
    nutritionRows,
    hrtRows,
    measurementRows,
    wellbeingRows,
    photoRows,
    bodyweightRows,
    bodySpecRows,
    inbodyRows,
    dysphoriaRows,
  ] = await Promise.all([
    query<{ uuid: string; start_time: string; title: string | null; exercise_count: number }>(
      `SELECT w.uuid, w.start_time, w.title,
        COUNT(DISTINCT we.uuid)::int AS exercise_count
       FROM workouts w
       LEFT JOIN workout_exercises we ON we.workout_uuid = w.uuid
       WHERE w.end_time IS NOT NULL AND w.is_current = false
         AND w.start_time >= $1
       GROUP BY w.uuid
       ORDER BY w.start_time DESC`,
      [sinceIso]
    ),
    query<{ uuid: string; logged_at: string; meal_name: string | null; meal_type: string | null; calories: number | null; protein_g: number | null }>(
      `SELECT uuid, logged_at, meal_name, meal_type, calories, protein_g
       FROM nutrition_logs WHERE logged_at >= $1 ORDER BY logged_at DESC`,
      [sinceIso]
    ),
    query<{ uuid: string; started_at: string; ended_at: string | null; name: string; doses_e: string | null }>(
      // Period-based timeline now (migration 020 dropped per-dose hrt_logs).
      // Each period yields ONE entry on the activity timeline at its
      // started_at date — the "began protocol X" event.
      `SELECT uuid, started_at, ended_at, name, doses_e
       FROM hrt_timeline_periods WHERE started_at >= $1 ORDER BY started_at DESC`,
      [sinceIso.slice(0, 10)]
    ),
    query<{ uuid: string; measured_at: string; site: string; value_cm: number }>(
      `SELECT uuid, measured_at, site, value_cm
       FROM measurement_logs WHERE measured_at >= $1 ORDER BY measured_at DESC`,
      [sinceIso]
    ),
    query<{ uuid: string; logged_at: string; mood: number | null; energy: number | null; sleep_hours: number | null }>(
      `SELECT uuid, logged_at, mood, energy, sleep_hours
       FROM wellbeing_logs WHERE logged_at >= $1 ORDER BY logged_at DESC`,
      [sinceIso]
    ),
    query<{ uuid: string; taken_at: string; pose: string }>(
      `SELECT uuid, taken_at, pose
       FROM progress_photos WHERE taken_at >= $1 ORDER BY taken_at DESC`,
      [sinceIso]
    ),
    query<{ uuid: string; logged_at: string; weight_kg: number }>(
      `SELECT uuid, logged_at, weight_kg
       FROM bodyweight_logs WHERE logged_at >= $1 ORDER BY logged_at DESC`,
      [sinceIso]
    ),
    query<{ uuid: string; measured_at: string; weight_kg: number | null; body_fat_pct: number | null }>(
      `SELECT uuid, measured_at, weight_kg, body_fat_pct
       FROM body_spec_logs WHERE measured_at >= $1 ORDER BY measured_at DESC`,
      [sinceIso]
    ),
    query<{ uuid: string; scanned_at: string; inbody_score: number | null; weight_kg: number | null; pbf_pct: number | null; smm_kg: number | null }>(
      `SELECT uuid, scanned_at, inbody_score, weight_kg, pbf_pct, smm_kg
       FROM inbody_scans WHERE scanned_at >= $1 ORDER BY scanned_at DESC`,
      [sinceIso]
    ),
    query<{ uuid: string; logged_at: string; scale: number }>(
      `SELECT uuid, logged_at, scale
       FROM dysphoria_logs WHERE logged_at >= $1 ORDER BY logged_at DESC`,
      [sinceIso]
    ),
  ]);

  const entries: TimelineEntry[] = [];

  for (const w of workoutRows) {
    const ex = w.exercise_count;
    entries.push({
      id: w.uuid,
      module: 'workout',
      icon: 'dumbbell',
      timestamp: w.start_time,
      summary: w.title
        ? `${w.title} · ${ex} exercise${ex !== 1 ? 's' : ''}`
        : `Workout · ${ex} exercise${ex !== 1 ? 's' : ''}`,
    });
  }

  for (const n of nutritionRows) {
    const name = n.meal_name ?? n.meal_type ?? 'Meal';
    const parts = [];
    if (n.calories) parts.push(`${Math.round(n.calories)} kcal`);
    if (n.protein_g) parts.push(`${Math.round(n.protein_g)}g protein`);
    entries.push({
      id: n.uuid,
      module: 'nutrition',
      icon: 'utensils',
      timestamp: n.logged_at,
      summary: parts.length ? `${name} · ${parts.join(', ')}` : name,
    });
  }

  for (const h of hrtRows) {
    const dose = h.doses_e ? ` · ${h.doses_e}` : '';
    entries.push({
      id: h.uuid,
      module: 'hrt',
      icon: 'pill',
      // Treat the period start as the timeline event timestamp. Convert
      // YYYY-MM-DD → ISO so the global sort with workouts/etc still works.
      timestamp: new Date(h.started_at + 'T00:00:00Z').toISOString(),
      summary: `Protocol started: ${h.name}${dose}`,
    });
  }

  for (const m of measurementRows) {
    entries.push({
      id: m.uuid,
      module: 'measurement',
      icon: 'ruler',
      timestamp: m.measured_at,
      summary: `${m.site.replace(/_/g, ' ')} · ${m.value_cm} cm`,
    });
  }

  for (const wb of wellbeingRows) {
    const parts = [];
    if (wb.mood != null) parts.push(`mood ${wb.mood}/10`);
    if (wb.energy != null) parts.push(`energy ${wb.energy}/10`);
    if (wb.sleep_hours != null) parts.push(`${wb.sleep_hours}h sleep`);
    entries.push({
      id: wb.uuid,
      module: 'wellbeing',
      icon: 'heart',
      timestamp: wb.logged_at,
      summary: parts.length ? `Wellbeing · ${parts.join(', ')}` : 'Wellbeing check-in',
    });
  }

  for (const p of photoRows) {
    entries.push({
      id: p.uuid,
      module: 'photo',
      icon: 'camera',
      timestamp: p.taken_at,
      summary: `Progress photo · ${p.pose}`,
    });
  }

  for (const bw of bodyweightRows) {
    entries.push({
      id: bw.uuid,
      module: 'bodyweight',
      icon: 'scale',
      timestamp: bw.logged_at,
      summary: `Bodyweight · ${bw.weight_kg} kg`,
    });
  }

  for (const bs of bodySpecRows) {
    const parts = [];
    if (bs.weight_kg != null) parts.push(`${bs.weight_kg} kg`);
    if (bs.body_fat_pct != null) parts.push(`${bs.body_fat_pct}% body fat`);
    entries.push({
      id: bs.uuid,
      module: 'body_spec',
      icon: 'activity',
      timestamp: bs.measured_at,
      summary: parts.length ? `Body scan · ${parts.join(', ')}` : 'Body scan',
    });
  }

  for (const ib of inbodyRows) {
    const parts: string[] = [];
    if (ib.inbody_score != null) parts.push(`score ${ib.inbody_score}`);
    if (ib.weight_kg != null) parts.push(`${ib.weight_kg} kg`);
    if (ib.pbf_pct != null) parts.push(`${ib.pbf_pct}% BF`);
    if (ib.smm_kg != null) parts.push(`${ib.smm_kg} kg SMM`);
    entries.push({
      id: ib.uuid,
      module: 'inbody_scan',
      icon: 'activity',
      timestamp: ib.scanned_at,
      summary: parts.length ? `InBody scan · ${parts.join(', ')}` : 'InBody scan',
    });
  }

  for (const dy of dysphoriaRows) {
    const label = dy.scale >= 7 ? 'euphoric' : dy.scale <= 3 ? 'dysphoric' : 'neutral';
    entries.push({
      id: dy.uuid,
      module: 'dysphoria',
      icon: 'sparkles',
      timestamp: dy.logged_at,
      summary: `Dysphoria check · ${dy.scale}/10 (${label})`,
    });
  }

  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return entries.slice(0, lim);
}
