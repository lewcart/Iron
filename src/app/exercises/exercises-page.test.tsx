// @vitest-environment jsdom
//
// Regression test for the "iOS exercise page doesn't update optimistically"
// bug: ExercisesPage held selectedExercise as a frozen snapshot, so edits
// inside ExerciseDetail (which write to Dexie via updateExercise) didn't
// reflow to the rendered detail until the page remounted. On iOS the
// Capacitor WebView stays alive across app suspension, so closing the
// app was the only way to force a remount.
//
// The fix: store selectedUuid only and derive the live exercise object
// from useExercises (a useLiveQuery) on every render. A Dexie write
// updates allExercises → useMemo recomputes selectedExercise → detail
// receives a fresh prop.
//
// This test simulates the live-query update by swapping the mocked
// useExercises return value mid-test and asserting the rendered detail
// reflects the new value without a remount.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { Exercise } from '@/types';

// Stateful mock of useExercises — a setter outside the React tree lets the
// test simulate a Dexie-driven live-query update.
let mockExercises: Exercise[] = [];
const subscribers = new Set<() => void>();
function setMockExercises(next: Exercise[]) {
  mockExercises = next;
  subscribers.forEach((s) => s());
}

vi.mock('@/lib/useLocalDB', () => ({
  useExercises: () => {
    // Re-read on every notify by forcing a state bump. Mirrors useLiveQuery's
    // reactive contract closely enough for this test.
    const [, force] = require('react').useState(0);
    require('react').useEffect(() => {
      const sub = () => force((n: number) => n + 1);
      subscribers.add(sub);
      return () => { subscribers.delete(sub); };
    }, []);
    return mockExercises;
  },
  // Unused by ExercisesPage but imported transitively. Stub safely.
  getExerciseProgressLocal: vi.fn(),
  getExerciseSessionHistoryLocal: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
  getExerciseTimePRsLocal: vi.fn(),
}));

// ExerciseDetail is heavy (charts, image manager, AI generation). Mock it
// to a thin component that surfaces the parts we care about: the prop
// identity and a single mutable field so we can assert reactivity.
vi.mock('./ExerciseDetail', () => ({
  default: ({ exercise }: { exercise: Exercise }) => (
    <div data-testid="exercise-detail">
      <p data-testid="detail-title">{exercise.title}</p>
      <p data-testid="detail-description">{exercise.description ?? 'NO_DESC'}</p>
      <p data-testid="detail-tracking">{exercise.tracking_mode ?? 'reps'}</p>
    </div>
  ),
}));

// CreateExerciseForm pulls in mutations + Dexie at module scope. Stub it.
vi.mock('./CreateExerciseForm', () => ({
  default: () => null,
}));

import ExercisesPage from './page';

afterEach(() => {
  cleanup();
  mockExercises = [];
  subscribers.clear();
});

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    uuid: 'ex-1',
    everkinetic_id: 0,
    title: 'Bench Press',
    alias: [],
    description: 'Original description.',
    primary_muscles: ['chest'],
    secondary_muscles: [],
    equipment: ['barbell'],
    steps: [],
    tips: [],
    is_custom: false,
    is_hidden: false,
    movement_pattern: null,
    tracking_mode: 'reps',
    image_count: 0,
    youtube_url: null,
    image_urls: null,
    ...overrides,
  } as unknown as Exercise;
}

describe('ExercisesPage — live-query reflow into open detail (regression)', () => {
  it('detail re-renders with fresh fields when allExercises updates after navigation', () => {
    const initial = makeExercise({ description: 'Original description.', tracking_mode: 'reps' });
    setMockExercises([initial]);

    render(<ExercisesPage />);

    // Drill into the muscle list (Chest) and tap the exercise.
    fireEvent.click(screen.getByRole('button', { name: /Chest/i }));
    fireEvent.click(screen.getByRole('button', { name: /Bench Press/i }));

    expect(screen.getByTestId('detail-description')).toHaveTextContent('Original description.');
    expect(screen.getByTestId('detail-tracking')).toHaveTextContent('reps');

    // Simulate updateExercise → Dexie write → useLiveQuery update.
    act(() => {
      setMockExercises([
        makeExercise({ description: 'Edited description.', tracking_mode: 'time' }),
      ]);
    });

    // Without the fix this still shows the original snapshot.
    expect(screen.getByTestId('detail-description')).toHaveTextContent('Edited description.');
    expect(screen.getByTestId('detail-tracking')).toHaveTextContent('time');
  });

  it('navigates back to index automatically when the open exercise is deleted', () => {
    setMockExercises([makeExercise()]);
    render(<ExercisesPage />);

    fireEvent.click(screen.getByRole('button', { name: /Chest/i }));
    fireEvent.click(screen.getByRole('button', { name: /Bench Press/i }));
    expect(screen.getByTestId('exercise-detail')).toBeInTheDocument();

    // Exercise removed from live list (deleted or hidden).
    act(() => { setMockExercises([]); });

    expect(screen.queryByTestId('exercise-detail')).not.toBeInTheDocument();
  });

  it('muscle-filtered list reflects new exercises added to allExercises after entering the filter', () => {
    setMockExercises([makeExercise({ uuid: 'ex-1', title: 'Bench Press' })]);
    render(<ExercisesPage />);

    fireEvent.click(screen.getByRole('button', { name: /Chest/i }));
    expect(screen.getByRole('button', { name: /Bench Press/i })).toBeInTheDocument();

    // A new chest exercise lands in Dexie. Without the fix the snapshot
    // muscleExercises array would not include it.
    act(() => {
      setMockExercises([
        makeExercise({ uuid: 'ex-1', title: 'Bench Press' }),
        makeExercise({ uuid: 'ex-2', title: 'Incline Press' }),
      ]);
    });

    expect(screen.getByRole('button', { name: /Incline Press/i })).toBeInTheDocument();
  });
});
