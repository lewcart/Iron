import { describe, expect, it, vi } from 'vitest';
import { handleWatchInboundEvent, type WatchInboundDeps } from '../WatchInboundBridge';

function makeDeps(overrides: Partial<WatchInboundDeps> = {}): WatchInboundDeps {
  return {
    applySet: vi.fn(async () => {}),
    startRest: vi.fn(),
    endRest: vi.fn(),
    extendRest: vi.fn(),
    lookupExerciseContext: vi.fn(async () => ({
      exerciseUuid: 'ex-1',
      exerciseName: 'Bench Press',
      setNumber: 3,
    })),
    resolveRestSec: vi.fn(() => 90),
    autoRestEnabled: vi.fn(() => true),
    now: vi.fn(() => 1_700_000_100_000),
    ...overrides,
  };
}

describe('handleWatchInboundEvent', () => {
  describe('watchWroteSet', () => {
    it('writes the row through applySet with whitelisted fields', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent(
        {
          kind: 'watchWroteSet',
          payload: {
            row: {
              uuid: 'set-1',
              workout_exercise_uuid: 'we-1',
              weight: 100,
              repetitions: 10,
              rir: 2,
              is_completed: true,
              tag: 'dropSet',
              order_index: 2,
            },
          },
        },
        deps,
      );
      expect(deps.applySet).toHaveBeenCalledWith('set-1', expect.objectContaining({
        weight: 100,
        repetitions: 10,
        rir: 2,
        is_completed: true,
        tag: 'dropSet',
        order_index: 2,
      }));
    });

    it('sanitizes unknown tag values to null', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent(
        {
          kind: 'watchWroteSet',
          payload: { row: { uuid: 'set-1', tag: 'bogus-tag' as 'dropSet', is_completed: false } },
        },
        deps,
      );
      const call = (deps.applySet as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call?.[1]).toMatchObject({ tag: null });
    });

    it('starts the rest timer when set completes (fresh)', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent(
        {
          kind: 'watchWroteSet',
          payload: {
            row: { uuid: 'set-1', workout_exercise_uuid: 'we-1', is_completed: true },
            completed_at_ms: 1_700_000_099_000, // 1s ago vs deps.now=1_700_000_100_000
          },
        },
        deps,
      );
      expect(deps.startRest).toHaveBeenCalledWith({
        setUuid: 'set-1',
        restSec: 90,
        exerciseName: 'Bench Press',
        setNumber: 3,
      });
    });

    it('skips rest when is_completed is false', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent(
        {
          kind: 'watchWroteSet',
          payload: { row: { uuid: 'set-1', workout_exercise_uuid: 'we-1', is_completed: false } },
        },
        deps,
      );
      expect(deps.startRest).not.toHaveBeenCalled();
    });

    it('skips rest when auto-rest is disabled in settings', async () => {
      const deps = makeDeps({ autoRestEnabled: vi.fn(() => false) });
      await handleWatchInboundEvent(
        {
          kind: 'watchWroteSet',
          payload: { row: { uuid: 'set-1', workout_exercise_uuid: 'we-1', is_completed: true } },
        },
        deps,
      );
      expect(deps.startRest).not.toHaveBeenCalled();
    });

    it('queued-stale guard: skips rest when message is older than 30s', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent(
        {
          kind: 'watchWroteSet',
          payload: {
            row: { uuid: 'set-1', workout_exercise_uuid: 'we-1', is_completed: true },
            completed_at_ms: 1_700_000_065_000, // 35s ago vs now=1_700_000_100_000
          },
        },
        deps,
      );
      expect(deps.applySet).toHaveBeenCalledOnce();
      expect(deps.startRest).not.toHaveBeenCalled();
    });

    it('starts rest when completed_at_ms is missing (charitable default)', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent(
        {
          kind: 'watchWroteSet',
          payload: { row: { uuid: 'set-1', workout_exercise_uuid: 'we-1', is_completed: true } },
        },
        deps,
      );
      expect(deps.startRest).toHaveBeenCalled();
    });

    it('skips rest when workout_exercise_uuid is missing', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent(
        {
          kind: 'watchWroteSet',
          payload: { row: { uuid: 'set-1', is_completed: true } },
        },
        deps,
      );
      expect(deps.applySet).toHaveBeenCalled();
      expect(deps.startRest).not.toHaveBeenCalled();
    });

    it('skips rest when exercise context lookup returns null', async () => {
      const deps = makeDeps({ lookupExerciseContext: vi.fn(async () => null) });
      await handleWatchInboundEvent(
        {
          kind: 'watchWroteSet',
          payload: { row: { uuid: 'set-1', workout_exercise_uuid: 'we-1', is_completed: true } },
        },
        deps,
      );
      expect(deps.startRest).not.toHaveBeenCalled();
    });

    it('drops a malformed payload (missing row)', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent({ kind: 'watchWroteSet', payload: {} }, deps);
      expect(deps.applySet).not.toHaveBeenCalled();
      expect(deps.startRest).not.toHaveBeenCalled();
    });

    it('drops a row without uuid', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent(
        { kind: 'watchWroteSet', payload: { row: { weight: 100 } as { weight: number; uuid?: string } } },
        deps,
      );
      expect(deps.applySet).not.toHaveBeenCalled();
    });
  });

  describe('stopRest', () => {
    it('calls endRest with the set_uuid', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent({ kind: 'stopRest', payload: { set_uuid: 'set-1' } }, deps);
      expect(deps.endRest).toHaveBeenCalledWith({ setUuid: 'set-1' });
    });

    it('calls endRest with no setUuid when missing', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent({ kind: 'stopRest', payload: {} }, deps);
      expect(deps.endRest).toHaveBeenCalledWith({ setUuid: undefined });
    });
  });

  describe('extendRest', () => {
    it('calls extendRest with seconds', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent({ kind: 'extendRest', payload: { set_uuid: 'set-1', seconds: 30 } }, deps);
      expect(deps.extendRest).toHaveBeenCalledWith({ setUuid: 'set-1', seconds: 30 });
    });

    it('defaults to 30s when seconds missing', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent({ kind: 'extendRest', payload: { set_uuid: 'set-1' } }, deps);
      expect(deps.extendRest).toHaveBeenCalledWith({ setUuid: 'set-1', seconds: 30 });
    });
  });

  describe('unknown kinds', () => {
    it('silently ignores unrecognized event kinds', async () => {
      const deps = makeDeps();
      await handleWatchInboundEvent({ kind: 'futureField', payload: {} }, deps);
      expect(deps.applySet).not.toHaveBeenCalled();
      expect(deps.startRest).not.toHaveBeenCalled();
      expect(deps.endRest).not.toHaveBeenCalled();
      expect(deps.extendRest).not.toHaveBeenCalled();
    });
  });
});
