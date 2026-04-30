import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db/db', () => ({
  query: vi.fn(),
}));

// Sets up 10 empty query returns (one per module in Promise.all order)
async function mockAllEmpty() {
  const db = await import('@/db/db');
  for (let i = 0; i < 10; i++) {
    vi.mocked(db.query).mockResolvedValueOnce([]);
  }
}

describe('GET /api/timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when all modules have no data', async () => {
    await mockAllEmpty();

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/timeline');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
  });

  it('calls query 9 times (once per module) with default params', async () => {
    const db = await import('@/db/db');
    await mockAllEmpty();

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/timeline');
    await GET(req);

    expect(db.query).toHaveBeenCalledTimes(10);
  });

  it('caps days at 90 without throwing', async () => {
    const db = await import('@/db/db');
    await mockAllEmpty();

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/timeline?days=9999');
    const response = await GET(req);

    expect(response.status).toBe(200);
    expect(db.query).toHaveBeenCalledTimes(10);
  });

  it('caps limit at 200 and returns all rows when under the cap', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([
        { uuid: 'w1', start_time: '2026-03-25T10:00:00.000Z', title: 'A', exercise_count: 2 },
        { uuid: 'w2', start_time: '2026-03-24T10:00:00.000Z', title: 'B', exercise_count: 1 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/timeline?limit=9999');
    const response = await GET(req);
    const data = await response.json();

    // 9999 capped to 200; 2 rows ≤ 200 so all are returned
    expect(data).toHaveLength(2);
  });

  // ===== Workout formatting =====

  it('formats workout entry with title', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([
        { uuid: 'w1', start_time: '2026-03-25T10:00:00.000Z', title: 'Push Day', exercise_count: 4 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/timeline'));
    const [entry] = await response.json();

    expect(entry).toMatchObject({
      id: 'w1',
      module: 'workout',
      icon: 'dumbbell',
      timestamp: '2026-03-25T10:00:00.000Z',
      summary: 'Push Day · 4 exercises',
    });
  });

  it('formats workout entry without title', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([
        { uuid: 'w1', start_time: '2026-03-25T10:00:00.000Z', title: null, exercise_count: 1 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry.summary).toBe('Workout · 1 exercise');
  });

  it('uses plural "exercises" for exercise_count !== 1', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([
        { uuid: 'w1', start_time: '2026-03-25T10:00:00.000Z', title: null, exercise_count: 0 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry.summary).toBe('Workout · 0 exercises');
  });

  // ===== Nutrition formatting =====

  it('formats nutrition entry with meal_name, calories and protein', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'n1', logged_at: '2026-03-25T12:00:00.000Z', meal_name: 'Lunch', meal_type: null, calories: 650.4, protein_g: 42.8 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry).toMatchObject({
      id: 'n1',
      module: 'nutrition',
      icon: 'utensils',
      summary: 'Lunch · 650 kcal, 43g protein',
    });
  });

  it('falls back to meal_type when meal_name is null, shows plain name when no macros', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'n1', logged_at: '2026-03-25T12:00:00.000Z', meal_name: null, meal_type: 'dinner', calories: null, protein_g: null },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry.summary).toBe('dinner');
  });

  // ===== HRT formatting =====

  it('formats HRT timeline entry with estrogen dose', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'h1', started_at: '2026-03-25', ended_at: null, name: 'Estrogel + Cypro', doses_e: 'Estrogel 1.5mg estradiol' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry).toMatchObject({
      id: 'h1',
      module: 'hrt',
      icon: 'pill',
      summary: 'Protocol started: Estrogel + Cypro · Estrogel 1.5mg estradiol',
    });
  });

  it('formats HRT timeline entry without estrogen dose', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'h1', started_at: '2026-03-25', ended_at: null, name: 'Pause', doses_e: null },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry.summary).toBe('Protocol started: Pause');
  });

  // ===== Measurement formatting =====

  it('formats measurement entry replacing underscores with spaces', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'm1', measured_at: '2026-03-25T09:00:00.000Z', site: 'left_arm', value_cm: 32.5 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry).toMatchObject({
      id: 'm1',
      module: 'measurement',
      icon: 'ruler',
      summary: 'left arm · 32.5 cm',
    });
  });

  // ===== Wellbeing formatting =====

  it('formats wellbeing entry with mood, energy and sleep', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'wb1', logged_at: '2026-03-25T07:00:00.000Z', mood: 8, energy: 7, sleep_hours: 7.5 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry).toMatchObject({
      id: 'wb1',
      module: 'wellbeing',
      icon: 'heart',
      summary: 'Wellbeing · mood 8/10, energy 7/10, 7.5h sleep',
    });
  });

  it('formats wellbeing entry with no fields as plain check-in label', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'wb1', logged_at: '2026-03-25T07:00:00.000Z', mood: null, energy: null, sleep_hours: null },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry.summary).toBe('Wellbeing check-in');
  });

  // ===== Progress photo formatting =====

  it('formats progress photo entry', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'p1', taken_at: '2026-03-25T11:00:00.000Z', pose: 'front' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry).toMatchObject({
      id: 'p1',
      module: 'photo',
      icon: 'camera',
      summary: 'Progress photo · front',
    });
  });

  // ===== Bodyweight formatting =====

  it('formats bodyweight entry', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'bw1', logged_at: '2026-03-25T08:30:00.000Z', weight_kg: 72.4 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry).toMatchObject({
      id: 'bw1',
      module: 'bodyweight',
      icon: 'scale',
      summary: 'Bodyweight · 72.4 kg',
    });
  });

  // ===== Body spec formatting =====

  it('formats body_spec entry with weight and body fat', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'bs1', measured_at: '2026-03-25T09:00:00.000Z', weight_kg: 72.1, body_fat_pct: 18.5 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry).toMatchObject({
      id: 'bs1',
      module: 'body_spec',
      icon: 'activity',
      summary: 'Body scan · 72.1 kg, 18.5% body fat',
    });
  });

  it('formats body_spec entry with no fields as plain label', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'bs1', measured_at: '2026-03-25T09:00:00.000Z', weight_kg: null, body_fat_pct: null },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry.summary).toBe('Body scan');
  });

  // ===== Dysphoria formatting =====

  it('formats dysphoria entry as euphoric when scale >= 7', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'd1', logged_at: '2026-03-25T10:00:00.000Z', scale: 8 },
      ]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry).toMatchObject({
      id: 'd1',
      module: 'dysphoria',
      icon: 'sparkles',
      summary: 'Dysphoria check · 8/10 (euphoric)',
    });
  });

  it('formats dysphoria entry as dysphoric when scale <= 3', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'd1', logged_at: '2026-03-25T10:00:00.000Z', scale: 2 },
      ]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry.summary).toBe('Dysphoria check · 2/10 (dysphoric)');
  });

  it('formats dysphoria entry as neutral for mid-range scale', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { uuid: 'd1', logged_at: '2026-03-25T10:00:00.000Z', scale: 5 },
      ]);

    const { GET } = await import('./route');
    const [entry] = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(entry.summary).toBe('Dysphoria check · 5/10 (neutral)');
  });

  // ===== Cross-module sorting and limit =====

  it('sorts entries from multiple modules by timestamp descending', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      // workouts: 2026-03-24
      .mockResolvedValueOnce([
        { uuid: 'w1', start_time: '2026-03-24T10:00:00.000Z', title: null, exercise_count: 2 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      // wellbeing: 2026-03-25 (most recent)
      .mockResolvedValueOnce([
        { uuid: 'wb1', logged_at: '2026-03-25T07:00:00.000Z', mood: 8, energy: null, sleep_hours: null },
      ])
      .mockResolvedValueOnce([])
      // bodyweight: 2026-03-23 (oldest)
      .mockResolvedValueOnce([
        { uuid: 'bw1', logged_at: '2026-03-23T08:30:00.000Z', weight_kg: 72 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const data = await (await GET(new NextRequest('http://localhost/api/timeline'))).json();

    expect(data).toHaveLength(3);
    expect(data[0].id).toBe('wb1'); // 2026-03-25 newest
    expect(data[1].id).toBe('w1');  // 2026-03-24
    expect(data[2].id).toBe('bw1'); // 2026-03-23 oldest
  });

  it('applies limit and returns only the most recent entries', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query)
      .mockResolvedValueOnce([
        { uuid: 'w1', start_time: '2026-03-25T10:00:00.000Z', title: null, exercise_count: 2 },
        { uuid: 'w2', start_time: '2026-03-24T10:00:00.000Z', title: null, exercise_count: 2 },
        { uuid: 'w3', start_time: '2026-03-23T10:00:00.000Z', title: null, exercise_count: 2 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const data = await (await GET(new NextRequest('http://localhost/api/timeline?limit=2'))).json();

    expect(data).toHaveLength(2);
    expect(data[0].id).toBe('w1');
    expect(data[1].id).toBe('w2');
  });
});
