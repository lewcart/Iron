import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ===== Mock @/db/queries =====

vi.mock('@/db/queries', () => ({
  listExercises: vi.fn(),
  createCustomExercise: vi.fn(),
  listWorkouts: vi.fn(),
  startWorkout: vi.fn(),
  getCurrentWorkout: vi.fn(),
  getWorkout: vi.fn(),
  finishWorkout: vi.fn(),
  listWorkoutExercises: vi.fn(),
  addExerciseToWorkout: vi.fn(),
  listWorkoutSets: vi.fn(),
  logSet: vi.fn(),
  updateSet: vi.fn(),
  getWorkoutSet: vi.fn(),
  getWorkoutExercise: vi.fn(),
  getHistoricalBestsForExercise: vi.fn(),
}));

// ===== Mock @/db/db (used by stats route) =====

vi.mock('@/db/db', () => ({
  query: vi.fn(),
}));

// ===== Fixtures =====

const mockExercise = {
  uuid: 'ex-uuid-1',
  everkinetic_id: 42,
  title: 'Bench Press',
  alias: [],
  description: null,
  primary_muscles: ['chest'],
  secondary_muscles: ['triceps'],
  equipment: ['barbell'],
  steps: [],
  tips: [],
  is_custom: false,
  is_hidden: false,
  movement_pattern: null,
  tracking_mode: 'reps' as const,
};

const mockWorkout = {
  uuid: 'wo-uuid-1',
  start_time: '2026-03-16T10:00:00.000Z',
  end_time: null,
  title: null,
  comment: null,
  is_current: true,
};

const mockWorkoutExercise = {
  uuid: 'we-uuid-1',
  workout_uuid: 'wo-uuid-1',
  exercise_uuid: 'ex-uuid-1',
  comment: null,
  order_index: 0,
};

const mockSet = {
  uuid: 'ws-uuid-1',
  workout_exercise_uuid: 'we-uuid-1',
  weight: 100,
  repetitions: 8,
  min_target_reps: null,
  max_target_reps: null,
  rpe: null,
  tag: null,
  comment: null,
  is_completed: false,
  is_pr: false,
  order_index: 0,
  duration_seconds: null,
};

// ===== GET /api/exercises =====

describe('GET /api/exercises', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns exercises list', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listExercises).mockResolvedValue([mockExercise]);

    const { GET } = await import('./exercises/route');
    const req = new NextRequest('http://localhost/api/exercises');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockExercise]);
    expect(queries.listExercises).toHaveBeenCalledWith({
      search: undefined,
      muscleGroup: undefined,
    });
  });

  it('passes search param to listExercises', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listExercises).mockResolvedValue([]);

    const { GET } = await import('./exercises/route');
    const req = new NextRequest('http://localhost/api/exercises?search=bench');
    await GET(req);

    expect(queries.listExercises).toHaveBeenCalledWith({
      search: 'bench',
      muscleGroup: undefined,
    });
  });

  it('passes muscleGroup param to listExercises', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listExercises).mockResolvedValue([]);

    const { GET } = await import('./exercises/route');
    const req = new NextRequest('http://localhost/api/exercises?muscleGroup=chest');
    await GET(req);

    expect(queries.listExercises).toHaveBeenCalledWith({
      search: undefined,
      muscleGroup: 'chest',
    });
  });

  it('passes both search and muscleGroup params', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listExercises).mockResolvedValue([mockExercise]);

    const { GET } = await import('./exercises/route');
    const req = new NextRequest('http://localhost/api/exercises?search=press&muscleGroup=chest');
    await GET(req);

    expect(queries.listExercises).toHaveBeenCalledWith({
      search: 'press',
      muscleGroup: 'chest',
    });
  });

  it('handles listExercises throwing an error', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listExercises).mockRejectedValue(new Error('DB error'));

    const { GET } = await import('./exercises/route');
    const req = new NextRequest('http://localhost/api/exercises');

    await expect(GET(req)).rejects.toThrow('DB error');
  });
});

// ===== POST /api/exercises =====

