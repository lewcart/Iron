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

const EX_UUID = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';

// ── update_exercise — machine_settings ────────────────────────────────────────

describe('update_exercise — machine_settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves valid named settings and returns the updated row', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: EX_UUID }) // existence check
      .mockResolvedValueOnce({ uuid: EX_UUID, title: 'Chest Press Machine', machine_settings: { 'chest bar': 4, 'seat height': 3 } }); // UPDATE RETURNING

    const { isError, result } = await callTool('update_exercise', {
      uuid: EX_UUID,
      machine_settings: { 'chest bar': 4, 'seat height': 3 },
    });

    expect(isError).toBeFalsy();
    expect(result.machine_settings).toEqual({ 'chest bar': 4, 'seat height': 3 });

    const updateCall = vi.mocked(db.queryOne).mock.calls[1];
    const sql = updateCall[0] as string;
    expect(sql).toContain('machine_settings = $');
    const settingsArg = (updateCall[1] as unknown[]).find(
      v => typeof v === 'string' && v.includes('chest bar'),
    );
    expect(JSON.parse(settingsArg as string)).toEqual({ 'chest bar': 4, 'seat height': 3 });
  });

  it('accepts null to clear all settings', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: EX_UUID })
      .mockResolvedValueOnce({ uuid: EX_UUID, machine_settings: null });

    const { isError, result } = await callTool('update_exercise', {
      uuid: EX_UUID,
      machine_settings: null,
    });

    expect(isError).toBeFalsy();
    expect(result.machine_settings).toBeNull();

    const updateCall = vi.mocked(db.queryOne).mock.calls[1];
    const sql = updateCall[0] as string;
    expect(sql).toContain('machine_settings = $');
    // The null value should appear in params
    const params = updateCall[1] as unknown[];
    expect(params).toContain(null);
  });

  it('rejects a non-finite value with a clear error', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: EX_UUID });

    const { isError, result } = await callTool('update_exercise', {
      uuid: EX_UUID,
      machine_settings: { 'seat height': Infinity },
    });

    expect(isError).toBeTruthy();
    expect(result).toContain('machine_settings["seat height"] must be a finite number');
  });

  it('rejects an array (not an object)', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: EX_UUID });

    const { isError, result } = await callTool('update_exercise', {
      uuid: EX_UUID,
      machine_settings: ['seat height', 3],
    });

    expect(isError).toBeTruthy();
    expect(result).toContain('machine_settings must be an object');
  });

  it('accepts empty object (clears to no settings)', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ uuid: EX_UUID })
      .mockResolvedValueOnce({ uuid: EX_UUID, machine_settings: {} });

    const { isError, result } = await callTool('update_exercise', {
      uuid: EX_UUID,
      machine_settings: {},
    });

    expect(isError).toBeFalsy();
    const updateCall = vi.mocked(db.queryOne).mock.calls[1];
    const params = updateCall[1] as unknown[];
    const settingsArg = params.find(v => typeof v === 'string' && v.startsWith('{'));
    expect(JSON.parse(settingsArg as string)).toEqual({});
  });

  it('returns error when exercise not found', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce(null);

    const { isError, result } = await callTool('update_exercise', {
      uuid: EX_UUID,
      machine_settings: { 'seat height': 3 },
    });

    expect(isError).toBeTruthy();
    expect(result).toContain('not found');
  });

  it('returns error when no fields provided', async () => {
    const db = await import('@/db/db');
    vi.mocked(db.queryOne).mockResolvedValueOnce({ uuid: EX_UUID });

    const { isError, result } = await callTool('update_exercise', { uuid: EX_UUID });

    expect(isError).toBeTruthy();
    expect(result).toContain('No fields to update');
  });
});
