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

// ── Morning walk automation ──────────────────────────────────────────────────

import {
  DEFAULT_DEPART_WINDOWS,
  saveDepartWindowsToLS,
  loadDepartWindowsFromLS,
  saveAutoWalkEnabledToLS,
  isAutoWalkEnabledFromLS,
  saveGymLocationToLS,
  loadGymLocationFromLS,
  clearGymLocationFromLS,
  type WalkPhase,
} from './geofence';

// Mirror of the Swift native gate (GeofencePlugin.isWithinDepartWindow).
// Kept in sync manually — if the Swift logic changes, update both.
function isWithinDepartWindow(
  now: Date,
  weekday: { start: string; end: string },
  weekend: { start: string; end: string }
): boolean {
  const day = now.getDay(); // 0=Sun..6=Sat
  const isWeekend = day === 0 || day === 6;
  const window = isWeekend ? weekend : weekday;
  const [sh, sm] = window.start.split(':').map(Number);
  const [eh, em] = window.end.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= sh * 60 + sm && nowMinutes < eh * 60 + em;
}

describe('depart window logic (parity with native gate)', () => {
  const wd = DEFAULT_DEPART_WINDOWS.weekday;
  const we = DEFAULT_DEPART_WINDOWS.weekend;

  it('weekday at 04:35 falls inside the weekday window', () => {
    const d = new Date(2026, 4, 6, 4, 35); // Wed 2026-05-06
    expect(isWithinDepartWindow(d, wd, we)).toBe(true);
  });

  it('weekday at 06:30 falls outside (window closed)', () => {
    const d = new Date(2026, 4, 6, 6, 30);
    expect(isWithinDepartWindow(d, wd, we)).toBe(false);
  });

  it('weekday at 06:00 sharp is outside (half-open interval)', () => {
    const d = new Date(2026, 4, 6, 6, 0);
    expect(isWithinDepartWindow(d, wd, we)).toBe(false);
  });

  it('weekday at 04:30 sharp is inside', () => {
    const d = new Date(2026, 4, 6, 4, 30);
    expect(isWithinDepartWindow(d, wd, we)).toBe(true);
  });

  it('Saturday at 04:45 is outside (weekend window starts later)', () => {
    const d = new Date(2026, 4, 9, 4, 45); // Sat
    expect(isWithinDepartWindow(d, wd, we)).toBe(false);
  });

  it('Saturday at 05:30 is inside the weekend window', () => {
    const d = new Date(2026, 4, 9, 5, 30);
    expect(isWithinDepartWindow(d, wd, we)).toBe(true);
  });

  it('Sunday at 09:00 is outside (after weekend window)', () => {
    const d = new Date(2026, 4, 10, 9, 0); // Sun
    expect(isWithinDepartWindow(d, wd, we)).toBe(false);
  });

  it('weekday at 03:00 is outside (before window opens)', () => {
    const d = new Date(2026, 4, 6, 3, 0);
    expect(isWithinDepartWindow(d, wd, we)).toBe(false);
  });
});

describe('depart windows persistence', () => {
  beforeEach(() => localStorageMock.clear());

  it('returns defaults when nothing stored', () => {
    expect(loadDepartWindowsFromLS()).toEqual(DEFAULT_DEPART_WINDOWS);
  });

  it('round-trips a custom value', () => {
    const custom = {
      weekday: { start: '05:00', end: '07:00' },
      weekend: { start: '06:00', end: '09:00' },
    };
    saveDepartWindowsToLS(custom);
    expect(loadDepartWindowsFromLS()).toEqual(custom);
  });

  it('falls back to defaults on malformed JSON', () => {
    localStorage.setItem('rebirth-geofence-depart-windows', 'not-json');
    expect(loadDepartWindowsFromLS()).toEqual(DEFAULT_DEPART_WINDOWS);
  });

  it('falls back to defaults if shape is wrong', () => {
    localStorage.setItem(
      'rebirth-geofence-depart-windows',
      JSON.stringify({ weekday: { start: '05:00' } })
    );
    expect(loadDepartWindowsFromLS()).toEqual(DEFAULT_DEPART_WINDOWS);
  });
});

describe('auto-walk master toggle persistence', () => {
  beforeEach(() => localStorageMock.clear());

  it('defaults to false when unset', () => {
    expect(isAutoWalkEnabledFromLS()).toBe(false);
  });

  it('round-trips true', () => {
    saveAutoWalkEnabledToLS(true);
    expect(isAutoWalkEnabledFromLS()).toBe(true);
  });

  it('flipping back to false sticks', () => {
    saveAutoWalkEnabledToLS(true);
    saveAutoWalkEnabledToLS(false);
    expect(isAutoWalkEnabledFromLS()).toBe(false);
  });
});

describe('gym location persistence', () => {
  beforeEach(() => localStorageMock.clear());

  it('returns null when nothing stored', () => {
    expect(loadGymLocationFromLS()).toBeNull();
  });

  it('round-trips a gym location', () => {
    saveGymLocationToLS(51.5, -0.12, 100);
    expect(loadGymLocationFromLS()).toEqual({ lat: 51.5, lon: -0.12, radius: 100 });
  });

  it('clearGymLocationFromLS wipes all keys', () => {
    saveGymLocationToLS(51.5, -0.12, 100);
    clearGymLocationFromLS();
    expect(loadGymLocationFromLS()).toBeNull();
  });

  it('uses default radius (100) if radius key is missing', () => {
    localStorage.setItem('rebirth-geofence-gym-lat', '51.5');
    localStorage.setItem('rebirth-geofence-gym-lon', '-0.12');
    expect(loadGymLocationFromLS()).toEqual({ lat: 51.5, lon: -0.12, radius: 100 });
  });
});

describe('WalkPhase enum surface', () => {
  // Exhaustive switch test — if a new phase is added without updating the
  // type here, tsc fails. Guards consumers from missing a state.
  it('every phase has a UI label', () => {
    const labelFor = (p: WalkPhase): string => {
      switch (p) {
        case 'idle': return 'Idle';
        case 'walkOutboundActive': return 'Walking to gym';
        case 'atGymWalkSaved': return 'At gym, walk saved';
        case 'strengthActive': return 'Strength workout active';
        case 'walkInboundActive': return 'Walking home';
        case 'completed': return 'Completed';
        case 'partialMissedInbound': return 'Walk to gym saved, return walk missed';
        case 'failedSaveAwaitingRetry': return 'Health save failed, retry pending';
        case 'permissionRevoked': return 'Permission revoked';
      }
    };
    const all: WalkPhase[] = [
      'idle', 'walkOutboundActive', 'atGymWalkSaved', 'strengthActive',
      'walkInboundActive', 'completed', 'partialMissedInbound',
      'failedSaveAwaitingRetry', 'permissionRevoked',
    ];
    for (const p of all) {
      expect(labelFor(p)).toBeTruthy();
    }
  });
});
