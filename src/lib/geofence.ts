/**
 * Geofence — home arrival detection via CLCircularRegion monitoring.
 *
 * Wraps the native GeofencePlugin Capacitor plugin.  Falls back gracefully on
 * web (no-op) so the app remains functional outside native shells.
 *
 * Usage:
 *   await setHomeLocation({ lat: 51.5, lon: -0.1 });
 *   const unsub = onHomeArrival(() => finishWorkout(currentWorkoutUuid));
 *   // later…
 *   unsub();
 *   await removeHomeLocation();
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

export interface GeofenceStatus {
  monitoring: boolean;
  lat?: number;
  lon?: number;
  radius?: number;
}

export interface HomeArrivalEvent {
  timestamp: string; // ISO-8601
}

interface GeofencePluginInterface {
  setHomeLocation(options: HomeLocationOptions): Promise<GeofenceStatus>;
  removeHomeLocation(): Promise<{ monitoring: false }>;
  getStatus(): Promise<GeofenceStatus>;
  addListener(
    event: 'homeArrival',
    handler: (data: HomeArrivalEvent) => void
  ): Promise<PluginListenerHandle>;
}

// ── Plugin registration ───────────────────────────────────────────────────────

const GeofencePluginNative = registerPlugin<GeofencePluginInterface>('Geofence', {
  // Web stub — all methods are no-ops that resolve immediately.
  web: {
    setHomeLocation: async (options: HomeLocationOptions): Promise<GeofenceStatus> => {
      console.info('[Geofence] Web stub: setHomeLocation', options);
      return { monitoring: false };
    },
    removeHomeLocation: async () => {
      return { monitoring: false as const };
    },
    getStatus: async (): Promise<GeofenceStatus> => {
      return { monitoring: false };
    },
    addListener: async (
      _event: string,
      _handler: (data: HomeArrivalEvent) => void
    ): Promise<PluginListenerHandle> => {
      return { remove: async () => {} };
    },
  },
});

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register the home geofence region.
 *
 * On iOS, prompts for "Always" location permission if not already granted.
 * Persists the region so it survives app termination and is re-registered on
 * background relaunch.
 */
export async function setHomeLocation(
  options: HomeLocationOptions
): Promise<GeofenceStatus> {
  return GeofencePluginNative.setHomeLocation(options);
}

/**
 * Remove the home geofence region and stop monitoring.
 */
export async function removeHomeLocation(): Promise<{ monitoring: false }> {
  return GeofencePluginNative.removeHomeLocation();
}

/**
 * Get the current geofence monitoring status.
 */
export async function getGeofenceStatus(): Promise<GeofenceStatus> {
  return GeofencePluginNative.getStatus();
}

/**
 * Subscribe to home-arrival events.
 *
 * The callback fires after the 30-second dwell threshold is met (i.e. the user
 * has remained inside the geofence for ≥30 s — not just a brief pass-through).
 *
 * Returns an unsubscribe function.
 */
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

/**
 * Returns true when the geofence plugin is available (native iOS only).
 */
export function isGeofenceAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

// ── LocalStorage keys for persisting user-configured home location ────────────

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
