import { NextResponse } from 'next/server';
import { exportWorkouts } from '@/db/queries';

// Bumped to v2 with the introduction of duration_seconds on workout_sets and
// tracking_mode on exercises (migration 020). v1 export consumers see only
// weight × reps; v2 adds the time-mode column. The schema_version field at
// the JSON envelope and the CSV header comment let any future import route
// by version without guessing.
const EXPORT_SCHEMA_VERSION = 2;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') ?? 'json';

  const workouts = await exportWorkouts();

  if (format === 'csv') {
    const rows: string[] = [
      `# rebirth-workouts schema_version=${EXPORT_SCHEMA_VERSION}`,
      'workout_uuid,workout_date,workout_title,workout_comment,exercise_title,set_order,weight_kg,repetitions,duration_seconds,rpe,tag,is_completed',
    ];

    for (const w of workouts) {
      const date = new Date(w.start_time).toISOString().slice(0, 10);
      const title = csvEscape(w.title ?? '');
      const comment = csvEscape(w.comment ?? '');

      if (w.exercises.length === 0) {
        rows.push(`${w.uuid},${date},${title},${comment},,,,,,,, `);
      }

      for (const we of w.exercises) {
        const exerciseTitle = csvEscape(we.exercise_title);

        if (we.sets.length === 0) {
          rows.push(`${w.uuid},${date},${title},${comment},${exerciseTitle},,,,,,, `);
        }

        for (const s of we.sets) {
          rows.push([
            w.uuid,
            date,
            title,
            comment,
            exerciseTitle,
            s.order_index + 1,
            s.weight ?? '',
            s.repetitions ?? '',
            (s as { duration_seconds?: number | null }).duration_seconds ?? '',
            s.rpe ?? '',
            s.tag ?? '',
            s.is_completed ? '1' : '0',
          ].join(','));
        }
      }
    }

    return new NextResponse(rows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="rebirth-workouts-${dateStamp()}.csv"`,
      },
    });
  }

  // JSON envelope: schema_version at top level so future imports can route
  // by version without parsing rows first.
  const envelope = {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    workouts,
  };

  return new NextResponse(JSON.stringify(envelope, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="rebirth-workouts-${dateStamp()}.json"`,
    },
  });
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
