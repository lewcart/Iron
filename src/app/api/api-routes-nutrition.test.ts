import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { NutritionLog, NutritionWeekMeal, NutritionDayNote } from '@/types';

// ===== Mock @/db/queries =====

vi.mock('@/db/queries', () => ({
  listNutritionLogs: vi.fn(),
  createNutritionLog: vi.fn(),
  getNutritionDayNote: vi.fn(),
  upsertNutritionDayNote: vi.fn(),
  listNutritionWeekMeals: vi.fn(),
  createNutritionWeekMeal: vi.fn(),
  updateNutritionWeekMeal: vi.fn(),
  deleteNutritionWeekMeal: vi.fn(),
}));

// ===== Fixtures =====

const mockNutritionLog: NutritionLog = {
  uuid: 'nl-uuid-1',
  logged_at: '2026-03-26T08:00:00.000Z',
  meal_type: 'breakfast',
  meal_name: 'Oats',
  calories: 350.0,
  protein_g: 20.0,
  carbs_g: 55.0,
  fat_g: 8.0,
  notes: null,
  template_meal_id: null,
  status: 'added',
  external_ref: null,
};

const mockDayNote: NutritionDayNote = {
  uuid: 'dn-uuid-1',
  date: '2026-03-26',
  hydration_ml: 2000,
  notes: 'Felt good today',
  template_applied_at: null,
  approved_status: 'pending',
  approved_at: null,
  updated_at: '2026-03-26T10:00:00.000Z',
};

const mockWeekMeal: NutritionWeekMeal = {
  uuid: 'wm-uuid-1',
  day_of_week: 1,
  meal_slot: 'breakfast',
  meal_name: 'Protein Shake',
  protein_g: 40.0,
  calories: 300.0,
  quality_rating: 4,
  sort_order: 0,
};

// ===== GET /api/nutrition =====

describe('GET /api/nutrition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns nutrition logs with default limit', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listNutritionLogs).mockResolvedValue([mockNutritionLog]);

    const { GET } = await import('./nutrition/route');
    const req = new NextRequest('http://localhost/api/nutrition');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockNutritionLog]);
    expect(queries.listNutritionLogs).toHaveBeenCalledWith({ limit: 90, from: undefined, to: undefined });
  });

  it('passes from/to/limit params to listNutritionLogs', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listNutritionLogs).mockResolvedValue([]);

    const { GET } = await import('./nutrition/route');
    const req = new NextRequest('http://localhost/api/nutrition?limit=30&from=2026-03-01&to=2026-03-31');
    await GET(req);

    expect(queries.listNutritionLogs).toHaveBeenCalledWith({ limit: 30, from: '2026-03-01', to: '2026-03-31' });
  });
});

// ===== POST /api/nutrition =====

describe('POST /api/nutrition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a nutrition log and returns 201', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createNutritionLog).mockResolvedValue(mockNutritionLog);

    const { POST } = await import('./nutrition/route');
    const req = new NextRequest('http://localhost/api/nutrition', {
      method: 'POST',
      body: JSON.stringify({
        logged_at: '2026-03-26T08:00:00.000Z',
        meal_type: 'breakfast',
        meal_name: 'Oats',
        calories: '350',
        protein_g: '20',
        carbs_g: '55',
        fat_g: '8',
        status: 'added',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(mockNutritionLog);
    expect(queries.createNutritionLog).toHaveBeenCalledWith({
      logged_at: '2026-03-26T08:00:00.000Z',
      meal_type: 'breakfast',
      calories: 350,
      protein_g: 20,
      carbs_g: 55,
      fat_g: 8,
      notes: null,
      meal_name: 'Oats',
      template_meal_id: null,
      status: 'added',
      external_ref: null,
    });
  });

  it('passes null for optional numeric fields when omitted', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createNutritionLog).mockResolvedValue(mockNutritionLog);

    const { POST } = await import('./nutrition/route');
    const req = new NextRequest('http://localhost/api/nutrition', {
      method: 'POST',
      body: JSON.stringify({ logged_at: '2026-03-26T08:00:00.000Z' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(req);

    expect(queries.createNutritionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
        external_ref: null,
      }),
    );
  });
});

// ===== GET /api/nutrition/day-notes =====

describe('GET /api/nutrition/day-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when date query param is missing', async () => {
    const { GET } = await import('./nutrition/day-notes/route');
    const req = new NextRequest('http://localhost/api/nutrition/day-notes');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/date/);
  });

  it('returns null when no note exists for the date', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getNutritionDayNote).mockResolvedValue(null);

    const { GET } = await import('./nutrition/day-notes/route');
    const req = new NextRequest('http://localhost/api/nutrition/day-notes?date=2026-03-26');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toBeNull();
    expect(queries.getNutritionDayNote).toHaveBeenCalledWith('2026-03-26');
  });

  it('returns the day note when found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.getNutritionDayNote).mockResolvedValue(mockDayNote);

    const { GET } = await import('./nutrition/day-notes/route');
    const req = new NextRequest('http://localhost/api/nutrition/day-notes?date=2026-03-26');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockDayNote);
  });
});

// ===== POST /api/nutrition/day-notes =====

