import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireApiKey: vi.fn().mockReturnValue(null),
}));

vi.mock('@/db/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const { POST } = await import('./route');
  const res = await POST(toolCall(name, args));
  const body = await res.json();
  const isError = body.result?.isError;
  const text = body.result?.content?.[0]?.text;
  const result = text ? (isError ? text : JSON.parse(text)) : null;
  return { body, result, isError };
}

describe('log_inbody_scan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires scanned_at', async () => {
    const { isError, result } = await callTool('log_inbody_scan', {});
    expect(isError).toBe(true);
    expect(result).toMatch(/scanned_at/);
  });

  it('inserts and returns the parsed scan', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      uuid: 'scan-new', scanned_at: '2026-03-01T07:30:00.000Z', device: 'InBody 570',
      weight_kg: '60', pbf_pct: '22', impedance: '{}', raw_json: '{}',
      created_at: '2026-03-01T07:30:00.000Z', updated_at: '2026-03-01T07:30:00.000Z',
    });
    const { result, isError } = await callTool('log_inbody_scan', {
      scanned_at: '2026-03-01T07:30:00.000Z',
      weight_kg: 60,
      pbf_pct: 22,
    });
    expect(isError).toBeFalsy();
    expect(result.uuid).toBe('scan-new');
    expect(result.weight_kg).toBe(60);
  });
});

describe('update_inbody_scan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires uuid', async () => {
    const { isError, result } = await callTool('update_inbody_scan', {});
    expect(isError).toBe(true);
    expect(result).toMatch(/uuid/);
  });

  it('returns not-found when the scan is missing', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);
    const { isError, result } = await callTool('update_inbody_scan', { uuid: 'nope', weight_kg: 70 });
    expect(isError).toBe(true);
    expect(result).toMatch(/not found/);
  });

  it('updates and returns the patched scan', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      uuid: 'scan-1', scanned_at: '2026-03-01T07:30:00.000Z', device: 'InBody 570',
      weight_kg: '61', impedance: '{}', raw_json: '{}',
      created_at: '2026-03-01T07:30:00.000Z', updated_at: '2026-03-01T07:31:00.000Z',
    });
    const { result, isError } = await callTool('update_inbody_scan', { uuid: 'scan-1', weight_kg: 61 });
    expect(isError).toBeFalsy();
    expect(result.weight_kg).toBe(61);
  });
});

describe('get_inbody_scan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches by uuid', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      uuid: 'scan-1', scanned_at: '2026-03-01T07:30:00.000Z', device: 'InBody 570',
      impedance: '{}', raw_json: '{}',
      created_at: '2026-03-01T07:30:00.000Z', updated_at: '2026-03-01T07:30:00.000Z',
    });
    const { result, isError } = await callTool('get_inbody_scan', { uuid: 'scan-1' });
    expect(isError).toBeFalsy();
    expect(result.uuid).toBe('scan-1');
  });

  it('supports latest=true', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      uuid: 'scan-latest', scanned_at: '2026-04-01T07:30:00.000Z', device: 'InBody 570',
      impedance: '{}', raw_json: '{}',
      created_at: '2026-04-01T07:30:00.000Z', updated_at: '2026-04-01T07:30:00.000Z',
    });
    const { result, isError } = await callTool('get_inbody_scan', { latest: true });
    expect(isError).toBeFalsy();
    expect(result.uuid).toBe('scan-latest');
  });

  it('errors without uuid or latest flag', async () => {
    const { isError, result } = await callTool('get_inbody_scan', {});
    expect(isError).toBe(true);
    expect(result).toMatch(/uuid/);
  });
});

describe('list_inbody_scans', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns array from query', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([
      { uuid: 's1', scanned_at: '2026-03-01T07:30:00.000Z', device: 'InBody 570', impedance: '{}', raw_json: '{}', created_at: '2026-03-01T07:30:00.000Z', updated_at: '2026-03-01T07:30:00.000Z' },
    ]);
    const { result, isError } = await callTool('list_inbody_scans', { limit: 5 });
    expect(isError).toBeFalsy();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });
});

