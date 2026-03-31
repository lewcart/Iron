import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveHomeLocationToLS,
  loadHomeLocationFromLS,
  clearHomeLocationFromLS,
  isGeofenceAvailable,
  onHomeArrival,
} from './geofence';

// ── localStorage stub ────────────────────────────────────────────────────────

const store: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ── Capacitor stub ───────────────────────────────────────────────────────────

vi.mock('@capacitor/core', () => ({
  registerPlugin: (_name: string, opts: Record<string, unknown>) => opts['web'],
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('saveHomeLocationToLS / loadHomeLocationFromLS', () => {
  beforeEach(() => localStorageMock.clear());

  it('round-trips lat/lon/radius through localStorage', () => {
    saveHomeLocationToLS(51.5074, -0.1278, 175);
    const loaded = loadHomeLocationFromLS();
    expect(loaded).toEqual({ lat: 51.5074, lon: -0.1278, radius: 175 });
  });

  it('returns null when nothing is persisted', () => {
    expect(loadHomeLocationFromLS()).toBeNull();
  });

  it('returns null when lat is missing', () => {
    localStorage.setItem('rebirth-geofence-lon', '-0.1278');
    expect(loadHomeLocationFromLS()).toBeNull();
  });

  it('returns null when lon is missing', () => {
    localStorage.setItem('rebirth-geofence-lat', '51.5074');
    expect(loadHomeLocationFromLS()).toBeNull();
  });

  it('falls back to radius 175 when radius key is absent', () => {
    localStorage.setItem('rebirth-geofence-lat', '51.5074');
    localStorage.setItem('rebirth-geofence-lon', '-0.1278');
    const loaded = loadHomeLocationFromLS();
    expect(loaded?.radius).toBe(175);
  });
});

describe('clearHomeLocationFromLS', () => {
  beforeEach(() => localStorageMock.clear());

  it('removes all geofence keys', () => {
    saveHomeLocationToLS(51.5, -0.1, 150);
    clearHomeLocationFromLS();
    expect(loadHomeLocationFromLS()).toBeNull();
  });

  it('is idempotent when nothing is stored', () => {
    expect(() => clearHomeLocationFromLS()).not.toThrow();
  });
});

describe('isGeofenceAvailable', () => {
  it('returns false on web (Capacitor mock returns isNativePlatform=false)', () => {
    expect(isGeofenceAvailable()).toBe(false);
  });
});

describe('web stub (setHomeLocation / removeHomeLocation / getStatus)', () => {
  beforeEach(() => localStorageMock.clear());

  it('setHomeLocation resolves with monitoring:false on web', async () => {
    const { setHomeLocation } = await import('./geofence');
    const result = await setHomeLocation({ lat: 51.5, lon: -0.1, radius: 175 });
    expect(result.monitoring).toBe(false);
  });

  it('removeHomeLocation resolves with monitoring:false on web', async () => {
    const { removeHomeLocation } = await import('./geofence');
    const result = await removeHomeLocation();
    expect(result.monitoring).toBe(false);
  });

  it('getGeofenceStatus resolves with monitoring:false on web', async () => {
    const { getGeofenceStatus } = await import('./geofence');
    const result = await getGeofenceStatus();
    expect(result.monitoring).toBe(false);
  });
});

describe('onHomeArrival', () => {
  it('returns an unsubscribe function that does not throw', () => {
    const unsub = onHomeArrival(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});