describe('POST /api/exercises', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a custom exercise and returns 201', async () => {
    const queries = await import('@/db/queries');
    const dbModule = await import('@/db/db');
    const created = { ...mockExercise, uuid: 'new-uuid', title: 'Dumbbell RDL', is_custom: true, movement_pattern: 'hinge' };
    vi.mocked(queries.createCustomExercise).mockResolvedValue(created);
    // Validation step queries muscles table to verify canonical slugs.
    vi.mocked(dbModule.query).mockResolvedValueOnce([
      { slug: 'hamstrings' }, { slug: 'glutes' }, { slug: 'erectors' },
    ]);

    const { POST } = await import('./exercises/route');
    const req = new NextRequest('http://localhost/api/exercises', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Dumbbell RDL',
        primary_muscles: ['hamstrings', 'glutes'],
        secondary_muscles: ['erectors'],
        equipment: ['dumbbell'],
        movement_pattern: 'hinge',
        description: 'Hip hinge with dumbbells',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(created);
    expect(queries.createCustomExercise).toHaveBeenCalledWith({
      title: 'Dumbbell RDL',
      primaryMuscles: ['hamstrings', 'glutes'],
      secondaryMuscles: ['erectors'],
      equipment: ['dumbbell'],
      movementPattern: 'hinge',
      description: 'Hip hinge with dumbbells',
      steps: [],
      tips: [],
      trackingMode: 'reps',
      youtubeUrl: null,
    });
  });

  it('returns 400 when title is missing', async () => {
    const { POST } = await import('./exercises/route');
    const req = new NextRequest('http://localhost/api/exercises', {
      method: 'POST',
      body: JSON.stringify({ primary_muscles: ['chest'] }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/title/i);
  });

  it('returns 400 when primary_muscles is missing', async () => {
    const { POST } = await import('./exercises/route');
    const req = new NextRequest('http://localhost/api/exercises', {
      method: 'POST',
      body: JSON.stringify({ title: 'Press' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/primary_muscles/i);
  });

  it('returns 400 for invalid JSON', async () => {
    const { POST } = await import('./exercises/route');
    const req = new NextRequest('http://localhost/api/exercises', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
  });
});

// ===== GET /api/workouts =====

describe('GET /api/workouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workouts list', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listWorkouts).mockResolvedValue([mockWorkout]);

    const { GET } = await import('./workouts/route');
    const req = new NextRequest('http://localhost/api/workouts');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockWorkout]);
    expect(queries.listWorkouts).toHaveBeenCalledWith({ limit: undefined });
  });

  it('passes limit param to listWorkouts', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listWorkouts).mockResolvedValue([]);

    const { GET } = await import('./workouts/route');
    const req = new NextRequest('http://localhost/api/workouts?limit=5');
    await GET(req);

    expect(queries.listWorkouts).toHaveBeenCalledWith({ limit: 5 });
  });

  it('returns current workout when current=true', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getCurrentWorkout).mockResolvedValue(mockWorkout);

    const { GET } = await import('./workouts/route');
    const req = new NextRequest('http://localhost/api/workouts?current=true');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockWorkout);
    expect(queries.getCurrentWorkout).toHaveBeenCalled();
    expect(queries.listWorkouts).not.toHaveBeenCalled();
  });

  it('returns null when there is no current workout', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getCurrentWorkout).mockResolvedValue(null);

    const { GET } = await import('./workouts/route');
    const req = new NextRequest('http://localhost/api/workouts?current=true');
    const response = await GET(req);
    const data = await response.json();

    expect(data).toBeNull();
  });
});

// ===== POST /api/workouts =====

describe('POST /api/workouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and returns a new workout', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.startWorkout).mockResolvedValue(mockWorkout);

    const { POST } = await import('./workouts/route');
    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockWorkout);
    expect(queries.startWorkout).toHaveBeenCalled();
  });
});

// ===== GET /api/workouts/[uuid] =====

