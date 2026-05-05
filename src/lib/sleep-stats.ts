/**
 * Sleep statistics helpers shared between the HealthKit sync route (deciding
 * is_main per night) and the get_health_sleep_summary MCP tool (consistency
 * score over a window). All clock-time arithmetic uses Australia/Brisbane because
 * Rebirth is single-user with that hardcoded timezone — Date.getHours() would
 * return the *server's* local hour, which is the wrong answer.
 */

const LOCAL_HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Australia/Brisbane',
  hour: '2-digit',
  hour12: false,
});

const LOCAL_MINUTE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Australia/Brisbane',
  minute: '2-digit',
});

/** Minutes since Australia/Brisbane midnight for a given Date (0..1439). */
export function localClockMinutes(d: Date): number {
  const hh = Number(LOCAL_HOUR_FORMAT.format(d));
  const mm = Number(LOCAL_MINUTE_FORMAT.format(d));
  return hh * 60 + mm;
}

/**
 * Circular statistics over clock times. Each timestamp's Brisbane-local
 * minute-of-day becomes an angle on the 24-hour circle, so 23:55 and 00:05
 * are 10 minutes apart instead of 1430. Returns mean + circular stdev in
 * minutes (von Mises approximation).
 */
export function circularClockStats(timestamps: Date[]): { mean_min: number; stdev_min: number } {
  if (timestamps.length === 0) return { mean_min: 0, stdev_min: 0 };
  const angles = timestamps.map(d => (localClockMinutes(d) / 1440) * 2 * Math.PI);
  const meanSin = angles.reduce((a, t) => a + Math.sin(t), 0) / angles.length;
  const meanCos = angles.reduce((a, t) => a + Math.cos(t), 0) / angles.length;
  const meanAngle = Math.atan2(meanSin, meanCos);
  const R = Math.sqrt(meanSin * meanSin + meanCos * meanCos);
  // Guard log(0) when all angles are identical → R≈1 → stdev 0.
  const stdevRad = R >= 0.999999 ? 0 : Math.sqrt(-2 * Math.log(R));
  const stdevMin = (stdevRad / (2 * Math.PI)) * 1440;
  const meanMin = ((meanAngle / (2 * Math.PI)) * 1440 + 1440) % 1440;
  return { mean_min: meanMin, stdev_min: stdevMin };
}

/** Format minute-of-day as `HH:MM` (24-hour). */
export function minsToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * A SleepNight is the user's "main night" iff it represents at least 4 hours
 * in bed AND the waketime falls at or after 04:00 Australia/Brisbane. Naps and
 * envelopes that wrap around to a 02:00 wake (e.g., a redeye that landed)
 * are excluded so they don't pollute averages or the consistency score.
 */
export function isMainSleepNight(inBedMin: number, endAtMs: number): boolean {
  if (inBedMin < 240) return false;
  const hour = Number(LOCAL_HOUR_FORMAT.format(new Date(endAtMs)));
  return hour >= 4;
}

/**
 * Consistency score derivation. Given main-night start_at + end_at timestamps,
 * compute circular stdev of bedtime and waketime, average them, and convert
 * to a 0..100 score (lower stdev → higher score). Returns null when fewer
 * than 5 nights have a complete envelope (statistical noise floor).
 */
export interface ConsistencyResult {
  score: number;                    // 0..100
  bedtime_stdev_min: number;
  waketime_stdev_min: number;
  typical_bedtime: string;          // 'HH:MM'
  typical_waketime: string;
}

export function consistencyScore(
  nights: { start_at: Date | null; end_at: Date | null }[],
): ConsistencyResult | null {
  const withEnvelope = nights.filter(
    (n): n is { start_at: Date; end_at: Date } => n.start_at != null && n.end_at != null,
  );
  if (withEnvelope.length < 5) return null;
  const bed = circularClockStats(withEnvelope.map(n => n.start_at));
  const wake = circularClockStats(withEnvelope.map(n => n.end_at));
  const avgStdev = (bed.stdev_min + wake.stdev_min) / 2;
  const score = Math.max(0, Math.min(100, Math.round(100 - avgStdev)));
  return {
    score,
    bedtime_stdev_min: Math.round(bed.stdev_min),
    waketime_stdev_min: Math.round(wake.stdev_min),
    typical_bedtime: minsToHHMM(bed.mean_min),
    typical_waketime: minsToHHMM(wake.mean_min),
  };
}