describe('POST /api/nutrition/day-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when date is missing', async () => {
    const { POST } = await import('./nutrition/day-notes/route');
    const req = new NextRequest('http://localhost/api/nutrition/day-notes', {
      method: 'POST',
      body: JSON.stringify({ hydration_ml: 2000 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/date/);
  });

  it('upserts day note and returns 201', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.upsertNutritionDayNote).mockResolvedValue(mockDayNote);

    const { POST } = await import('./nutrition/day-notes/route');
    const req = new NextRequest('http://localhost/api/nutrition/day-notes', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-03-26', hydration_ml: '2000', notes: 'Felt good today' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(mockDayNote);
    expect(queries.upsertNutritionDayNote).toHaveBeenCalledWith('2026-03-26', {
      hydration_ml: 2000,
      notes: 'Felt good today',
    });
  });
});

// ===== GET /api/nutrition/week =====

describe('GET /api/nutrition/week', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all week meals when no day filter', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listNutritionWeekMeals).mockResolvedValue([mockWeekMeal]);

    const { GET } = await import('./nutrition/week/route');
    const req = new NextRequest('http://localhost/api/nutrition/week');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([mockWeekMeal]);
    expect(queries.listNutritionWeekMeals).toHaveBeenCalledWith(undefined);
  });

  it('filters by day_of_week when day param provided', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.listNutritionWeekMeals).mockResolvedValue([mockWeekMeal]);

    const { GET } = await import('./nutrition/week/route');
    const req = new NextRequest('http://localhost/api/nutrition/week?day=1');
    await GET(req);

    expect(queries.listNutritionWeekMeals).toHaveBeenCalledWith(1);
  });
});

// ===== POST /api/nutrition/week =====

describe('POST /api/nutrition/week', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when day_of_week is missing', async () => {
    const { POST } = await import('./nutrition/week/route');
    const req = new NextRequest('http://localhost/api/nutrition/week', {
      method: 'POST',
      body: JSON.stringify({ meal_name: 'Oats' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/day_of_week/);
  });

  it('returns 400 when meal_name is missing', async () => {
    const { POST } = await import('./nutrition/week/route');
    const req = new NextRequest('http://localhost/api/nutrition/week', {
      method: 'POST',
      body: JSON.stringify({ day_of_week: 1 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/meal_name/);
  });

  it('returns 400 when meal_slot is not a recognized slot', async () => {
    const { POST } = await import('./nutrition/week/route');
    const req = new NextRequest('http://localhost/api/nutrition/week', {
      method: 'POST',
      body: JSON.stringify({
        day_of_week: 1,
        meal_slot: 'morning',
        meal_name: 'Protein Shake',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/meal_slot/);
  });

  it('creates week meal and returns 201', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.createNutritionWeekMeal).mockResolvedValue(mockWeekMeal);

    const { POST } = await import('./nutrition/week/route');
    const req = new NextRequest('http://localhost/api/nutrition/week', {
      method: 'POST',
      body: JSON.stringify({
        day_of_week: '1',
        meal_slot: 'breakfast',
        meal_name: 'Protein Shake',
        protein_g: '40',
        calories: '300',
        quality_rating: '4',
        sort_order: '0',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual(mockWeekMeal);
    expect(queries.createNutritionWeekMeal).toHaveBeenCalledWith({
      day_of_week: 1,
      meal_slot: 'breakfast',
      meal_name: 'Protein Shake',
      protein_g: 40,
      calories: 300,
      quality_rating: 4,
      sort_order: 0,
    });
  });
});

// ===== PATCH /api/nutrition/week/[uuid] =====

describe('PATCH /api/nutrition/week/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when meal not found', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.updateNutritionWeekMeal).mockResolvedValue(null);

    const { PATCH } = await import('./nutrition/week/[uuid]/route');
    const req = new NextRequest('http://localhost/api/nutrition/week/missing-uuid', {
      method: 'PATCH',
      body: JSON.stringify({ meal_name: 'Updated' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'missing-uuid' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Not found' });
  });

  it('updates and returns the meal', async () => {
    const queries = await import('@/db/queries');
    const updated = { ...mockWeekMeal, meal_name: 'Updated Shake' };
    vi.mocked(queries.updateNutritionWeekMeal).mockResolvedValue(updated);

    const { PATCH } = await import('./nutrition/week/[uuid]/route');
    const req = new NextRequest('http://localhost/api/nutrition/week/wm-uuid-1', {
      method: 'PATCH',
      body: JSON.stringify({ meal_name: 'Updated Shake' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PATCH(req, { params: Promise.resolve({ uuid: 'wm-uuid-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(updated);
    expect(queries.updateNutritionWeekMeal).toHaveBeenCalledWith('wm-uuid-1', { meal_name: 'Updated Shake' });
  });
});

// ===== DELETE /api/nutrition/week/[uuid] =====

describe('DELETE /api/nutrition/week/[uuid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the meal and returns 204', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.deleteNutritionWeekMeal).mockResolvedValue(undefined);

    const { DELETE } = await import('./nutrition/week/[uuid]/route');
    const req = new NextRequest('http://localhost/api/nutrition/week/wm-uuid-1', {
      method: 'DELETE',
    });
    const response = await DELETE(req, { params: Promise.resolve({ uuid: 'wm-uuid-1' }) });

    expect(response.status).toBe(204);
    expect(queries.deleteNutritionWeekMeal).toHaveBeenCalledWith('wm-uuid-1');
  });
});