describe('GET /api/workouts/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workout with exercises', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getWorkout).mockResolvedValue(mockWorkout);
    vi.mocked(queries.listWorkoutExercises).mockResolvedValue([mockWorkoutExercise]);

    const { GET } = await import('./workouts/[uuid]/route');
    const req = new NextRequest('http://localhost/api/workouts/wo-uuid-1');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'wo-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ...mockWorkout, exercises: [mockWorkoutExercise] });
    expect(queries.getWorkout).toHaveBeenCalledWith('wo-uuid-1');
    expect(queries.listWorkoutExercises).toHaveBeenCalledWith('wo-uuid-1');
  });

  it('returns 404 when workout not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getWorkout).mockResolvedValue(null);

    const { GET } = await import('./workouts/[uuid]/route');
    const req = new NextRequest('http://localhost/api/workouts/missing-uuid');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'missing-uuid' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Workout not found' });
    expect(queries.listWorkoutExercises).not.toHaveBeenCalled();
  });
});

// ===== POST /api/workouts/[uuid] =====

describe('POST /api/workouts/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finishes workout with action=finish', async () => {
    const queries = await import('@/db/queries');
    const finishedWorkout = { ...mockWorkout, is_current: false, end_time: '2026-03-16T11:00:00.000Z' };
    vi.mocked(queries.finishWorkout).mockResolvedValue(finishedWorkout);

    const { POST } = await import('./workouts/[uuid]/route');
    const req = new NextRequest('http://localhost/api/workouts/wo-uuid-1', {
      method: 'POST',
      body: JSON.stringify({ action: 'finish' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req, { params: Promise.resolve({ uuid: 'wo-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(finishedWorkout);
    expect(queries.finishWorkout).toHaveBeenCalledWith('wo-uuid-1');
  });

  it('adds exercise with action=add-exercise', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.addExerciseToWorkout).mockResolvedValue(mockWorkoutExercise);

    const { POST } = await import('./workouts/[uuid]/route');
    const req = new NextRequest('http://localhost/api/workouts/wo-uuid-1', {
      method: 'POST',
      body: JSON.stringify({ action: 'add-exercise', exerciseUuid: 'ex-uuid-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req, { params: Promise.resolve({ uuid: 'wo-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockWorkoutExercise);
    expect(queries.addExerciseToWorkout).toHaveBeenCalledWith('wo-uuid-1', 'ex-uuid-1');
  });

  it('returns 400 for invalid action', async () => {
    const { POST } = await import('./workouts/[uuid]/route');
    const req = new NextRequest('http://localhost/api/workouts/wo-uuid-1', {
      method: 'POST',
      body: JSON.stringify({ action: 'unknown' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req, { params: Promise.resolve({ uuid: 'wo-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid action' });
  });

  it('returns 400 when action is missing', async () => {
    const { POST } = await import('./workouts/[uuid]/route');
    const req = new NextRequest('http://localhost/api/workouts/wo-uuid-1', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req, { params: Promise.resolve({ uuid: 'wo-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Invalid action' });
  });
});

// ===== GET /api/workout-exercises/[uuid]/sets =====

describe('GET /api/workout-exercises/[uuid]/sets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns sets for a workout exercise', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listWorkoutSets).mockResolvedValue([mockSet]);

    const { GET } = await import('./workout-exercises/[uuid]/sets/route');
    const req = new NextRequest('http://localhost/api/workout-exercises/we-uuid-1/sets');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'we-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockSet]);
    expect(queries.listWorkoutSets).toHaveBeenCalledWith('we-uuid-1');
  });

  it('returns empty array when no sets exist', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listWorkoutSets).mockResolvedValue([]);

    const { GET } = await import('./workout-exercises/[uuid]/sets/route');
    const req = new NextRequest('http://localhost/api/workout-exercises/we-uuid-1/sets');
    const response = await GET(req, { params: Promise.resolve({ uuid: 'we-uuid-1' }) });
    const data = await response.json();

    expect(data).toEqual([]);
  });
});

// ===== POST /api/workout-exercises/[uuid]/sets =====

describe('POST /api/workout-exercises/[uuid]/sets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs a new set when no setUuid provided', async () => {
    const queries = await import('@/db/queries');
    const newSet = { ...mockSet, weight: 80, repetitions: 10, is_completed: true };
    vi.mocked(queries.logSet).mockResolvedValue(newSet);

    const { POST } = await import('./workout-exercises/[uuid]/sets/route');
    const req = new NextRequest('http://localhost/api/workout-exercises/we-uuid-1/sets', {
      method: 'POST',
      body: JSON.stringify({ weight: 80, repetitions: 10, rpe: 7, tag: 'dropSet' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req, { params: Promise.resolve({ uuid: 'we-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(newSet);
    expect(queries.logSet).toHaveBeenCalledWith({
      workoutExerciseUuid: 'we-uuid-1',
      weight: 80,
      repetitions: 10,
      rpe: 7,
      tag: 'dropSet',
    });
    expect(queries.updateSet).not.toHaveBeenCalled();
  });

  it('updates existing set when setUuid is provided', async () => {
    const queries = await import('@/db/queries');
    const updatedSet = { ...mockSet, weight: 90, repetitions: 6, is_completed: true };
    vi.mocked(queries.updateSet).mockResolvedValue(updatedSet);

    const { POST } = await import('./workout-exercises/[uuid]/sets/route');
    const req = new NextRequest('http://localhost/api/workout-exercises/we-uuid-1/sets', {
      method: 'POST',
      body: JSON.stringify({ setUuid: 'ws-uuid-1', weight: 90, repetitions: 6, rpe: 8, isCompleted: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req, { params: Promise.resolve({ uuid: 'we-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(updatedSet);
    expect(queries.updateSet).toHaveBeenCalledWith('ws-uuid-1', {
      weight: 90,
      repetitions: 6,
      rpe: 8,
      isCompleted: true,
    });
    expect(queries.logSet).not.toHaveBeenCalled();
  });

  it('passes undefined fields to updateSet when they are missing from body', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.updateSet).mockResolvedValue(mockSet);

    const { POST } = await import('./workout-exercises/[uuid]/sets/route');
    const req = new NextRequest('http://localhost/api/workout-exercises/we-uuid-1/sets', {
      method: 'POST',
      body: JSON.stringify({ setUuid: 'ws-uuid-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req, { params: Promise.resolve({ uuid: 'we-uuid-1' }) });

    expect(queries.updateSet).toHaveBeenCalledWith('ws-uuid-1', {
      weight: undefined,
      repetitions: undefined,
      rpe: undefined,
      isCompleted: undefined,
    });
  });
});

// ===== GET /api/stats =====

describe('GET /api/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns activeDays and weeklyData', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([{ day: '2026-03-10 00:00:00' }, { day: '2026-03-12 00:00:00' }])
      .mockResolvedValueOnce([{ week_start: '2026-03-09 00:00:00', count: '3' }]);

    const { GET } = await import('./stats/route');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.activeDays).toEqual(['2026-03-10', '2026-03-12']);
    expect(data.weeklyData).toEqual([{ week: '2026-03-09', count: 3 }]);
  });

  it('returns empty arrays when there is no activity', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValue([]);

    const { GET } = await import('./stats/route');
    const response = await GET();
    const data = await response.json();

    expect(data.activeDays).toEqual([]);
    expect(data.weeklyData).toEqual([]);
  });

  it('calls query twice (once for activeDays, once for weeklyData)', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValue([]);

    const { GET } = await import('./stats/route');
    await GET();

    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('slices day strings to 10 characters for activeDays', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([{ day: '2026-03-10T00:00:00.000Z' }])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./stats/route');
    const response = await GET();
    const data = await response.json();

    expect(data.activeDays).toEqual(['2026-03-10']);
  });

  it('parses count as integer in weeklyData', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ week_start: '2026-03-09', count: '7' }]);

    const { GET } = await import('./stats/route');
    const response = await GET();
    const data = await response.json();

    expect(data.weeklyData[0].count).toBe(7);
    expect(typeof data.weeklyData[0].count).toBe('number');
  });
});
