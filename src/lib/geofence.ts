/**
 * Geofence — home + gym arrival/exit detection via CLCircularRegion monitoring,
 * plus morning-walk auto-logging (depart-home → walk → gym → strength → walk → home).
 *
 * Wraps the native GeofencePlugin Capacitor plugin.  Falls back gracefully on
 * web (no-op) so the app remains functional outside native shells.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HomeLocationOptions {
  lat: number;
  lon: number;
  /** Geofence radius in metres. Defaults to 175 on the native side. */
  radius?: number;
}

export interface GymLocationOptions {
  lat: number;
  lon: number;
  /** Geofence radius in metres. Defaults to 100 on the native side. */
  radius?: number;
}

export interface DepartWindow {
  /** "HH:mm" in user's local timezone. */
  start: string;
  /** "HH:mm" in user's local timezone. */
  end: string;
}

export interface DepartWindows {
  weekday: DepartWindow;
  weekend: DepartWindow;
}

export interface GeofenceStatus {
  monitoring: boolean;
  homeMonitored?: boolean;
  gymMonitored?: boolean;
  autoWalkEnabled?: boolean;
  /** Home coordinates if set */
  lat?: number;
  lon?: number;
  radius?: number;
  /** Gym coordinates if set */
  gymLat?: number;
  gymLon?: number;
  gymRadius?: number;
}

export interface HomeArrivalEvent {
  timestamp: string;
}

export type WalkPhase =
  | 'idle'
  | 'walkOutboundActive'
  | 'atGymWalkSaved'
  | 'strengthActive'
  | 'walkInboundActive'
  | 'completed'
  | 'partialMissedInbound'
  | 'failedSaveAwaitingRetry'
  | 'permissionRevoked';

export interface WalkSnapshot {
  phase: WalkPhase;
  flowId: string | null;
  startedAt: string | null;
  distanceMeters: number;
  durationSeconds: number;
  lastSampleAt: string | null;
  hkWriteLikelyDenied?: boolean;
}

export interface WalkStateChangedEvent {
  phase: WalkPhase;
  flowId: string | null;
  startedAt: string | null;
  distanceMeters: number;
  durationSeconds: number;
  lastSampleAt: string | null;
}

