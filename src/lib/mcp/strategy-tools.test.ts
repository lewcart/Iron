import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB module before importing the SUT — the tool calls `queryOne`
// for both the lookup + the upsert. We capture the SQL params to assert on
// the normalized values that get persisted.
const queryOneMock = vi.fn();
vi.mock('@/db/db', () => ({
  queryOne: (...args: unknown[]) => queryOneMock(...args),
}));

import { strategyWriteTools } from './strategy-tools';

const updateVision = strategyWriteTools.find(t => t.name === 'update_vision')!;

beforeEach(() => {
  queryOneMock.mockReset();
});

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

function parseToolText(result: ToolResult) {
  return JSON.parse(result.content[0].text);
}

async function callUpdateVision(args: Record<string, unknown>): Promise<ToolResult> {
  return (await updateVision.execute(args)) as ToolResult;
}

describe('update_vision — muscle emphasis validation (V1.1)', () => {
  it('UV1: rejects unknown slug in build_emphasis with UNKNOWN_MUSCLE', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1' }); // existing active vision
    const r = await callUpdateVision({
      uuid: 'v1',
      build_emphasis: ['delts', 'made_up_muscle'],
    });
    expect(r.isError).toBe(true);
    const body = parseToolText(r);
    expect(body.error.code).toBe('UNKNOWN_MUSCLE');
    expect(body.error.message).toMatch(/made_up_muscle/);
    expect(body.error.hint).toMatch(/list_muscles/);
  });

  it('UV2: accepts canonical slugs and persists them', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1' }); // lookup
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1', build_emphasis: ['delts', 'glutes'] }); // update
    const r = await callUpdateVision({
      uuid: 'v1',
      build_emphasis: ['delts', 'glutes'],
    });
    expect(r.isError).toBeUndefined();
    // Second call is the UPDATE; the build_emphasis array is one of the
    // positional params. Find it and assert it survived normalisation.
    const updateCall = queryOneMock.mock.calls[1];
    const [, params] = updateCall;
    const hasArr = (params as unknown[]).some(
      v => Array.isArray(v) && (v as string[]).join(',') === 'delts,glutes',
    );
    expect(hasArr).toBe(true);
  });

  it('UV3: accepts legacy synonyms and normalises them ("rear delts" → "delts", "shoulders" → "delts" deduped)', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1' });
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1' });
    const r = await callUpdateVision({
      uuid: 'v1',
      build_emphasis: ['rear delts', 'shoulders', 'delts'],
    });
    expect(r.isError).toBeUndefined();
    const updateCall = queryOneMock.mock.calls[1];
    const [, params] = updateCall;
    const buildArr = (params as unknown[]).find(
      v => Array.isArray(v) && (v as string[]).every(s => typeof s === 'string'),
    ) as string[] | undefined;
    expect(buildArr).toEqual(['delts']); // dedup all → single canonical
  });

  it('UV4: rejects unknown slug in deemphasize too', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1' });
    const r = await callUpdateVision({
      uuid: 'v1',
      deemphasize: ['nonsense'],
    });
    expect(r.isError).toBe(true);
    const body = parseToolText(r);
    expect(body.error.code).toBe('UNKNOWN_MUSCLE');
  });

  it('UV5: empty array is valid (clears emphasis)', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1' });
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1' });
    const r = await callUpdateVision({
      uuid: 'v1',
      build_emphasis: [],
    });
    expect(r.isError).toBeUndefined();
  });

  it('UV6: create branch (no active vision) also validates emphasis', async () => {
    queryOneMock.mockResolvedValueOnce(null); // no active
    const r = await callUpdateVision({
      title: 'New vision',
      build_emphasis: ['totally_made_up'],
    });
    expect(r.isError).toBe(true);
    const body = parseToolText(r);
    expect(body.error.code).toBe('UNKNOWN_MUSCLE');
  });

  it('UV7: maintain_emphasis is also normalised (e.g. "abdominals" → "core")', async () => {
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1' });
    queryOneMock.mockResolvedValueOnce({ uuid: 'v1' });
    const r = await callUpdateVision({
      uuid: 'v1',
      maintain_emphasis: ['abdominals'],
    });
    expect(r.isError).toBeUndefined();
    const updateCall = queryOneMock.mock.calls[1];
    const [, params] = updateCall;
    const arr = (params as unknown[]).find(
      v => Array.isArray(v) && (v as string[]).every(s => typeof s === 'string'),
    ) as string[] | undefined;
    expect(arr).toEqual(['core']);
  });
});
