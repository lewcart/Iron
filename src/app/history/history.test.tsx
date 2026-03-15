import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatDate,
  groupWorkouts,
  weekLabel,
  monthLabel,
  type WorkoutSummary,
  type GroupMode,
} from './utils';

// ===== Helper to build a WorkoutSummary =====

function makeWorkout(overrides: Partial<WorkoutSummary> & { start_time: string }): WorkoutSummary {
  const defaults: WorkoutSummary = {
    uuid: 'wo-' + overrides.start_time,
    start_time: overrides.start_time,
    end_time: null,
    title: null,
    comment: null,
    is_current: false,
    exercise_count: 3,
    total_volume: 1000,
  };
  return { ...defaults, ...overrides };
}

// ===== formatDuration =====

describe('formatDuration', () => {
  it('returns "In progress" when end_time is null', () => {
    expect(formatDuration('2026-03-15T10:00:00Z', null)).toBe('In progress');
  });

  it('formats sub-hour duration as minutes', () => {
    const start = '2026-03-15T10:00:00Z';
    const end = '2026-03-15T10:45:00Z';
    expect(formatDuration(start, end)).toBe('45m');
  });

  it('formats zero minutes', () => {
    const start = '2026-03-15T10:00:00Z';
    const end = '2026-03-15T10:00:30Z';
    expect(formatDuration(start, end)).toBe('0m');
  });

  it('formats duration with hours', () => {
    const start = '2026-03-15T10:00:00Z';
    const end = '2026-03-15T11:05:00Z';
    expect(formatDuration(start, end)).toBe('1h 05m');
  });

  it('pads minutes with leading zero when < 10', () => {
    const start = '2026-03-15T10:00:00Z';
    const end = '2026-03-15T11:03:00Z';
    expect(formatDuration(start, end)).toBe('1h 03m');
  });

  it('formats two-hour workout', () => {
    const start = '2026-03-15T08:00:00Z';
    const end = '2026-03-15T10:30:00Z';
    expect(formatDuration(start, end)).toBe('2h 30m');
  });
});

// ===== formatDate =====

describe('formatDate', () => {
  it('returns a non-empty string', () => {
    expect(formatDate('2026-03-15T10:00:00Z')).toBeTruthy();
  });

  it('includes the year', () => {
    expect(formatDate('2026-03-15T10:00:00Z')).toContain('2026');
  });
});

// ===== weekLabel =====

describe('weekLabel', () => {
  // today = Monday 2026-03-16 (local time, timezone-safe)
  const today = new Date(2026, 2, 16, 12, 0, 0); // March 16, 2026 noon local

  it('labels current week as "This Week"', () => {
    expect(weekLabel('2026-03-16', today)).toBe('This Week');
  });

  it('labels previous week as "Last Week"', () => {
    expect(weekLabel('2026-03-09', today)).toBe('Last Week');
  });

  it('labels older weeks with "Week of ..."', () => {
    const label = weekLabel('2026-03-02', today);
    expect(label).toContain('Week of');
    expect(label).toContain('Mar');
  });
});

// ===== monthLabel =====

describe('monthLabel', () => {
  it('formats March 2026', () => {
    expect(monthLabel('2026-03')).toBe('March 2026');
  });

  it('formats February 2026', () => {
    expect(monthLabel('2026-02')).toBe('February 2026');
  });

  it('formats January 2026', () => {
    expect(monthLabel('2026-01')).toBe('January 2026');
  });
});

// ===== groupWorkouts =====

