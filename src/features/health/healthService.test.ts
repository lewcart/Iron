import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── localStorage stub ────────────────────────────────────────────────────────

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ── Capacitor + HealthKit plugin mock ────────────────────────────────────────
// vi.mock is hoisted, so use vi.hoisted() to share the mock reference.

const mockHealthKit = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  requestPermissions: vi.fn(),
  checkPermissionStatus: vi.fn(),
  getWorkouts: vi.fn(),
  getSteps: vi.fn(),
  getHeartRate: vi.fn(),
  getActiveCalories: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => mockHealthKit,
}));

// ── Import after mocks are set up ────────────────────────────────────────────

import {
  requestPermissions,
  checkPermissionStatus,
  wrapQueryResult,
  markPermissionsRequested,
  werePermissionsRequested,
  getWorkouts,
  getSteps,
  getHeartRate,
  getActiveCalories,
  type PermissionStatus,
  type WorkoutRecord,
  type HeartRateSample,
} from './healthService';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('markPermissionsRequested / werePermissionsRequested', () => {
  beforeEach(() => localStorageMock.clear());

  it('returns false before marking', () => {
    expect(werePermissionsRequested()).toBe(false);
  });

  it('returns true after marking', () => {
    markPermissionsRequested();
    expect(werePermissionsRequested()).toBe(true);
  });

  it('persists across multiple calls', () => {
    markPermissionsRequested();
    markPermissionsRequested();
    expect(werePermissionsRequested()).toBe(true);
  });
});

describe('requestPermissions', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('returns { granted: false } when HealthKit is unavailable', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: false });
    const result = await requestPermissions();
    expect(result).toEqual({ granted: false });
    expect(mockHealthKit.requestPermissions).not.toHaveBeenCalled();
  });

  it('calls native requestPermissions when available', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.requestPermissions.mockResolvedValue({ granted: true });
    const result = await requestPermissions();
    expect(result).toEqual({ granted: true });
    expect(mockHealthKit.requestPermissions).toHaveBeenCalledOnce();
  });

  it('marks permissions as requested when HealthKit is available', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.requestPermissions.mockResolvedValue({ granted: true });
    await requestPermissions();
    expect(werePermissionsRequested()).toBe(true);
  });

  it('does NOT mark permissions as requested when unavailable', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: false });
    await requestPermissions();
    expect(werePermissionsRequested()).toBe(false);
  });

  it('returns { granted: false } and does not throw on plugin error', async () => {
    mockHealthKit.isAvailable.mockRejectedValue(new Error('plugin error'));
    const result = await requestPermissions();
    expect(result).toEqual({ granted: false });
  });
});

describe('checkPermissionStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all notDetermined when HealthKit is unavailable', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: false });
    const result = await checkPermissionStatus();
    expect(result).toEqual({
      workout: 'notDetermined',
      stepCount: 'notDetermined',
      activeEnergyBurned: 'notDetermined',
      heartRate: 'notDetermined',
      distanceWalkingRunning: 'notDetermined',
    });
  });

  it('maps native statuses to typed PermissionStatus values', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.checkPermissionStatus.mockResolvedValue({
      statuses: {
        workout: 'granted',
        stepCount: 'notDetermined',
        activeEnergyBurned: 'denied',
        heartRate: 'notDetermined',
        distanceWalkingRunning: 'notDetermined',
      },
    });

    const result = await checkPermissionStatus();
    expect(result.workout).toBe<PermissionStatus>('granted');
    expect(result.activeEnergyBurned).toBe<PermissionStatus>('denied');
    expect(result.stepCount).toBe<PermissionStatus>('notDetermined');
  });

  it('falls back to notDetermined for unknown status strings', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.checkPermissionStatus.mockResolvedValue({
      statuses: { workout: 'UNKNOWN_VALUE' },
    });
    const result = await checkPermissionStatus();
    expect(result.workout).toBe<PermissionStatus>('notDetermined');
  });

  it('returns all notDetermined and does not throw on plugin error', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.checkPermissionStatus.mockRejectedValue(new Error('oops'));
    const result = await checkPermissionStatus();
    expect(Object.values(result).every(v => v === 'notDetermined')).toBe(true);
  });
});

describe('wrapQueryResult — silent denial detection', () => {
  beforeEach(() => localStorageMock.clear());

  it('possibleSilentDenial is false when permissions were never requested', () => {
    const result = wrapQueryResult([], (d) => d.length === 0);
    expect(result.possibleSilentDenial).toBe(false);
    expect(result.data).toEqual([]);
  });

  it('possibleSilentDenial is true when permissions were requested and result is empty', () => {
    markPermissionsRequested();
    const result = wrapQueryResult([], (d) => d.length === 0);
    expect(result.possibleSilentDenial).toBe(true);
  });

  it('possibleSilentDenial is false when data is present (even if permissions were requested)', () => {
    markPermissionsRequested();
    const result = wrapQueryResult([1, 2, 3], (d) => d.length === 0);
    expect(result.possibleSilentDenial).toBe(false);
    expect(result.data).toEqual([1, 2, 3]);
  });

  it('works with numeric data (e.g. step count)', () => {
    markPermissionsRequested();
    const steps = wrapQueryResult(0, (v) => v === 0);
    expect(steps.possibleSilentDenial).toBe(true);

    const stepsWithData = wrapQueryResult(4200, (v) => v === 0);
    expect(stepsWithData.possibleSilentDenial).toBe(false);
  });

  it('works with null data', () => {
    markPermissionsRequested();
    const result = wrapQueryResult(null, (v) => v === null);
    expect(result.possibleSilentDenial).toBe(true);
  });
});

// ── Query function tests ──────────────────────────────────────────────────────

