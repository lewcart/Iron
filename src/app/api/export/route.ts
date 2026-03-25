import { NextResponse } from 'next/server';
import { exportWorkouts } from '@/db/queries';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') ?? 'json';

  const workouts = await exportWorkouts();

  if (format === 'csv') {
    const rows: string[] = [
      'workout_uuid,workout_date,workout_title,workout_comment,exercise_title,set_order,weight_kg,repetitions,rpe,tag,is_completed',
    ];

    for (const w of workouts) {
      const date = new Date(w.start_time).toISOString().slice(0, 10);
      const title = csvEscape(w.title ?? '');
      const comment = csvEscape(w.comment ?? '');

      if (w.exercises.length === 0) {
        rows.push(`${w.uuid},${date},${title},${comment},,,,,,, `);
      }

      for (const we of w.exercises) {
        const exerciseTitle = csvEscape(we.exercise_title);

        if (we.sets.length === 0) {
          rows.push(`${w.uuid},${date},${title},${comment},${exerciseTitle},,,,,, `);
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

  return new NextResponse(JSON.stringify(workouts, null, 2), {
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
