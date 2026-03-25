/**
 * POST /api/import
 *
 * Accepts an Iron JSON export (array of workouts or { workouts: [...] }) and
 * imports them into the Rebirth database. Idempotent: workouts that already
 * exist (same UUID) are skipped.
 *
 * Returns:
 *   { imported: number, skipped: number, errors: string[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/db/db';
import { randomUUID } from 'crypto';

interface ImportSet {
  uuid?: string;
  order_index: number;
  weight?: number | null;
  repetitions?: number | null;
  rpe?: number | null;
  tag?: string | null;
  is_completed?: boolean;
}

interface ImportExercise {
  uuid?: string;
  exercise_uuid: string;
  exercise_title: string;
  order_index: number;
  sets: ImportSet[];
}

interface ImportWorkout {
  uuid: string;
  start_time: string;
  end_time?: string | null;
  title?: string | null;
  comment?: string | null;
  exercises: ImportExercise[];
}

async function resolveExerciseUuid(exerciseUuid: string, exerciseTitle: string): Promise<string> {
  // 1. Try exact UUID match
  const byUuid = await queryOne<{ uuid: string }>(
    'SELECT uuid FROM exercises WHERE uuid = $1',
    [exerciseUuid]
  );
  if (byUuid) return byUuid.uuid;

  // 2. Try title match (case-insensitive)
  const byTitle = await queryOne<{ uuid: string }>(
    'SELECT uuid FROM exercises WHERE title ILIKE $1 AND is_hidden = false ORDER BY is_custom ASC LIMIT 1',
    [exerciseTitle]
  );
  if (byTitle) return byTitle.uuid;

  // 3. Create a custom exercise
  const newUuid = randomUUID();
  await query(
    `INSERT INTO exercises (uuid, everkinetic_id, title, alias, primary_muscles, secondary_muscles, equipment, steps, tips, is_custom)
     VALUES ($1, $2, $3, '[]', '[]', '[]', '[]', '[]', '[]', true)`,
    [newUuid, 20000 + Date.now() % 1000000, exerciseTitle]
  );
  return newUuid;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Accept either an array directly or { workouts: [...] }
  let workouts: unknown[];
  if (Array.isArray(body)) {
    workouts = body;
  } else if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).workouts)) {
    workouts = (body as Record<string, unknown>).workouts as unknown[];
  } else {
    return NextResponse.json(
      { error: 'Expected a JSON array of workouts or { workouts: [...] }' },
      { status: 400 }
    );
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const raw of workouts) {
    const w = raw as ImportWorkout;

    if (!w.uuid || !w.start_time) {
      errors.push(`Workout missing uuid or start_time — skipped`);
      skipped++;
      continue;
    }

    // Check for existing workout
    const existing = await queryOne<{ uuid: string }>(
      'SELECT uuid FROM workouts WHERE uuid = $1',
      [w.uuid]
    );
    if (existing) {
      skipped++;
      continue;
    }

    try {
      // Insert workout
      await query(
        `INSERT INTO workouts (uuid, start_time, end_time, title, comment, is_current)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [w.uuid, w.start_time, w.end_time ?? null, w.title ?? null, w.comment ?? null]
      );

      // Insert exercises and sets
      for (const we of (w.exercises ?? [])) {
        const exerciseUuid = await resolveExerciseUuid(we.exercise_uuid, we.exercise_title);
        const weUuid = we.uuid ?? randomUUID();

        await query(
          `INSERT INTO workout_exercises (uuid, workout_uuid, exercise_uuid, order_index)
           VALUES ($1, $2, $3, $4)`,
          [weUuid, w.uuid, exerciseUuid, we.order_index]
        );

        for (const s of (we.sets ?? [])) {
          const tag = s.tag === 'dropSet' || s.tag === 'failure' ? s.tag : null;
          await query(
            `INSERT INTO workout_sets
               (uuid, workout_exercise_uuid, weight, repetitions, rpe, tag, is_completed, order_index)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              s.uuid ?? randomUUID(),
              weUuid,
              s.weight ?? null,
              s.repetitions ?? null,
              s.rpe ?? null,
              tag,
              s.is_completed ? true : false,
              s.order_index,
            ]
          );
        }
      }

      imported++;
    } catch (err) {
      errors.push(`Workout ${w.uuid}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  return NextResponse.json({ imported, skipped, errors });
}
