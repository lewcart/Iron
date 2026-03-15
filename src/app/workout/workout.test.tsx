import { describe, it, expect } from 'vitest';
import { formatTime, calcCompletedSets, calcTotalVolume } from './workout-utils';
import type { WorkoutExerciseEntry as ExerciseEntry } from './workout-utils';
import type { WorkoutSet, Exercise } from '@/types';

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    uuid: 'ex-uuid',
    everkinetic_id: 1,
    title: 'Bench Press',
    alias: [],
    description: null,
    primary_muscles: ['chest'],
    secondary_muscles: ['triceps', 'shoulders'],
    equipment: ['barbell'],
    steps: [],
    tips: [],
    is_custom: false,
    is_hidden: false,
    ...overrides,
  };
}

function makeSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    uuid: `set-${Math.random()}`,
    workout_exercise_uuid: 'we-uuid',
    weight: null,
    repetitions: null,
    min_target_reps: null,
    max_target_reps: null,
    rpe: null,
    tag: null,
    comment: null,
    is_completed: false,
    order_index: 0,
    ...overrides,
  };
}

function makeExerciseEntry(
  sets: WorkoutSet[],
  exerciseOverrides: Partial<Exercise> = {}
): ExerciseEntry {
  return {
    uuid: 'we-uuid',
    workout_uuid: 'wo-uuid',
    exercise_uuid: 'ex-uuid',
    comment: null,
    order_index: 0,
    exercise: makeExercise(exerciseOverrides),
    sets,
  };
}

// ─── formatTime ───────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('formats zero seconds as 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats seconds under a minute', () => {
    expect(formatTime(45)).toBe('00:45');
  });

  it('formats exactly one minute', () => {
    expect(formatTime(60)).toBe('01:00');
  });

  it('formats minutes and seconds with no hours', () => {
    expect(formatTime(90)).toBe('01:30');
    expect(formatTime(3599)).toBe('59:59');
  });

  it('includes hours when >= 3600 seconds', () => {
    expect(formatTime(3600)).toBe('01:00:00');
    expect(formatTime(3661)).toBe('01:01:01');
    expect(formatTime(7322)).toBe('02:02:02');
  });

  it('pads all components to 2 digits', () => {
    expect(formatTime(3600 + 60 + 5)).toBe('01:01:05');
  });

  it('handles large values correctly', () => {
    // 2h 30m 15s
    expect(formatTime(2 * 3600 + 30 * 60 + 15)).toBe('02:30:15');
  });
});

// ─── calcCompletedSets ────────────────────────────────────────────────────────

describe('calcCompletedSets', () => {
  it('returns 0 when there are no exercises', () => {
    expect(calcCompletedSets([])).toBe(0);
  });

  it('returns 0 when no sets are completed', () => {
    const entry = makeExerciseEntry([
      makeSet({ is_completed: false }),
      makeSet({ is_completed: false }),
    ]);
    expect(calcCompletedSets([entry])).toBe(0);
  });

  it('counts completed sets across a single exercise', () => {
    const entry = makeExerciseEntry([
      makeSet({ is_completed: true }),
      makeSet({ is_completed: false }),
      makeSet({ is_completed: true }),
    ]);
    expect(calcCompletedSets([entry])).toBe(2);
  });

  it('sums completed sets across multiple exercises', () => {
    const entry1 = makeExerciseEntry([
      makeSet({ is_completed: true }),
      makeSet({ is_completed: true }),
    ]);
    const entry2 = makeExerciseEntry([
      makeSet({ is_completed: false }),
      makeSet({ is_completed: true }),
    ]);
    expect(calcCompletedSets([entry1, entry2])).toBe(3);
  });

  it('returns 0 for exercises with empty sets array', () => {
    expect(calcCompletedSets([makeExerciseEntry([])])).toBe(0);
  });
});

// ─── calcTotalVolume ──────────────────────────────────────────────────────────

