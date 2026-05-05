import { describe, expect, it, vi } from 'vitest';
import {
  RestTimerStore,
  TIMER_OVERTIME_START_KEY,
  TIMER_SET_UUID_KEY,
} from '@/lib/rest-timer-state';
import {
  TIMER_DURATION_KEY,
  TIMER_END_KEY,
  type TimerStorage,
} from '@/app/workout/rest-timer-utils';

function memStorage(): TimerStorage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
    dump: () => Object.fromEntries(m),
  };
}

interface FakeTimer {
  fire: () => void;
  cancel: () => void;
}

function fakeScheduler() {
  let now = 1_700_000_000_000; // fixed epoch
  const handles = new Map<number, FakeTimer>();
  let nextId = 1;
  return {
    now: () => now,
    advance(ms: number) {
      const target = now + ms;
      while (now < target) {
        const next = Math.min(now + 500, target);
        now = next;
        for (const h of [...handles.values()]) h.fire();
      }
    },
    set(t: number) {
      now = t;
    },
    scheduler: {
      setInterval: (cb: () => void) => {
        const id = nextId++;
        handles.set(id, { fire: cb, cancel: () => handles.delete(id) });
        return id;
      },
      clearInterval: (id: unknown) => {
        const h = handles.get(id as number);
        h?.cancel();
        handles.delete(id as number);
      },
      now: () => now,
    },
    handleCount: () => handles.size,
  };
}

function fakeLiveActivity() {
  return {
    start: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
  };
}

