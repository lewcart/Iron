import { describe, it, expect } from 'vitest';
import {
  deriveHrtContext,
  isRecentProtocolChange,
  hrtContextNote,
  type HrtTimelinePeriodInput,
} from './hrt-context';

const TODAY = '2026-05-03';

function p(overrides: Partial<HrtTimelinePeriodInput>): HrtTimelinePeriodInput {
  return {
    uuid: 'uuid-1',
    started_at: '2026-04-01',
    ended_at: null,
    name: 'Estrogel Q2 2026',
    created_at: '2026-04-01T10:00:00Z',
    ...overrides,
  };
}

describe('deriveHrtContext', () => {
  it('returns nulls when no periods exist', () => {
    expect(deriveHrtContext([], TODAY)).toEqual({
      weeks_since_protocol_change: null,
      current_period_name: null,
      current_period_started_at: null,
    });
  });

  it('returns nulls when no period is currently active (all ended in past)', () => {
    const periods = [p({ ended_at: '2026-04-01' })];
    expect(deriveHrtContext(periods, TODAY)).toEqual({
      weeks_since_protocol_change: null,
      current_period_name: null,
      current_period_started_at: null,
    });
  });

  it('skips future-dated periods (started_at > today)', () => {
    const periods = [p({ started_at: '2026-06-01' })];
    expect(deriveHrtContext(periods, TODAY)).toEqual({
      weeks_since_protocol_change: null,
      current_period_name: null,
      current_period_started_at: null,
    });
  });

  it('selects the only active period and computes weeks correctly', () => {
    // started 2026-04-01, today 2026-05-03 → 32 days = 4 weeks (floor 32/7 = 4)
    const periods = [p({ started_at: '2026-04-01', name: 'Cur' })];
    const ctx = deriveHrtContext(periods, TODAY);
    expect(ctx.weeks_since_protocol_change).toBe(4);
    expect(ctx.current_period_name).toBe('Cur');
  });

  it('most-recent started_at wins among multiple active periods', () => {
    // Both currently active. Newer (started 2026-04-15) should win.
    const periods = [
      p({ uuid: 'old', started_at: '2026-04-01', name: 'Old' }),
      p({ uuid: 'new', started_at: '2026-04-15', name: 'New' }),
    ];
    const ctx = deriveHrtContext(periods, TODAY);
    expect(ctx.current_period_name).toBe('New');
  });

  it('tiebreaks on created_at DESC when started_at matches', () => {
    const periods = [
      p({ uuid: 'first', started_at: '2026-04-15', created_at: '2026-04-15T08:00:00Z', name: 'First' }),
      p({ uuid: 'second', started_at: '2026-04-15', created_at: '2026-04-15T10:00:00Z', name: 'Second' }),
    ];
    const ctx = deriveHrtContext(periods, TODAY);
    expect(ctx.current_period_name).toBe('Second');
  });

  it('tiebreaks on uuid DESC when both started_at and created_at match', () => {
    const periods = [
      p({ uuid: 'aaa', started_at: '2026-04-15', created_at: '2026-04-15T10:00:00Z', name: 'AAA' }),
      p({ uuid: 'bbb', started_at: '2026-04-15', created_at: '2026-04-15T10:00:00Z', name: 'BBB' }),
    ];
    const ctx = deriveHrtContext(periods, TODAY);
    expect(ctx.current_period_name).toBe('BBB');
  });

  it('period ending exactly today is still considered current', () => {
    const periods = [p({ ended_at: TODAY })];
    const ctx = deriveHrtContext(periods, TODAY);
    expect(ctx.current_period_started_at).not.toBeNull();
  });

  it('period ending yesterday is NOT current', () => {
    const periods = [p({ ended_at: '2026-05-02' })];
    const ctx = deriveHrtContext(periods, TODAY);
    expect(ctx.current_period_started_at).toBeNull();
  });

  it('protocol started today: weeks=0 (not negative, not NaN)', () => {
    const periods = [p({ started_at: TODAY })];
    const ctx = deriveHrtContext(periods, TODAY);
    expect(ctx.weeks_since_protocol_change).toBe(0);
  });

  it('mid-week protocol change: prior period ended_at = new period started_at', () => {
    // Prior ended yesterday, new started today. Engine should select new.
    const periods = [
      p({ uuid: 'prior', started_at: '2026-04-01', ended_at: '2026-05-02', name: 'Prior' }),
      p({ uuid: 'new', started_at: '2026-05-03', ended_at: null, name: 'New' }),
    ];
    const ctx = deriveHrtContext(periods, TODAY);
    expect(ctx.current_period_name).toBe('New');
    expect(ctx.weeks_since_protocol_change).toBe(0);
  });
});

describe('isRecentProtocolChange', () => {
  it('true for < 4 weeks', () => {
    expect(isRecentProtocolChange({ weeks_since_protocol_change: 0, current_period_name: null, current_period_started_at: null })).toBe(true);
    expect(isRecentProtocolChange({ weeks_since_protocol_change: 3, current_period_name: null, current_period_started_at: null })).toBe(true);
  });

  it('false at exactly 4 weeks (settled)', () => {
    expect(isRecentProtocolChange({ weeks_since_protocol_change: 4, current_period_name: null, current_period_started_at: null })).toBe(false);
  });

  it('false when no current period', () => {
    expect(isRecentProtocolChange({ weeks_since_protocol_change: null, current_period_name: null, current_period_started_at: null })).toBe(false);
  });
});

describe('hrtContextNote', () => {
  it('null when no recent change', () => {
    expect(hrtContextNote({ weeks_since_protocol_change: 6, current_period_name: 'X', current_period_started_at: '2026-03-01' })).toBeNull();
  });

  it('null when no current period', () => {
    expect(hrtContextNote({ weeks_since_protocol_change: null, current_period_name: null, current_period_started_at: null })).toBeNull();
  });

  it('today-message when weeks=0', () => {
    expect(hrtContextNote({ weeks_since_protocol_change: 0, current_period_name: 'X', current_period_started_at: TODAY }))
      .toMatch(/today/);
  });

  it('singular "week" when weeks=1', () => {
    expect(hrtContextNote({ weeks_since_protocol_change: 1, current_period_name: 'X', current_period_started_at: '2026-04-26' }))
      .toMatch(/1 week ago/);
  });

  it('plural "weeks" when weeks=2..3', () => {
    expect(hrtContextNote({ weeks_since_protocol_change: 3, current_period_name: 'X', current_period_started_at: '2026-04-12' }))
      .toMatch(/3 weeks ago/);
  });
});
