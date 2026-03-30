/**
 * POST /api/import
 *
 * Accepts an Iron JSON export (array of workouts or { workouts: [...] }) and
 * imports them into the Rebirth database. Idempotent: workouts that already
 * exist (same UUID) are skipped.
 *
 * Uses batched multi-row INSERTs to minimise round-trips to the database.
 *
 * Returns:
 *   { imported: number, skipped: number, errors: string[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/db';
import { randomUUID } from 'crypto';

interface NormalisedSet {
  uuid: string;
  workout_exercise_uuid: string;
  weight: number | null;
  repetitions: number | null;
  rpe: number | null;
  tag: string | null;
  is_completed: boolean;
  order_index: number;
}

interface NormalisedExercise {
  uuid: string;
  workout_uuid: string;
  exercise_ref: { uuid: string; title: string };
  order_index: number;
  sets: NormalisedSet[];
}

interface NormalisedWorkout {
  uuid: string;
  start_time: string;
  end_time: string | null;
  title: string | null;
  comment: string | null;
  exercises: NormalisedExercise[];
}

function normalise(raw: unknown): NormalisedWorkout | null {
  const r = raw as Record<string, unknown>;
  const uuid = String(r.uuid ?? '');
  const start_time = String(r.start_time ?? r.start ?? '');
  if (!uuid || !start_time) return null;

  const workoutUuid = uuid;
  const exercises = (Array.isArray(r.exercises) ? r.exercises : []).map(
    (ex: Record<string, unknown>, i: number) => {
      const weUuid = String(ex.uuid ?? randomUUID());
      return {
        uuid: weUuid,
        workout_uuid: workoutUuid,
        exercise_ref: {
          uuid: String(ex.exercise_uuid ?? ex.exerciseUuid ?? ''),
          title: String(ex.exercise_title ?? ex.exerciseName ?? 'Unknown'),
        },
        order_index: (ex.order_index as number) ?? i,
        sets: (Array.isArray(ex.sets) ? ex.sets : []).map(
          (s: Record<string, unknown>, j: number) => {
            const rawTag = String(s.tag ?? '');
            const tag = rawTag === 'dropSet' || rawTag === 'failure' ? rawTag : null;
            return {
              uuid: String(s.uuid ?? randomUUID()),
              workout_exercise_uuid: weUuid,
              weight: (s.weight ?? null) as number | null,
              repetitions: (s.repetitions ?? null) as number | null,
              rpe: (s.rpe ?? null) as number | null,
              tag,
              is_completed: (s.is_completed ?? true) as boolean,
              order_index: (s.order_index as number) ?? j,
            };
          }
        ),
      };
    }
  );

  return {
    uuid,
    start_time,
    end_time: (r.end_time ?? r.end ?? null) as string | null,
    title: (r.title ?? null) as string | null,
    comment: (r.comment ?? null) as string | null,
    exercises,
  };
}

/** Build a multi-row INSERT with numbered $-params and execute it. */
async function batchInsert(
  table: string,
  columns: string[],
  rows: unknown[][],
) {
  if (rows.length === 0) return;
  const colCount = columns.length;
  // Process in chunks of ~500 rows to stay well within the 65535 param limit
  const chunkSize = Math.floor(65000 / colCount);
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const placeholders = chunk.map((row, ri) => {
      const base = ri * colCount;
      row.forEach((v) => values.push(v));
      return `(${columns.map((_, ci) => `$${base + ci + 1}`).join(',')})`;
    });
    await query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`,
      values,
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  let rawWorkouts: unknown[];
  if (Array.isArray(body)) {
    rawWorkouts = body;
  } else if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).workouts)) {
    rawWorkouts = (body as Record<string, unknown>).workouts as unknown[];
  } else {
    return NextResponse.json(
      { error: 'Expected a JSON array of workouts or { workouts: [...] }' },
      { status: 400 },
    );
  }

  // 1. Normalise all workouts
  const errors: string[] = [];
  const workouts: NormalisedWorkout[] = [];
  for (const raw of rawWorkouts) {
    const w = normalise(raw);
    if (!w) {
      errors.push('Workout missing uuid or start_time — skipped');
      continue;
    }
    workouts.push(w);
  }

  if (workouts.length === 0) {
    return NextResponse.json({ imported: 0, skipped: rawWorkouts.length, errors });
  }

  // 2. Batch-check which workout UUIDs already exist
  const allUuids = workouts.map((w) => w.uuid);
  const existingRows = await query<{ uuid: string }>(
    `SELECT uuid FROM workouts WHERE uuid = ANY($1)`,
    [allUuids],
  );
  const existingSet = new Set(existingRows.map((r) => r.uuid));
  const newWorkouts = workouts.filter((w) => !existingSet.has(w.uuid));
  const skipped = workouts.length - newWorkouts.length;

  if (newWorkouts.length === 0) {
    return NextResponse.json({ imported: 0, skipped: skipped + errors.length, errors });
  }

  // 3. Resolve exercise references: collect unique (uuid, title) pairs
  const exerciseRefs = new Map<string, string>(); // refKey → resolved uuid
  const allExRefs: { uuid: string; title: string }[] = [];
  for (const w of newWorkouts) {
    for (const ex of w.exercises) {
      const key = `${ex.exercise_ref.uuid}||${ex.exercise_ref.title}`;
      if (!exerciseRefs.has(key)) {
        exerciseRefs.set(key, ''); // placeholder
        allExRefs.push(ex.exercise_ref);
      }
    }
  }

  // Batch-lookup by UUID
  const refUuids = allExRefs.map((r) => r.uuid).filter(Boolean);
  const refTitles = allExRefs.map((r) => r.title).filter(Boolean);

  const [byUuid, byTitle] = await Promise.all([
    refUuids.length > 0
      ? query<{ uuid: string }>(`SELECT uuid FROM exercises WHERE uuid = ANY($1)`, [refUuids])
      : Promise.resolve([]),
    refTitles.length > 0
      ? query<{ uuid: string; title: string; is_custom: boolean }>(
          `SELECT uuid, title, is_custom FROM exercises WHERE LOWER(title) = ANY($1) AND is_hidden = false ORDER BY is_custom ASC`,
          [refTitles.map((t) => t.toLowerCase())],
        )
      : Promise.resolve([]),
  ]);

  const knownByUuid = new Set(byUuid.map((r) => r.uuid));
  // Build title→uuid map; catalog (is_custom=false) exercises come first so they win
  const titleToUuid = new Map<string, string>();
  for (const r of byTitle) {
    const key = r.title.toLowerCase();
    if (!titleToUuid.has(key)) titleToUuid.set(key, r.uuid);
  }

  // Resolve each ref and collect exercises that need creation
  const newExercises: unknown[][] = [];
  for (const ref of allExRefs) {
    const key = `${ref.uuid}||${ref.title}`;
    if (ref.uuid && knownByUuid.has(ref.uuid)) {
      exerciseRefs.set(key, ref.uuid);
    } else if (titleToUuid.has(ref.title.toLowerCase())) {
      exerciseRefs.set(key, titleToUuid.get(ref.title.toLowerCase())!);
    } else {
      // Create new custom exercise
      const newUuid = randomUUID();
      exerciseRefs.set(key, newUuid);
      knownByUuid.add(newUuid); // prevent duplicates within same import
      titleToUuid.set(ref.title.toLowerCase(), newUuid);
      newExercises.push([
        newUuid,
        20000 + Math.floor(Math.random() * 1000000),
        ref.title,
        '[]', '[]', '[]', '[]', '[]', '[]',
        true,
      ]);
    }
  }

  // 4. Batch-insert new exercises
  await batchInsert(
    'exercises',
    ['uuid', 'everkinetic_id', 'title', 'alias', 'primary_muscles', 'secondary_muscles', 'equipment', 'steps', 'tips', 'is_custom'],
    newExercises,
  );

  // 5. Batch-insert workouts
  const workoutRows = newWorkouts.map((w) => [
    w.uuid, w.start_time, w.end_time, w.title, w.comment, false,
  ]);
  await batchInsert(
    'workouts',
    ['uuid', 'start_time', 'end_time', 'title', 'comment', 'is_current'],
    workoutRows,
  );

  // 6. Batch-insert workout_exercises
  const weRows: unknown[][] = [];
  for (const w of newWorkouts) {
    for (const ex of w.exercises) {
      const key = `${ex.exercise_ref.uuid}||${ex.exercise_ref.title}`;
      const resolvedUuid = exerciseRefs.get(key)!;
      weRows.push([ex.uuid, w.uuid, resolvedUuid, ex.order_index]);
    }
  }
  await batchInsert(
    'workout_exercises',
    ['uuid', 'workout_uuid', 'exercise_uuid', 'order_index'],
    weRows,
  );

  // 7. Batch-insert workout_sets
  const setRows: unknown[][] = [];
  for (const w of newWorkouts) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        setRows.push([
          s.uuid, s.workout_exercise_uuid, s.weight, s.repetitions,
          s.rpe, s.tag, s.is_completed, s.order_index,
        ]);
      }
    }
  }
  await batchInsert(
    'workout_sets',
    ['uuid', 'workout_exercise_uuid', 'weight', 'repetitions', 'rpe', 'tag', 'is_completed', 'order_index'],
    setRows,
  );

  return NextResponse.json({ imported: newWorkouts.length, skipped: skipped + errors.length, errors });
}