describe('RestTimerStore', () => {
  describe('start', () => {
    it('initializes state and persists to storage', () => {
      const sched = fakeScheduler();
      const storage = memStorage();
      const la = fakeLiveActivity();
      const s = new RestTimerStore({ storage, liveActivity: la, scheduler: sched.scheduler, getKeepRunning: () => false });
      const r = s.start({ setUuid: 'set-1', restSec: 90 });
      expect(r).toEqual({ started: true });
      const snap = s.getSnapshot();
      expect(snap?.set_uuid).toBe('set-1');
      expect(snap?.duration_sec).toBe(90);
      expect(snap?.end_at_ms).toBe(sched.now() + 90_000);
      expect(snap?.overtime_start_ms).toBeNull();
      // Persistence
      expect(storage.dump()[TIMER_DURATION_KEY]).toBe('90');
      expect(storage.dump()[TIMER_SET_UUID_KEY]).toBe('set-1');
      expect(la.start).toHaveBeenCalledOnce();
    });

    it('rejects duplicate start within dedup window', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      const a = s.start({ setUuid: 'set-1', restSec: 90 });
      const b = s.start({ setUuid: 'set-1', restSec: 90 });
      expect(a.started).toBe(true);
      expect(b.started).toBe(false);
    });

    it('accepts re-start with the same setUuid after dedup window', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      s.start({ setUuid: 'set-1', restSec: 90 });
      sched.advance(6_000);
      const r = s.start({ setUuid: 'set-1', restSec: 60 });
      expect(r.started).toBe(true);
      expect(s.getSnapshot()?.duration_sec).toBe(60);
    });

    it('accepts a different setUuid immediately', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      s.start({ setUuid: 'set-1', restSec: 90 });
      const r = s.start({ setUuid: 'set-2', restSec: 60 });
      expect(r.started).toBe(true);
      expect(s.getSnapshot()?.set_uuid).toBe('set-2');
    });

    it('dedup with completedAtMs: same setUuid + same completedAtMs is a duplicate', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      const a = s.start({ setUuid: 'set-1', restSec: 90, completedAtMs: 1_700_000_000_000 });
      const b = s.start({ setUuid: 'set-1', restSec: 90, completedAtMs: 1_700_000_000_000 });
      expect(a.started).toBe(true);
      expect(b.started).toBe(false);
    });

    it('dedup with completedAtMs: same setUuid + DIFFERENT completedAtMs starts a new timer (review C4)', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      const a = s.start({ setUuid: 'set-1', restSec: 90, completedAtMs: 1_700_000_000_000 });
      // Lou un-completed and recomplete — same setUuid, different completedAtMs.
      // Within the 5s time window, but the completedAtMs identity disambiguates.
      const b = s.start({ setUuid: 'set-1', restSec: 60, completedAtMs: 1_700_000_002_500 });
      expect(a.started).toBe(true);
      expect(b.started).toBe(true);
      expect(s.getSnapshot()?.duration_sec).toBe(60);
    });

    it('dedup fallback (no completedAtMs on either side): time-window heuristic still applies', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      const a = s.start({ setUuid: 'set-1', restSec: 90 });
      const b = s.start({ setUuid: 'set-1', restSec: 90 });
      expect(a.started).toBe(true);
      expect(b.started).toBe(false);
    });
  });

  describe('extend', () => {
    it('bumps end_at_ms and clears overtime', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => true });
      s.start({ setUuid: 'set-1', restSec: 1 });
      sched.advance(2_000); // crosses zero, enters overtime
      expect(s.getSnapshot()?.overtime_start_ms).not.toBeNull();
      s.extend(30);
      const snap = s.getSnapshot();
      expect(snap?.overtime_start_ms).toBeNull();
      expect(snap?.end_at_ms).toBeGreaterThan(sched.now());
    });

    it('is a no-op when no rest is active', () => {
      const sched = fakeScheduler();
      const la = fakeLiveActivity();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: la, scheduler: sched.scheduler });
      s.extend(30);
      expect(s.getSnapshot()).toBeNull();
      expect(la.update).not.toHaveBeenCalled();
    });
  });

  describe('end', () => {
    it('clears state and storage', () => {
      const sched = fakeScheduler();
      const storage = memStorage();
      const la = fakeLiveActivity();
      const s = new RestTimerStore({ storage, liveActivity: la, scheduler: sched.scheduler });
      s.start({ setUuid: 'set-1', restSec: 90 });
      s.end();
      expect(s.getSnapshot()).toBeNull();
      expect(storage.dump()[TIMER_END_KEY]).toBeUndefined();
      expect(la.end).toHaveBeenCalledOnce();
    });

    it('respects setUuid filter (does not end a different timer)', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler });
      s.start({ setUuid: 'set-1', restSec: 90 });
      s.end({ setUuid: 'set-2' });
      expect(s.getSnapshot()?.set_uuid).toBe('set-1');
      s.end({ setUuid: 'set-1' });
      expect(s.getSnapshot()).toBeNull();
    });
  });

  describe('zero-cross', () => {
    it('fires onZeroCross callback exactly once', () => {
      const sched = fakeScheduler();
      const onZero = vi.fn();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => true });
      s.start({ setUuid: 'set-1', restSec: 1, onZeroCross: onZero });
      sched.advance(2_000);
      expect(onZero).toHaveBeenCalledOnce();
      sched.advance(2_000);
      expect(onZero).toHaveBeenCalledOnce();
    });

    it('survives a thrown onZeroCross (still ends timer when keep-running off)', () => {
      const sched = fakeScheduler();
      const onZero = vi.fn(() => {
        throw new Error('audio context unavailable');
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      s.start({ setUuid: 'set-1', restSec: 1, onZeroCross: onZero });
      sched.advance(2_000);
      expect(onZero).toHaveBeenCalledOnce();
      // State machine should still progress: keep-running=false → end → state=null
      expect(s.getSnapshot()).toBeNull();
      consoleSpy.mockRestore();
    });

    it('re-arms onZeroCross after extend out of overtime (review C2)', () => {
      const sched = fakeScheduler();
      const onZero = vi.fn();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => true });
      s.start({ setUuid: 'set-1', restSec: 1, onZeroCross: onZero });
      sched.advance(2_000); // crosses zero, fires once
      expect(onZero).toHaveBeenCalledOnce();
      s.extend(1); // bumps to "now + 1s"
      sched.advance(2_000); // crosses zero again
      expect(onZero).toHaveBeenCalledTimes(2);
    });
  });

  describe('extend during overtime (review C3)', () => {
    it('clamps endAtMs to now + delta when extending while in overtime', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => true });
      s.start({ setUuid: 'set-1', restSec: 1 });
      const startedAt = sched.now();
      sched.advance(10_000); // we're 9s deep in overtime
      const beforeExtendNow = sched.now();
      s.extend(30);
      const after = s.getSnapshot();
      expect(after?.end_at_ms).toBe(beforeExtendNow + 30_000);
      // sanity: must NOT be the naive (originalEnd + 30s) which would still be in the past
      expect(after?.end_at_ms).toBeGreaterThan(startedAt + 1_000);
    });

    it('extending during countdown adds delta to existing endAtMs (no clamp needed)', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler });
      s.start({ setUuid: 'set-1', restSec: 90 });
      const beforeExtend = s.getSnapshot();
      s.extend(30);
      const after = s.getSnapshot();
      expect(after?.end_at_ms).toBe((beforeExtend?.end_at_ms ?? 0) + 30_000);
    });

    it('with keep-running: enters overtime', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => true });
      s.start({ setUuid: 'set-1', restSec: 1 });
      sched.advance(2_000);
      const snap = s.getSnapshot();
      expect(snap?.overtime_start_ms).not.toBeNull();
      expect(s.getDerived().isOvertime).toBe(true);
    });

    it('without keep-running: ends the timer', () => {
      const sched = fakeScheduler();
      const la = fakeLiveActivity();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: la, scheduler: sched.scheduler, getKeepRunning: () => false });
      s.start({ setUuid: 'set-1', restSec: 1 });
      sched.advance(2_000);
      expect(s.getSnapshot()).toBeNull();
      expect(la.end).toHaveBeenCalled();
    });
  });

  describe('hydration', () => {
    it('reads persisted state on construction', () => {
      const storage = memStorage();
      const futureMs = 1_700_000_090_000;
      storage.setItem(TIMER_END_KEY, String(futureMs));
      storage.setItem(TIMER_DURATION_KEY, '90');
      storage.setItem(TIMER_SET_UUID_KEY, 'set-9');
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage, liveActivity: fakeLiveActivity(), scheduler: sched.scheduler });
      const snap = s.getSnapshot();
      expect(snap?.set_uuid).toBe('set-9');
      expect(snap?.end_at_ms).toBe(futureMs);
    });

    it('hydrates with overtime_start_ms', () => {
      const storage = memStorage();
      storage.setItem(TIMER_END_KEY, '1700000090000');
      storage.setItem(TIMER_DURATION_KEY, '90');
      storage.setItem(TIMER_SET_UUID_KEY, 'set-9');
      storage.setItem(TIMER_OVERTIME_START_KEY, '1700000090000');
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage, liveActivity: fakeLiveActivity(), scheduler: sched.scheduler });
      expect(s.getSnapshot()?.overtime_start_ms).toBe(1_700_000_090_000);
    });

    it('returns null state if persisted data is malformed', () => {
      const storage = memStorage();
      storage.setItem(TIMER_END_KEY, 'not a number');
      storage.setItem(TIMER_DURATION_KEY, '90');
      const s = new RestTimerStore({ storage, liveActivity: fakeLiveActivity(), scheduler: fakeScheduler().scheduler });
      expect(s.getSnapshot()).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('notifies on state changes', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      const cb = vi.fn();
      s.subscribe(cb);
      s.start({ setUuid: 'set-1', restSec: 90 });
      expect(cb).toHaveBeenCalled();
      const lastCallArgs = cb.mock.calls[cb.mock.calls.length - 1];
      expect(lastCallArgs[0]?.set_uuid).toBe('set-1');
    });

    it('returns an unsubscribe fn', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      const cb = vi.fn();
      const unsub = s.subscribe(cb);
      unsub();
      s.start({ setUuid: 'set-1', restSec: 90 });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('resync (foreground transition)', () => {
    it('fires zero-cross handler if backgrounded past endTime', () => {
      const sched = fakeScheduler();
      const onZero = vi.fn();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => false });
      s.start({ setUuid: 'set-1', restSec: 1, onZeroCross: onZero });
      // simulate going to background — clock jumps without ticks firing
      sched.set(sched.now() + 5_000);
      s.resync();
      expect(onZero).toHaveBeenCalledOnce();
      expect(s.getSnapshot()).toBeNull();
    });

    it('is a no-op when state is null', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler });
      s.resync();
      expect(s.getSnapshot()).toBeNull();
    });
  });

  describe('derived state', () => {
    it('reports remaining seconds while counting down', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => true });
      s.start({ setUuid: 'set-1', restSec: 90 });
      sched.advance(30_000);
      const d = s.getDerived();
      expect(d.running).toBe(true);
      expect(d.isOvertime).toBe(false);
      expect(d.remaining).toBe(60);
      expect(d.progress).toBeCloseTo(60 / 90, 1);
    });

    it('reports overtime seconds after zero-cross', () => {
      const sched = fakeScheduler();
      const s = new RestTimerStore({ storage: memStorage(), liveActivity: fakeLiveActivity(), scheduler: sched.scheduler, getKeepRunning: () => true });
      s.start({ setUuid: 'set-1', restSec: 1 });
      sched.advance(11_000);
      const d = s.getDerived();
      expect(d.isOvertime).toBe(true);
      expect(d.overtime).toBeGreaterThanOrEqual(9);
    });
  });
});