describe('delete_inbody_scan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires uuid', async () => {
    const { isError, result } = await callTool('delete_inbody_scan', {});
    expect(isError).toBe(true);
    expect(result).toMatch(/uuid/);
  });

  it('issues two DELETE statements and returns the deleted id', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValue([]);
    const { result, isError } = await callTool('delete_inbody_scan', { uuid: 'gone' });
    expect(isError).toBeFalsy();
    expect(result.deleted).toBe('gone');
    expect(vi.mocked(db.query).mock.calls.length).toBe(2);
  });
});

describe('compare_inbody_scans', () => {
  beforeEach(() => vi.clearAllMocks());

  it('errors if either scan is missing', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const { isError, result } = await callTool('compare_inbody_scans', { a_uuid: 'a', b_uuid: 'b' });
    expect(isError).toBe(true);
    expect(result).toMatch(/not found/);
  });

  it('computes delta and pct change across numeric fields', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      uuid: 'a', scanned_at: '2026-01-01T00:00:00.000Z', device: 'InBody 570',
      weight_kg: '60', pbf_pct: '22',
      impedance: '{}', raw_json: '{}',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }).mockResolvedValueOnce({
      uuid: 'b', scanned_at: '2026-04-01T00:00:00.000Z', device: 'InBody 570',
      weight_kg: '63', pbf_pct: '20',
      impedance: '{}', raw_json: '{}',
      created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z',
    });
    const { result, isError } = await callTool('compare_inbody_scans', { a_uuid: 'a', b_uuid: 'b' });
    expect(isError).toBeFalsy();
    expect(result.deltas.weight_kg.a).toBe(60);
    expect(result.deltas.weight_kg.b).toBe(63);
    expect(result.deltas.weight_kg.delta).toBe(3);
    expect(result.deltas.weight_kg.pct_change).toBeCloseTo(5);
    expect(result.deltas.pbf_pct.delta).toBe(-2);
  });
});

describe('body goals tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get_body_goals returns keyed map', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([
      { metric_key: 'pbf_pct', target_value: '22', unit: '%', direction: 'lower', notes: null, updated_at: '2026-03-01T00:00:00.000Z' },
    ]);
    const { result, isError } = await callTool('get_body_goals', {});
    expect(isError).toBeFalsy();
    expect(result.pbf_pct).toBeDefined();
    expect(result.pbf_pct.target_value).toBe(22);
  });

  it('set_body_goal validates required fields', async () => {
    const { isError: eUnit } = await callTool('set_body_goal', { metric_key: 'pbf_pct', target_value: 20, direction: 'lower' });
    expect(eUnit).toBe(true);
    const { isError: eDir } = await callTool('set_body_goal', { metric_key: 'pbf_pct', target_value: 20, unit: '%', direction: 'sideways' });
    expect(eDir).toBe(true);
  });

  it('set_body_goal upserts and returns the goal', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      metric_key: 'pbf_pct', target_value: '20', unit: '%', direction: 'lower', notes: null, updated_at: '2026-04-01T00:00:00.000Z',
    });
    const { result, isError } = await callTool('set_body_goal', {
      metric_key: 'pbf_pct', target_value: 20, unit: '%', direction: 'lower',
    });
    expect(isError).toBeFalsy();
    expect(result.target_value).toBe(20);
  });

  it('delete_body_goal requires metric_key', async () => {
    const { isError } = await callTool('delete_body_goal', {});
    expect(isError).toBe(true);
  });
});

describe('get_body_norm_ranges', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires sex', async () => {
    const { isError } = await callTool('get_body_norm_ranges', {});
    expect(isError).toBe(true);
  });

  it('returns ranges keyed by metric_key', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.query).mockResolvedValueOnce([
      { id: 1, sex: 'F', metric_key: 'pbf_pct', age_min: 18, age_max: null, height_min_cm: null, height_max_cm: null, low: '18', high: '28', source: 'ACSM', notes: null },
    ]);
    const { result, isError } = await callTool('get_body_norm_ranges', { sex: 'F' });
    expect(isError).toBeFalsy();
    expect(result.pbf_pct).toBeDefined();
    expect(result.pbf_pct[0].low).toBe(18);
    expect(result.pbf_pct[0].high).toBe(28);
  });
});