const start = new Date('2026-01-01T00:00:00Z');
const end = new Date('2026-01-07T23:59:59Z');

const sampleWorkout: WorkoutRecord = {
  activityType: 'traditionalStrengthTraining',
  durationMinutes: 45,
  activeCalories: 270,
  distanceMeters: 0,
  startTime: start.getTime(),
  endTime: start.getTime() + 45 * 60 * 1000,
};

const sampleHRSample: HeartRateSample = {
  bpm: 72,
  timestamp: start.getTime() + 60_000,
};

describe('getWorkouts', () => {
  beforeEach(() => { localStorageMock.clear(); vi.clearAllMocks(); });

  it('returns empty array when HealthKit is unavailable', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: false });
    const result = await getWorkouts(start, end);
    expect(result.data).toEqual([]);
    expect(mockHealthKit.getWorkouts).not.toHaveBeenCalled();
  });

  it('returns workouts from plugin', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getWorkouts.mockResolvedValue({ workouts: [sampleWorkout] });
    const result = await getWorkouts(start, end);
    expect(result.data).toEqual([sampleWorkout]);
    expect(result.possibleSilentDenial).toBe(false);
    expect(mockHealthKit.getWorkouts).toHaveBeenCalledWith({
      startTime: start.getTime(),
      endTime: end.getTime(),
    });
  });

  it('possibleSilentDenial is true when permissions were requested and workouts are empty', async () => {
    markPermissionsRequested();
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getWorkouts.mockResolvedValue({ workouts: [] });
    const result = await getWorkouts(start, end);
    expect(result.data).toEqual([]);
    expect(result.possibleSilentDenial).toBe(true);
  });

  it('returns empty array and does not throw on plugin error', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getWorkouts.mockRejectedValue(new Error('plugin error'));
    const result = await getWorkouts(start, end);
    expect(result.data).toEqual([]);
  });
});

describe('getSteps', () => {
  beforeEach(() => { localStorageMock.clear(); vi.clearAllMocks(); });

  it('returns 0 when HealthKit is unavailable', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: false });
    const result = await getSteps(start, end);
    expect(result.data).toBe(0);
    expect(mockHealthKit.getSteps).not.toHaveBeenCalled();
  });

  it('returns step count from plugin', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getSteps.mockResolvedValue({ value: 8500 });
    const result = await getSteps(start, end);
    expect(result.data).toBe(8500);
    expect(result.possibleSilentDenial).toBe(false);
    expect(mockHealthKit.getSteps).toHaveBeenCalledWith({
      startTime: start.getTime(),
      endTime: end.getTime(),
    });
  });

  it('possibleSilentDenial is true when permissions requested and steps are 0', async () => {
    markPermissionsRequested();
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getSteps.mockResolvedValue({ value: 0 });
    const result = await getSteps(start, end);
    expect(result.possibleSilentDenial).toBe(true);
  });

  it('returns 0 and does not throw on plugin error', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getSteps.mockRejectedValue(new Error('plugin error'));
    const result = await getSteps(start, end);
    expect(result.data).toBe(0);
  });
});

describe('getHeartRate', () => {
  beforeEach(() => { localStorageMock.clear(); vi.clearAllMocks(); });

  it('returns empty array when HealthKit is unavailable', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: false });
    const result = await getHeartRate(start, end);
    expect(result.data).toEqual([]);
    expect(mockHealthKit.getHeartRate).not.toHaveBeenCalled();
  });

  it('returns HR samples from plugin', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getHeartRate.mockResolvedValue({ samples: [sampleHRSample] });
    const result = await getHeartRate(start, end);
    expect(result.data).toEqual([sampleHRSample]);
    expect(result.possibleSilentDenial).toBe(false);
    expect(mockHealthKit.getHeartRate).toHaveBeenCalledWith({
      startTime: start.getTime(),
      endTime: end.getTime(),
    });
  });

  it('possibleSilentDenial is true when permissions requested and samples are empty', async () => {
    markPermissionsRequested();
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getHeartRate.mockResolvedValue({ samples: [] });
    const result = await getHeartRate(start, end);
    expect(result.possibleSilentDenial).toBe(true);
  });

  it('returns empty array and does not throw on plugin error', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getHeartRate.mockRejectedValue(new Error('plugin error'));
    const result = await getHeartRate(start, end);
    expect(result.data).toEqual([]);
  });
});

describe('getActiveCalories', () => {
  beforeEach(() => { localStorageMock.clear(); vi.clearAllMocks(); });

  it('returns 0 when HealthKit is unavailable', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: false });
    const result = await getActiveCalories(start, end);
    expect(result.data).toBe(0);
    expect(mockHealthKit.getActiveCalories).not.toHaveBeenCalled();
  });

  it('returns calorie count from plugin', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getActiveCalories.mockResolvedValue({ value: 420 });
    const result = await getActiveCalories(start, end);
    expect(result.data).toBe(420);
    expect(result.possibleSilentDenial).toBe(false);
    expect(mockHealthKit.getActiveCalories).toHaveBeenCalledWith({
      startTime: start.getTime(),
      endTime: end.getTime(),
    });
  });

  it('possibleSilentDenial is true when permissions requested and calories are 0', async () => {
    markPermissionsRequested();
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getActiveCalories.mockResolvedValue({ value: 0 });
    const result = await getActiveCalories(start, end);
    expect(result.possibleSilentDenial).toBe(true);
  });

  it('returns 0 and does not throw on plugin error', async () => {
    mockHealthKit.isAvailable.mockResolvedValue({ available: true });
    mockHealthKit.getActiveCalories.mockRejectedValue(new Error('plugin error'));
    const result = await getActiveCalories(start, end);
    expect(result.data).toBe(0);
  });
});
