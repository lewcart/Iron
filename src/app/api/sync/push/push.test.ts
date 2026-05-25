import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db/db', () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn(),
}));

vi.mock('@/db/queries', () => ({
  recomputePRFlagsForExercise: vi.fn().mockResolvedValue(undefined),
}));

function pushRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function pushPayload(body: Record<string, unknown>) {
  const { POST } = await import('./route');
  return POST(pushRequest(body));
}

const baseExercise = {
  uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  everkinetic_id: 1,
  title: 'Cable Fly',
  alias: [],
  description: null,
  primary_muscles: ['chest'],
  secondary_muscles: [],
  equipment: ['cable'],
  steps: [],
  tips: [],
  is_custom: false,
  is_hidden: false,
  movement_pattern: null,
  tracking_mode: 'reps',
  image_count: 0,
  youtube_url: null,
  image_urls: null,
  has_sides: false,
  lateral_emphasis: false,
  secondary_weights: null,
  weight_source: null,
};

// ── machine_settings in sync push ─────────────────────────────────────────────

describe('pushExercise — machine_settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes machine_settings JSON to the INSERT when provided', async () => {
    const db = await import('@/db/db');
    const res = await pushPayload({
      exercises: [{ ...baseExercise, machine_settings: { 'seat height': 3, 'chest bar': 4 } }],
    });
    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('machine_settings');
    // machine_settings is param $22 — last positional before NOW()
    const msParam = params[21];
    expect(msParam).toBe(JSON.stringify({ 'seat height': 3, 'chest bar': 4 }));
  });

  it('uses EXCLUDED.machine_settings in ON CONFLICT when client sends settings', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      exercises: [{ ...baseExercise, machine_settings: { 'pad height': 2 } }],
    });
    const [sql] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('machine_settings = EXCLUDED.machine_settings');
  });

  it('uses exercises.machine_settings in ON CONFLICT when client sends null (stale push)', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      exercises: [{ ...baseExercise, machine_settings: null }],
    });
    const [sql] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('machine_settings = exercises.machine_settings');
  });

  it('uses exercises.machine_settings in ON CONFLICT when machine_settings field is absent', async () => {
    const db = await import('@/db/db');
    const { machine_settings: _omit, ...withoutMs } = { ...baseExercise, machine_settings: undefined };
    await pushPayload({ exercises: [withoutMs] });
    const [sql] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('machine_settings = exercises.machine_settings');
  });

  it('silently drops non-finite values from machine_settings', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      exercises: [
        {
          ...baseExercise,
          machine_settings: { 'seat height': 3, bad: Infinity, nan: NaN, good: 5 },
        },
      ],
    });
    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    const msParam = params[21];
    expect(JSON.parse(msParam as string)).toEqual({ 'seat height': 3, good: 5 });
  });

  it('passes null to INSERT param when machine_settings is null', async () => {
    const db = await import('@/db/db');
    await pushPayload({
      exercises: [{ ...baseExercise, machine_settings: null }],
    });
    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(params[21]).toBeNull();
  });

  it('returns 200 and calls query once per exercise', async () => {
    const db = await import('@/db/db');
    const res = await pushPayload({
      exercises: [
        { ...baseExercise, machine_settings: { 'seat height': 3 } },
        { ...baseExercise, uuid: 'ffffffff-ffff-ffff-ffff-ffffffffffff', machine_settings: null },
      ],
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(db.query).mock.calls).toHaveLength(2);
  });
});