describe('calcTotalVolume', () => {
  it('returns 0 when there are no exercises', () => {
    expect(calcTotalVolume([])).toBe(0);
  });

  it('returns 0 when no sets are completed', () => {
    const entry = makeExerciseEntry([
      makeSet({ weight: 100, repetitions: 10, is_completed: false }),
    ]);
    expect(calcTotalVolume([entry])).toBe(0);
  });

  it('calculates weight × reps for a single completed set', () => {
    const entry = makeExerciseEntry([
      makeSet({ weight: 100, repetitions: 10, is_completed: true }),
    ]);
    expect(calcTotalVolume([entry])).toBe(1000);
  });

  it('sums volume across multiple completed sets in one exercise', () => {
    const entry = makeExerciseEntry([
      makeSet({ weight: 100, repetitions: 10, is_completed: true }), // 1000
      makeSet({ weight: 80, repetitions: 12, is_completed: true }),  // 960
      makeSet({ weight: 60, repetitions: 15, is_completed: true }),  // 900
    ]);
    expect(calcTotalVolume([entry])).toBe(2860);
  });

  it('ignores incomplete sets in volume calculation', () => {
    const entry = makeExerciseEntry([
      makeSet({ weight: 100, repetitions: 10, is_completed: true }),  // 1000
      makeSet({ weight: 200, repetitions: 5, is_completed: false }),  // excluded
    ]);
    expect(calcTotalVolume([entry])).toBe(1000);
  });

  it('sums volume across multiple exercises', () => {
    const entry1 = makeExerciseEntry([
      makeSet({ weight: 100, repetitions: 10, is_completed: true }), // 1000
    ]);
    const entry2 = makeExerciseEntry([
      makeSet({ weight: 50, repetitions: 20, is_completed: true }),  // 1000
    ]);
    expect(calcTotalVolume([entry1, entry2])).toBe(2000);
  });

  it('treats null weight as 0', () => {
    const entry = makeExerciseEntry([
      makeSet({ weight: null, repetitions: 10, is_completed: true }),
    ]);
    expect(calcTotalVolume([entry])).toBe(0);
  });

  it('treats null repetitions as 0', () => {
    const entry = makeExerciseEntry([
      makeSet({ weight: 100, repetitions: null, is_completed: true }),
    ]);
    expect(calcTotalVolume([entry])).toBe(0);
  });

  it('handles fractional weights correctly', () => {
    const entry = makeExerciseEntry([
      makeSet({ weight: 22.5, repetitions: 8, is_completed: true }),
    ]);
    expect(calcTotalVolume([entry])).toBeCloseTo(180);
  });
});

// ─── Confirmation modal behaviour (logic-level) ───────────────────────────────

describe('finish workout modal logic', () => {
  it('summary panel shows 0 volume with no completed sets', () => {
    const entries: ExerciseEntry[] = [
      makeExerciseEntry([
        makeSet({ weight: 100, repetitions: 10, is_completed: false }),
      ]),
    ];
    expect(calcTotalVolume(entries)).toBe(0);
    expect(calcCompletedSets(entries)).toBe(0);
  });

  it('summary panel reflects partial completion', () => {
    const entries: ExerciseEntry[] = [
      makeExerciseEntry([
        makeSet({ weight: 60, repetitions: 12, is_completed: true }),
        makeSet({ weight: 60, repetitions: 12, is_completed: false }),
      ]),
      makeExerciseEntry([
        makeSet({ weight: 80, repetitions: 8, is_completed: true }),
        makeSet({ weight: 80, repetitions: 8, is_completed: true }),
      ]),
    ];
    expect(calcCompletedSets(entries)).toBe(3);
    expect(calcTotalVolume(entries)).toBe(60 * 12 + 80 * 8 + 80 * 8); // 720 + 640 + 640 = 2000
  });

  it('full workout totals add up correctly', () => {
    const entries: ExerciseEntry[] = [
      makeExerciseEntry([
        makeSet({ weight: 100, repetitions: 5, is_completed: true }),
        makeSet({ weight: 100, repetitions: 5, is_completed: true }),
        makeSet({ weight: 100, repetitions: 5, is_completed: true }),
      ]),
      makeExerciseEntry([
        makeSet({ weight: 70, repetitions: 10, is_completed: true }),
        makeSet({ weight: 70, repetitions: 10, is_completed: true }),
      ]),
    ];
    expect(calcCompletedSets(entries)).toBe(5);
    expect(calcTotalVolume(entries)).toBe(3 * 500 + 2 * 700); // 1500 + 1400 = 2900
  });
});
