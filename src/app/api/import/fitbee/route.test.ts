import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireApiKey: () => null,
}));

vi.mock('@/db/queries', () => ({
  importFitbeeExport: vi.fn(),
}));

const summary = {
  batch_uuid: 'batch-1',
  food_entries_inserted: 2,
  food_entries_skipped_duplicates: 0,
  nutrition_aggregates_upserted: 1,
  water_days_updated: 0,
  weights_inserted: 0,
  weights_skipped_duplicates: 0,
  activities_inserted: 0,
  activities_skipped_duplicates: 0,
  warnings: [] as string[],
};

describe('POST /api/import/fitbee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when no files are provided', async () => {
    const { POST } = await import('./route');
    const fd = new FormData();
    const req = new NextRequest('http://localhost/api/import/fitbee', {
      method: 'POST',
      body: fd,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/ZIP|attach/i);
  });

  it('imports food_entries.csv and returns summary', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.importFitbeeExport).mockResolvedValue(summary);

    const csv = `date,meal,food_name,calories (kcal),protein (g),carbohydrate (g),total_fat (g)
2026-03-01T00:00:00+1000,Lunch,Tuna,300,30,10,5`;

    const { POST } = await import('./route');
    const fd = new FormData();
    fd.append('food_entries', new File([csv], 'food_entries.csv', { type: 'text/csv' }));

    const req = new NextRequest('http://localhost/api/import/fitbee', {
      method: 'POST',
      body: fd,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.batch_uuid).toBe('batch-1');
    expect(queries.importFitbeeExport).toHaveBeenCalledTimes(1);
  });

  it('skips DB when duplicate food re-import yields skipped count (mock)', async () => {
    const queries = await import('@/db/queries');
    vi.mocked(queries.importFitbeeExport).mockResolvedValue({
      ...summary,
      food_entries_inserted: 0,
      food_entries_skipped_duplicates: 2,
    });

    const csv = `date,meal,food_name,calories (kcal),protein (g),carbohydrate (g),total_fat (g)
2026-03-01T00:00:00+1000,Lunch,Tuna,300,30,10,5`;

    const { POST } = await import('./route');
    const fd = new FormData();
    fd.append('food_entries', new File([csv], 'food_entries.csv', { type: 'text/csv' }));
    const res = await POST(
      new NextRequest('http://localhost/api/import/fitbee', { method: 'POST', body: fd }),
    );
    const data = await res.json();
    expect(data.food_entries_skipped_duplicates).toBe(2);
  });
});