interface GeofencePluginInterface {
  setHomeLocation(options: HomeLocationOptions): Promise<GeofenceStatus>;
  removeHomeLocation(): Promise<{ monitoring: false }>;
  setGymLocation(options: GymLocationOptions): Promise<GeofenceStatus>;
  removeGymLocation(): Promise<{ monitoring: false }>;
  setDepartWindows(options: DepartWindows): Promise<{ ok: true }>;
  setAutoWalkEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  startWalkNow(): Promise<{ started: boolean; reason?: string }>;
  cancelActiveWalk(): Promise<{ cancelled: true }>;
  getActiveWalkState(): Promise<WalkSnapshot>;
  getStatus(): Promise<GeofenceStatus>;
  simulateWalkOutbound(options?: { durationMinutes?: number }): Promise<{ simulated: true; durationMinutes: number }>;
  simulateWalkInbound(options?: { durationMinutes?: number }): Promise<{ simulated: true; durationMinutes: number }>;
  requestHKWriteAuth(): Promise<{ requested: true }>;
  deleteRecentSimulatedWalks(): Promise<{ deleted: number }>;
  addListener(
    event: 'homeArrival',
    handler: (data: HomeArrivalEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'walkStateChanged',
    handler: (data: WalkStateChangedEvent) => void
  ): Promise<PluginListenerHandle>;
}

// ── Plugin registration ───────────────────────────────────────────────────────

const GeofencePluginNative = registerPlugin<GeofencePluginInterface>('Geofence', {
  web: {
    setHomeLocation: async (options: HomeLocationOptions): Promise<GeofenceStatus> => {
      console.info('[Geofence] Web stub: setHomeLocation', options);
      return { monitoring: false };
    },
    removeHomeLocation: async () => ({ monitoring: false as const }),
    setGymLocation: async (options: GymLocationOptions): Promise<GeofenceStatus> => {
      console.info('[Geofence] Web stub: setGymLocation', options);
      return { monitoring: false };
    },
    removeGymLocation: async () => ({ monitoring: false as const }),
    setDepartWindows: async () => ({ ok: true as const }),
    setAutoWalkEnabled: async (opts: { enabled: boolean }) => ({ enabled: opts.enabled }),
    startWalkNow: async () => ({ started: false, reason: 'web' }),
    cancelActiveWalk: async () => ({ cancelled: true as const }),
    getActiveWalkState: async (): Promise<WalkSnapshot> => ({
      phase: 'idle',
      flowId: null,
      startedAt: null,
      distanceMeters: 0,
      durationSeconds: 0,
      lastSampleAt: null,
    }),
    getStatus: async (): Promise<GeofenceStatus> => ({ monitoring: false }),
    simulateWalkOutbound: async () => ({ simulated: true as const, durationMinutes: 0 }),
    simulateWalkInbound: async () => ({ simulated: true as const, durationMinutes: 0 }),
    requestHKWriteAuth: async () => ({ requested: true as const }),
    deleteRecentSimulatedWalks: async () => ({ deleted: 0 }),
    addListener: async (): Promise<PluginListenerHandle> => ({ remove: async () => {} }),
  },
});

// ── Public API — home / gym ──────────────────────────────────────────────────

export async function setHomeLocation(
  options: HomeLocationOptions
): Promise<GeofenceStatus> {
  return GeofencePluginNative.setHomeLocation(options);
}

export async function removeHomeLocation(): Promise<{ monitoring: false }> {
  return GeofencePluginNative.removeHomeLocation();
}

export async function setGymLocation(
  options: GymLocationOptions
): Promise<GeofenceStatus> {
  return GeofencePluginNative.setGymLocation(options);
}

export async function removeGymLocation(): Promise<{ monitoring: false }> {
  return GeofencePluginNative.removeGymLocation();
}

// ── Public API — windows + master toggle ─────────────────────────────────────

export async function setDepartWindows(
  windows: DepartWindows
): Promise<{ ok: true }> {
  return GeofencePluginNative.setDepartWindows(windows);
}

export async function setAutoWalkEnabled(
  enabled: boolean
): Promise<{ enabled: boolean }> {
  return GeofencePluginNative.setAutoWalkEnabled({ enabled });
}

// ── Public API — walk control ────────────────────────────────────────────────

/** Begin walk-2 immediately. Called from finishWorkout hook. */
export async function startWalkNow(): Promise<{ started: boolean; reason?: string }> {
  return GeofencePluginNative.startWalkNow();
}

/** User-initiated cancel (settings button or notification action falls back to this). */
export async function cancelActiveWalk(): Promise<{ cancelled: true }> {
  return GeofencePluginNative.cancelActiveWalk();
}

/** Pull the current walk snapshot. Use on app foreground/resume to reconcile. */
export async function getActiveWalkState(): Promise<WalkSnapshot> {
  return GeofencePluginNative.getActiveWalkState();
}

// ── DEV: simulation methods (used by the dev panel in MorningWalkSettings) ──

export async function simulateWalkOutbound(durationMinutes = 18): Promise<{ simulated: true; durationMinutes: number }> {
  return GeofencePluginNative.simulateWalkOutbound({ durationMinutes });
}

export async function simulateWalkInbound(durationMinutes = 16): Promise<{ simulated: true; durationMinutes: number }> {
  return GeofencePluginNative.simulateWalkInbound({ durationMinutes });
}

export async function requestHKWriteAuth(): Promise<{ requested: true }> {
  return GeofencePluginNative.requestHKWriteAuth();
}

export async function deleteRecentSimulatedWalks(): Promise<{ deleted: number }> {
  return GeofencePluginNative.deleteRecentSimulatedWalks();
}

// ── Public API — status ──────────────────────────────────────────────────────

export async function getGeofenceStatus(): Promise<GeofenceStatus> {
  return GeofencePluginNative.getStatus();
}

// ── Public API — listeners ───────────────────────────────────────────────────

export function onHomeArrival(
  handler: (event: HomeArrivalEvent) => void
): () => void {
  let handle: PluginListenerHandle | null = null;
  GeofencePluginNative.addListener('homeArrival', handler).then((h) => {
    handle = h;
  });
  return () => {
    handle?.remove();
  };
}

export function onWalkStateChanged(
  handler: (event: WalkStateChangedEvent) => void
): () => void {
  let handle: PluginListenerHandle | null = null;
  GeofencePluginNative.addListener('walkStateChanged', handler).then((h) => {
    handle = h;
  });
  return () => {
    handle?.remove();
  };
}

// ── Availability ─────────────────────────────────────────────────────────────

export function isGeofenceAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

// ── LocalStorage — home ──────────────────────────────────────────────────────

const LS_HOME_LAT = 'rebirth-geofence-lat';
const LS_HOME_LON = 'rebirth-geofence-lon';
const LS_HOME_RADIUS = 'rebirth-geofence-radius';

export function saveHomeLocationToLS(lat: number, lon: number, radius: number): void {
  localStorage.setItem(LS_HOME_LAT, String(lat));
  localStorage.setItem(LS_HOME_LON, String(lon));
  localStorage.setItem(LS_HOME_RADIUS, String(radius));
}

export function loadHomeLocationFromLS(): HomeLocationOptions | null {
  const lat = parseFloat(localStorage.getItem(LS_HOME_LAT) ?? '');
  const lon = parseFloat(localStorage.getItem(LS_HOME_LON) ?? '');
  const radius = parseFloat(localStorage.getItem(LS_HOME_RADIUS) ?? '175');
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon, radius };
}

