// @vitest-environment jsdom
//
// Regression tests for the "RIR reverts after checking off a set" race.
//
// The live-session flow: tapping the checkmark writes is_completed + an
// auto-filled RIR and schedules a push (+500ms). Adjusting the RIR chip a
// second later lands while that push's HTTP request is in flight. Two holes
// in the sync engine then eat the edit:
//
//   1. push() marked every row from its pre-fetch dirty snapshot
//      _synced: true — including rows re-modified mid-flight — so the RIR
//      edit was stamped "clean" without ever being sent.
//   2. pull()/applyChanges() bulkPut server rows over locally-dirty rows,
//      so the push's own CDC echo (carrying the stale RIR) overwrote the
//      local row on the next poll. That's the visible revert.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, setMeta } from '@/db/local';
import { syncEngine } from '@/lib/sync';

function makeSet(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'set-1',
    workout_exercise_uuid: 'we-1',
    weight: 60,
    repetitions: 8,
    min_target_reps: null,
    max_target_reps: null,
    rpe: null,
    rir: 2,
    tag: null,
    comment: null,
    is_completed: true,
    is_pr: false,
    excluded_from_pb: false,
    order_index: 0,
    duration_seconds: null,
    _synced: false,
    _updated_at: 1000,
    _deleted: false,
    ...overrides,
  };
}

describe('sync engine — set edited while push is in flight', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map(t => t.clear()));
    await setMeta('last_seq', 0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('push() leaves a row dirty when it was re-modified during the HTTP request', async () => {
    await db.workout_sets.add(makeSet() as never);

    // Deferred fetch: hold the push request open so we can edit mid-flight.
    let resolvePush!: (r: Response) => void;
    const pushGate = new Promise<Response>(res => { resolvePush = res; });
    const fetchMock = vi.fn().mockReturnValue(pushGate);
    vi.stubGlobal('fetch', fetchMock);

    const pushPromise = syncEngine.push();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Lou taps a different RIR chip while the push is in flight.
    await db.workout_sets.update('set-1', { rir: 0, _synced: false, _updated_at: 2000 });

    resolvePush(new Response('{}', { status: 200 }));
    await pushPromise;

    const row = await db.workout_sets.get('set-1');
    expect(row?.rir).toBe(0);
    // The RIR edit was never sent — the row must still be dirty so the next
    // push carries it. Before the fix this was stamped _synced: true.
    expect(row?._synced).toBe(false);
  });

  it('pull() does not overwrite a locally-dirty row with the server echo', async () => {
    // Local row carries an unpushed RIR edit.
    await db.workout_sets.add(makeSet({ rir: 0, _updated_at: 2000 }) as never);

    // Server echo of the earlier push still has the stale RIR.
    const changesResponse = {
      changes: [{ seq: 1, table_name: 'workout_sets', row_uuid: 'set-1', op: 'update' }],
      rows: { workout_sets: [makeSet({ rir: 2 })] },
      max_seq: 1,
      has_more: false,
    };
    const emptyResponse = { changes: [], rows: {}, max_seq: 1, has_more: false };
    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call += 1;
      const body = call === 1 ? changesResponse : emptyResponse;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }));

    await syncEngine.pull();

    const row = await db.workout_sets.get('set-1');
    // Dirty local edit wins; it pushes on the next cycle. Before the fix the
    // bulkPut overwrote rir back to 2 and stamped the row clean.
    expect(row?.rir).toBe(0);
    expect(row?._synced).toBe(false);
  });

  it('pull() still applies server rows to clean local rows', async () => {
    await db.workout_sets.add(makeSet({ rir: 2, _synced: true }) as never);

    const changesResponse = {
      changes: [{ seq: 1, table_name: 'workout_sets', row_uuid: 'set-1', op: 'update' }],
      rows: { workout_sets: [makeSet({ rir: 3 })] },
      max_seq: 1,
      has_more: false,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(changesResponse), { status: 200 }),
    ));

    await syncEngine.pull();

    const row = await db.workout_sets.get('set-1');
    expect(row?.rir).toBe(3);
    expect(row?._synced).toBe(true);
  });
});