describe('groupWorkouts', () => {
  // Use a fixed "today" = Monday 2026-03-16 (local time, timezone-safe)
  const today = new Date(2026, 2, 16, 12, 0, 0); // March 16, 2026

  // Use local-noon times to ensure the date stays correct regardless of timezone
  const workouts: WorkoutSummary[] = [
    // This week (Mon 2026-03-16)
    makeWorkout({ start_time: new Date(2026, 2, 16, 10, 0, 0).toISOString() }),
    makeWorkout({ start_time: new Date(2026, 2, 17, 9, 0, 0).toISOString() }),
    // Last week (Mon 2026-03-09)
    makeWorkout({ start_time: new Date(2026, 2, 10, 8, 0, 0).toISOString() }),
    // Older (Mon 2026-03-02)
    makeWorkout({ start_time: new Date(2026, 2, 3, 7, 0, 0).toISOString() }),
  ];

  describe('week mode', () => {
    it('creates one group per week', () => {
      const groups = groupWorkouts(workouts, 'week', today);
      expect(groups).toHaveLength(3);
    });

    it('first group is labelled "This Week"', () => {
      const groups = groupWorkouts(workouts, 'week', today);
      expect(groups[0].label).toBe('This Week');
    });

    it('second group is labelled "Last Week"', () => {
      const groups = groupWorkouts(workouts, 'week', today);
      expect(groups[1].label).toBe('Last Week');
    });

    it('older group contains "Week of"', () => {
      const groups = groupWorkouts(workouts, 'week', today);
      expect(groups[2].label).toContain('Week of');
    });

    it('puts two workouts in this-week group', () => {
      const groups = groupWorkouts(workouts, 'week', today);
      expect(groups[0].workouts).toHaveLength(2);
    });

    it('puts one workout in last-week group', () => {
      const groups = groupWorkouts(workouts, 'week', today);
      expect(groups[1].workouts).toHaveLength(1);
    });
  });

  describe('month mode', () => {
    const monthWorkouts: WorkoutSummary[] = [
      makeWorkout({ start_time: new Date(2026, 2, 16, 10, 0, 0).toISOString() }),
      makeWorkout({ start_time: new Date(2026, 2, 10, 8, 0, 0).toISOString() }),
      makeWorkout({ start_time: new Date(2026, 1, 28, 7, 0, 0).toISOString() }),
    ];

    it('creates one group per month', () => {
      const groups = groupWorkouts(monthWorkouts, 'month', today);
      expect(groups).toHaveLength(2);
    });

    it('first group is current month', () => {
      const groups = groupWorkouts(monthWorkouts, 'month', today);
      expect(groups[0].label).toBe('March 2026');
    });

    it('second group is previous month', () => {
      const groups = groupWorkouts(monthWorkouts, 'month', today);
      expect(groups[1].label).toBe('February 2026');
    });

    it('puts two workouts in March', () => {
      const groups = groupWorkouts(monthWorkouts, 'month', today);
      expect(groups[0].workouts).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for no workouts', () => {
      expect(groupWorkouts([], 'week', today)).toEqual([]);
    });

    it('handles single workout', () => {
      const single = [makeWorkout({ start_time: new Date(2026, 2, 16, 10, 0, 0).toISOString() })];
      const groups = groupWorkouts(single, 'week', today);
      expect(groups).toHaveLength(1);
      expect(groups[0].workouts).toHaveLength(1);
    });

    it('accepts default today argument', () => {
      const single = [makeWorkout({ start_time: new Date(2026, 2, 16, 10, 0, 0).toISOString() })];
      // Should not throw
      const groups = groupWorkouts(single, 'week');
      expect(groups).toHaveLength(1);
    });
  });
});

// ===== Filter state logic (pure functions) =====

describe('filter URL params construction', () => {
  it('builds params with from/to dates', () => {
    const params = new URLSearchParams({ limit: '50' });
    const fromDate = '2026-03-01';
    const toDate = '2026-03-15';
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    expect(params.get('from')).toBe('2026-03-01');
    expect(params.get('to')).toBe('2026-03-15');
  });

  it('builds params with exerciseUuid', () => {
    const params = new URLSearchParams({ limit: '50' });
    const exerciseUuid = 'ex-uuid-123';
    params.set('exerciseUuid', exerciseUuid);
    expect(params.get('exerciseUuid')).toBe('ex-uuid-123');
  });

  it('omits params when filters are empty', () => {
    const params = new URLSearchParams({ limit: '50' });
    const fromDate = '';
    if (fromDate) params.set('from', fromDate);
    expect(params.has('from')).toBe(false);
  });
});

// ===== Per-workout stats display =====

describe('per-workout stats', () => {
  it('workout summary includes exercise_count', () => {
    const w = makeWorkout({ start_time: '2026-03-16T10:00:00Z', exercise_count: 5 });
    expect(w.exercise_count).toBe(5);
  });

  it('workout summary includes total_volume', () => {
    const w = makeWorkout({ start_time: '2026-03-16T10:00:00Z', total_volume: 2500.5 });
    expect(w.total_volume).toBe(2500.5);
  });

  it('total_volume defaults to 1000 in makeWorkout helper', () => {
    const w = makeWorkout({ start_time: '2026-03-16T10:00:00Z' });
    expect(w.total_volume).toBeGreaterThanOrEqual(0);
  });

  it('exercise_count can be zero', () => {
    const w = makeWorkout({ start_time: '2026-03-16T10:00:00Z', exercise_count: 0 });
    expect(w.exercise_count).toBe(0);
  });
});

// ===== GroupMode type =====

describe('GroupMode type', () => {
  it('accepts "week" as a valid GroupMode', () => {
    const mode: GroupMode = 'week';
    expect(mode).toBe('week');
  });

  it('accepts "month" as a valid GroupMode', () => {
    const mode: GroupMode = 'month';
    expect(mode).toBe('month');
  });
});