export function clearHomeLocationFromLS(): void {
  localStorage.removeItem(LS_HOME_LAT);
  localStorage.removeItem(LS_HOME_LON);
  localStorage.removeItem(LS_HOME_RADIUS);
}

// ── LocalStorage — gym ───────────────────────────────────────────────────────

const LS_GYM_LAT = 'rebirth-geofence-gym-lat';
const LS_GYM_LON = 'rebirth-geofence-gym-lon';
const LS_GYM_RADIUS = 'rebirth-geofence-gym-radius';

export function saveGymLocationToLS(lat: number, lon: number, radius: number): void {
  localStorage.setItem(LS_GYM_LAT, String(lat));
  localStorage.setItem(LS_GYM_LON, String(lon));
  localStorage.setItem(LS_GYM_RADIUS, String(radius));
}

export function loadGymLocationFromLS(): GymLocationOptions | null {
  const lat = parseFloat(localStorage.getItem(LS_GYM_LAT) ?? '');
  const lon = parseFloat(localStorage.getItem(LS_GYM_LON) ?? '');
  const radius = parseFloat(localStorage.getItem(LS_GYM_RADIUS) ?? '100');
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon, radius };
}

export function clearGymLocationFromLS(): void {
  localStorage.removeItem(LS_GYM_LAT);
  localStorage.removeItem(LS_GYM_LON);
  localStorage.removeItem(LS_GYM_RADIUS);
}

// ── LocalStorage — windows + master toggle ───────────────────────────────────

const LS_DEPART_WINDOWS = 'rebirth-geofence-depart-windows';
const LS_AUTO_WALK_ENABLED = 'rebirth-geofence-auto-walk-enabled';

export const DEFAULT_DEPART_WINDOWS: DepartWindows = {
  weekday: { start: '04:30', end: '06:00' },
  weekend: { start: '05:00', end: '08:00' },
};

export function saveDepartWindowsToLS(windows: DepartWindows): void {
  localStorage.setItem(LS_DEPART_WINDOWS, JSON.stringify(windows));
}

export function loadDepartWindowsFromLS(): DepartWindows {
  const raw = localStorage.getItem(LS_DEPART_WINDOWS);
  if (!raw) return DEFAULT_DEPART_WINDOWS;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.weekday?.start && parsed?.weekday?.end &&
      parsed?.weekend?.start && parsed?.weekend?.end
    ) {
      return parsed as DepartWindows;
    }
  } catch {
    // fall through
  }
  return DEFAULT_DEPART_WINDOWS;
}

export function isAutoWalkEnabledFromLS(): boolean {
  return localStorage.getItem(LS_AUTO_WALK_ENABLED) === 'true';
}

export function saveAutoWalkEnabledToLS(enabled: boolean): void {
  localStorage.setItem(LS_AUTO_WALK_ENABLED, enabled ? 'true' : 'false');
}
