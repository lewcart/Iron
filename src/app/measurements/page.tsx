'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Trash2, ImageIcon, Activity, Target, Plus, GitCompare, Move, Tag } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUnit } from '@/context/UnitContext';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from 'recharts';
import type { InbodyScan, MeasurementLog, ProjectionPhoto, InspoPhoto, ProgressPhotoPose } from '@/types';
import type { LocalProgressPhoto } from '@/db/local';
import { useMeasurements, useProgressPhotos, useInbodyScans, useBodyGoal } from '@/lib/useLocalDB-measurements';
import { logMeasurement, deleteMeasurement, deleteProgressPhoto } from '@/lib/mutations-measurements';
import { logBodyweight, deleteBodyweightLog } from '@/lib/mutations';
import { useBodyweightLogs } from '@/lib/useLocalDB';
import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { Sheet } from '@/components/ui/sheet';
import { isLocalStub } from '@/lib/photo-upload-queue';
import { PhotoSheet } from './PhotoSheet';
import { InbodyScanSheet } from './InbodyScanSheet';
import { AdjustOffsetDialog, type AdjustablePhotoKind } from './AdjustOffsetDialog';
import { AlignedPhoto } from './AlignedPhoto';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';
import { ALL_POSES, POSE_LABELS, isComparablePose } from '@/lib/poses';

const SITES = [
  { key: 'shoulder_width', label: 'Shoulder Width' },
  { key: 'waist',          label: 'Waist' },
  { key: 'hips',           label: 'Hips' },
  { key: 'upper_arm',      label: 'Upper Arm' },
  { key: 'thigh',          label: 'Thigh' },
] as const;

type SiteKey = typeof SITES[number]['key'];
type TabKey = 'measurements' | 'photos' | 'inbody';

// Distinct Tailwind-equivalent colors for multi-site overlay (no --chart-N tokens in globals.css)
const SITE_COLORS: Record<SiteKey, string> = {
  shoulder_width: '#f43f5e', // rose-500
  waist:          '#3b82f6', // blue-500
  hips:           '#10b981', // emerald-500
  thigh:          '#f97316', // orange-500
  upper_arm:      '#a855f7', // purple-500
};

// Three writers populate measurement_logs.site with different conventions:
// the UI input form uses these SITE keys; InBody auto-insert writes left_bicep/
// right_bicep/left_thigh/right_thigh; MCP update_body_comp writes left_arm/
// right_arm/left_thigh/right_thigh. The chart/snapshot needs to surface all of
// them under the matching UI tab.
const SITE_ALIASES: Record<SiteKey, readonly string[]> = {
  shoulder_width: ['shoulder_width'],
  waist:          ['waist'],
  hips:           ['hips', 'hip'],
  upper_arm:      ['upper_arm', 'left_arm', 'right_arm', 'left_bicep', 'right_bicep'],
  thigh:          ['thigh', 'left_thigh', 'right_thigh'],
};

function siteGroup(rawSite: string): SiteKey | null {
  for (const s of SITES) {
    if (SITE_ALIASES[s.key].includes(rawSite)) return s.key;
  }
  return null;
}

function humanizeSite(rawSite: string): string {
  const known = SITES.find(s => s.key === rawSite);
  if (known) return known.label;
  return rawSite
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// InBody metric key used for trend chart reference lines.
// PBF% is the headline metric most users track; reference-line enrichment targets it.
const INBODY_TREND_METRIC: keyof InbodyScan = 'pbf_pct';

// Always render in Lou's London time. Without timeZone the formatter falls
// through to the device's tz, which on a non-London Mac would emit a different
// calendar date than the photoGroups grouping (which is forced to London),
// producing two cards that both display as e.g. "15 Apr 2026" but were keyed
// by different dates in the Map.
function formatDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Europe/London',
  });
}

function formatChartDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short',
    timeZone: 'Europe/London',
  });
}

function toDateInputValue(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function MeasurementsInner() {
  const { fromInput, toDisplay, label } = useUnit();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams?.get('tab') as TabKey | null) ?? 'measurements';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  // All reads come from Dexie via useLiveQuery — no spinner needed beyond
  // the brief first-tick before useLiveQuery resolves. The local types are
  // structurally compatible with the @/types server types (extra _synced /
  // _updated_at / _deleted fields on local rows are harmless extras).
  const logs = useMeasurements({ limit: 90 }) as unknown as MeasurementLog[];
  const photos = useProgressPhotos(50);
  const inbodyScans = useInbodyScans(50) as unknown as InbodyScan[];
  const inbodyGoal = useBodyGoal(INBODY_TREND_METRIC);
  const bwLogs = useBodyweightLogs(30);
  const loading = false;
  const photosLoading = false;
  const inbodyLoading = false;

  // Measurements state
  const [date, setDate] = useState(toDateInputValue);
  const [inputs, setInputs] = useState<Partial<Record<SiteKey, string>>>({});
  const [weightInput, setWeightInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [chartSite, setChartSite] = useState<SiteKey>('waist');
  const [logSheetOpen, setLogSheetOpen] = useState(false);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [inbodySheetOpen, setInbodySheetOpen] = useState(false);

  // Compare flow: lightweight existence checks so the "Compare with…" CTAs
  // only render when there's something to compare against. The compare page
  // itself loads the full lists.
  const [projectionCount, setProjectionCount] = useState<number | null>(null);
  const [inspoCount, setInspoCount] = useState<number | null>(null);
  const openCompare = useCallback((sourceUuid: string, kind: 'projection' | 'inspo') => {
    router.push(`/photos/compare?source=${sourceUuid}&kind=${kind}&mode=side`);
  }, [router]);
  useEffect(() => {
    fetchJsonAuthed<ProjectionPhoto[]>(`${apiBase()}/api/projection-photos?limit=1`)
      .then((rows) => setProjectionCount(rows.length))
      .catch(() => setProjectionCount(0));
    fetchJsonAuthed<InspoPhoto[]>(`${apiBase()}/api/inspo-photos?limit=200`)
      .then((rows) => {
        const posed = rows.filter((r) => isComparablePose(r.pose));
        setInspoCount(posed.length);
      })
      .catch(() => setInspoCount(0));
  }, []);

  // Adjust mode (manual head-y nudge). Holds the photo + its kind so the
  // dialog knows which API route to PATCH on save. `onSaved` (when set by
  // the caller) lets the originating view refresh its own state — e.g. the
  // CompareDialog needs to update the displayed offset without reopening.
  const [adjustState, setAdjustState] = useState<{
    photo: { uuid: string; blob_url: string; crop_offset_y: number | null; crop_offset_x: number | null };
    kind: AdjustablePhotoKind;
    blob?: Blob | null;
    mask_url?: string | null;
    onSaved?: (offsets: { x: number | null; y: number | null }) => void;
  } | null>(null);

  const handleAdjustSaved = useCallback(async (offsets: { x: number | null; y: number | null }) => {
    if (!adjustState) return;
    // For progress photos we also write to Dexie so live queries reflect the
    // change instantly and the sync engine pushes both axes next pass.
    if (adjustState.kind === 'progress') {
      try {
        await db.progress_photos.update(adjustState.photo.uuid, {
          crop_offset_y: offsets.y,
          crop_offset_x: offsets.x,
          _synced: false,
          _updated_at: Date.now(),
        });
        syncEngine.schedulePush();
      } catch { /* non-fatal */ }
    }
    adjustState.onSaved?.(offsets);
  }, [adjustState]);

  // Retag a progress photo's pose. Optimistic Dexie update so the gallery
  // re-groups instantly; PATCH the server in parallel so the change syncs.
  const handleRetagPose = useCallback(async (
    photo: LocalProgressPhoto,
    pose: ProgressPhotoPose,
  ) => {
    if (photo.pose === pose) return;
    try {
      // Local-first: Dexie write triggers useLiveQuery re-render. Mark
      // dirty so the sync engine carries the value forward on next push.
      await db.progress_photos.update(photo.uuid, {
        pose,
        _synced: false,
        _updated_at: Date.now(),
      });
      syncEngine.schedulePush();
    } catch { /* non-fatal — server PATCH is the source of truth anyway */ }
    // Server PATCH (best-effort; sync engine will retry if this fails).
    if (!isLocalStub(photo.blob_url)) {
      try {
        await fetchJsonAuthed(`${apiBase()}/api/progress-photos/${photo.uuid}`, {
          method: 'PATCH',
          body: JSON.stringify({ pose }),
        });
      } catch { /* non-fatal */ }
    }
  }, []);

  const handleSaveMeasurements = async () => {
    const hasAny = SITES.some(s => inputs[s.key]) || !!weightInput;
    if (!hasAny) return;
    setSaving(true);
    try {
      const measured_at = date ? new Date(date).toISOString() : undefined;
      const writes: Promise<unknown>[] = [];

      for (const site of SITES) {
        const val = inputs[site.key];
        if (val) {
          writes.push(logMeasurement({ site: site.key, value_cm: parseFloat(val), measured_at }));
        }
      }

      if (weightInput) {
        writes.push(logBodyweight(fromInput(parseFloat(weightInput))));
      }

      await Promise.all(writes);

      // useLiveQuery picks up the new rows automatically — no manual setLogs.
      setInputs({});
      setWeightInput('');
      setDate(toDateInputValue());
      setLogSheetOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMeasurement = async (uuid: string) => {
    await deleteMeasurement(uuid);
  };

  const handleDeleteBodyweight = async (uuid: string) => {
    await deleteBodyweightLog(uuid);
  };

  const handleDeletePhoto = async (uuid: string) => {
    await deleteProgressPhoto(uuid);
  };

  // Single-site chart data (mobile + iPad portrait). Group by calendar day
  // and average across aliases — left_bicep + right_bicep on the same InBody
  // scan day average to one upper-arm point. Single-entry days pass through
  // unchanged (avg of one is the value).
  const chartData = (() => {
    const byDay = new Map<string, { measured_at: string; sum: number; count: number }>();
    for (const l of logs) {
      if (!SITE_ALIASES[chartSite].includes(l.site)) continue;
      const day = l.measured_at.slice(0, 10);
      const existing = byDay.get(day) ?? { measured_at: l.measured_at, sum: 0, count: 0 };
      existing.sum += parseFloat(String(l.value_cm));
      existing.count += 1;
      if (l.measured_at > existing.measured_at) existing.measured_at = l.measured_at;
      byDay.set(day, existing);
    }
    return Array.from(byDay.values())
      .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
      .slice(-30)
      .map(({ measured_at, sum, count }) => ({
        date: formatChartDate(measured_at),
        value: Math.round((sum / count) * 10) / 10,
      }));
  })();

  // Multi-site chart data (lg:+) — one row per calendar day, with each UI
  // site averaged across its aliases for that day.
  const multiSiteChartData = (() => {
    type Bucket = {
      measured_at: string;
      sums: Partial<Record<SiteKey, { sum: number; count: number }>>;
    };
    const byDay = new Map<string, Bucket>();
    for (const log of logs) {
      const group = siteGroup(log.site);
      if (!group) continue;
      const day = log.measured_at.slice(0, 10);
      const bucket = byDay.get(day) ?? { measured_at: log.measured_at, sums: {} };
      const cur = bucket.sums[group] ?? { sum: 0, count: 0 };
      cur.sum += parseFloat(String(log.value_cm));
      cur.count += 1;
      bucket.sums[group] = cur;
      if (log.measured_at > bucket.measured_at) bucket.measured_at = log.measured_at;
      byDay.set(day, bucket);
    }
    return Array.from(byDay.values())
      .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
      .slice(-30)
      .map(({ measured_at, sums }) => {
        const row: { date: string } & Partial<Record<SiteKey, number>> = {
          date: formatChartDate(measured_at),
        };
        for (const s of SITES) {
          const agg = sums[s.key];
          if (agg) row[s.key] = Math.round((agg.sum / agg.count) * 10) / 10;
        }
        return row;
      });
  })();

  // Most recent value per site (for snapshot row). For each UI site, find the
  // most-recent calendar day with any aliased entry, then average all rows
  // from that day. `logs` is sorted desc by measured_at, so logs[0] within a
  // group identifies the latest day.
  const latestBySite: Partial<Record<SiteKey, { value_cm: number; measured_at: string }>> = {};
  for (const site of SITES) {
    const matched = logs.filter(l => SITE_ALIASES[site.key].includes(l.site));
    if (matched.length === 0) continue;
    const latestDay = matched[0].measured_at.slice(0, 10);
    const sameDay = matched.filter(l => l.measured_at.slice(0, 10) === latestDay);
    const avg = sameDay.reduce((acc, l) => acc + parseFloat(String(l.value_cm)), 0) / sameDay.length;
    latestBySite[site.key] = {
      value_cm: Math.round(avg * 10) / 10,
      measured_at: matched[0].measured_at,
    };
  }

  const hasInput = SITES.some(s => inputs[s.key]) || !!weightInput;

  // InBody trend chart — uses PBF% by default, most recent scans oldest-first
  const inbodyTrendData = inbodyScans
    .filter(s => s[INBODY_TREND_METRIC] != null)
    .slice(0, 30)
    .reverse()
    .map(s => ({
      date: formatChartDate(s.scanned_at),
      value: typeof s[INBODY_TREND_METRIC] === 'number' ? (s[INBODY_TREND_METRIC] as number) : null,
    }))
    .filter(p => p.value != null);

  const previousScanValue = (() => {
    if (inbodyScans.length < 2) return null;
    const v = inbodyScans[1]?.[INBODY_TREND_METRIC];
    return typeof v === 'number' ? v : null;
  })();

  const goalValue = typeof inbodyGoal?.target_value === 'number' ? inbodyGoal.target_value : null;

  // ── Section renderers (extracted so CSS-only show/hide at md:+ is trivial) ──

  const measurementsSection = (
    <div className="space-y-4">
      {/* Current snapshot */}
      {(Object.keys(latestBySite).length > 0) && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Current</p>
          <div className="ios-section">
            <div className="ios-row flex-wrap gap-x-6 gap-y-2 py-2">
              {SITES.filter(s => latestBySite[s.key]).map(s => (
                <div key={s.key} className="flex flex-col">
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                  <span className="text-sm font-medium">{latestBySite[s.key]!.value_cm} cm</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Trend chart */}
      {!loading && logs.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Trend</p>
          <div className="ios-section">
            {/* Single-site selector — hidden at lg:+ (multi-site overlay takes over) */}
            <div className="ios-row flex-wrap gap-2 py-1 lg:hidden">
              {SITES.map(s => (
                <button
                  key={s.key}
                  onClick={() => setChartSite(s.key)}
                  className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                    chartSite === s.key
                      ? 'bg-primary text-white border-primary'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Mobile + iPad portrait: single-site line chart */}
            <div className="lg:hidden">
              {chartData.length > 1 ? (
                <div className="px-1 py-2">
                  <div className="h-[200px] md:h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                          tickLine={false}
                          axisLine={false}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: 12,
                          }}
                          formatter={(v) => [`${v} cm`, SITES.find(s => s.key === chartSite)?.label ?? chartSite]}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={chartData.length <= 10}
                          activeDot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground px-2 pb-3">
                  Log at least 2 entries for {SITES.find(s => s.key === chartSite)?.label.toLowerCase()} to see a trend.
                </p>
              )}
            </div>

            {/* Desktop / iPad landscape (lg:+): 4-site overlay with legend */}
            <div className="hidden lg:block">
              {multiSiteChartData.length > 1 ? (
                <div className="px-1 py-2">
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={multiSiteChartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                          tickLine={false}
                          axisLine={false}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: 12,
                          }}
                        />
                        <Legend verticalAlign="top" align="right" iconSize={10} wrapperStyle={{ fontSize: '12px' }} />
                        {SITES.map(s => (
                          <Line
                            key={s.key}
                            type="monotone"
                            dataKey={s.key}
                            name={s.label}
                            stroke={SITE_COLORS[s.key]}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground px-2 pb-3">
                  Log entries across multiple sites to see the overlay.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History — grouped by calendar day. Lou often saves multiple sites in
          one Sheet submit, which creates N rows in measurement_logs. Showing
          them as N separate History rows is noisy, so we collapse same-day
          entries into one card. If a site appears twice in the same day we
          keep only the latest (logs are pre-sorted desc by measured_at, so
          the first match wins). */}
      {!loading && logs.length > 0 && (() => {
        type DayEntry = { log: MeasurementLog; label: string };
        type DayGroup = { day: string; measured_at: string; entries: DayEntry[] };

        const byDay = new Map<string, DayGroup>();
        for (const log of logs) {
          const day = log.measured_at.slice(0, 10);
          const label = humanizeSite(log.site);
          const group = byDay.get(day) ?? { day, measured_at: log.measured_at, entries: [] };
          // Keep only the latest entry per site label within a day
          if (!group.entries.some(e => e.label === label)) {
            group.entries.push({ log, label });
          }
          if (log.measured_at > group.measured_at) group.measured_at = log.measured_at;
          byDay.set(day, group);
        }
        const groups = Array.from(byDay.values())
          .sort((a, b) => b.measured_at.localeCompare(a.measured_at))
          .slice(0, 30);

        return (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">History</p>
            <div className="space-y-2">
              {groups.map(group => {
                if (group.entries.length === 1) {
                  // Compact single-row layout — matches pre-grouping look
                  const { log, label } = group.entries[0];
                  return (
                    <div key={group.day} className="ios-section">
                      <div className="ios-row justify-between">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{label}</span>
                          <span className="text-sm text-muted-foreground ml-2">{log.value_cm} cm</span>
                        </div>
                        <span className="text-xs text-muted-foreground mr-3">
                          {formatDate(log.measured_at)}
                        </span>
                        <button
                          onClick={() => handleDeleteMeasurement(log.uuid)}
                          className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                }

                // Multi-site day — header row with the date, then a sub-row per site
                return (
                  <div key={group.day} className="ios-section">
                    <div className="ios-row justify-between border-b border-border">
                      <span className="text-sm font-semibold">{formatDate(group.measured_at)}</span>
                      <span className="text-xs text-muted-foreground">{group.entries.length} sites</span>
                    </div>
                    {group.entries.map((e, i) => (
                      <div
                        key={e.log.uuid}
                        className={`ios-row justify-between ${i < group.entries.length - 1 ? 'border-b border-border' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{e.label}</span>
                          <span className="text-sm text-muted-foreground ml-2">{e.log.value_cm} cm</span>
                        </div>
                        <button
                          onClick={() => handleDeleteMeasurement(e.log.uuid)}
                          className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {!loading && logs.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">No measurements logged yet.</p>
      )}

      {/* Bodyweight history — bodyweight entries (logged here or via the
          measurement Sheet) live alongside the rest of the measurement
          history rather than over in Settings. */}
      {bwLogs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Bodyweight</p>
          <div className="ios-section">
            {bwLogs.map((log, i) => (
              <div
                key={log.uuid}
                className={`ios-row justify-between ${i < bwLogs.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">
                    {toDisplay(log.weight_kg)} {label}
                  </span>
                  {log.note && (
                    <span className="text-xs text-muted-foreground ml-2">{log.note}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground mr-3">
                  {formatDate(log.logged_at)}
                </span>
                <button
                  onClick={() => handleDeleteBodyweight(log.uuid)}
                  className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // Group photos by calendar date (local) so a single capture session reads
  // as one entry rather than 3-6. Within a group, sort poses in canonical
  // order (front → side → back → face_front → face_side → other). Edge
  // case: if Lou retakes a pose on the same day, all of those photos appear
  // in the group.
  const photoGroups = useMemo(() => {
    const POSE_ORDER: Record<string, number> = {
      front: 0, side: 1, back: 2, face_front: 3, face_side: 4, other: 5,
    };
    const byDate = new Map<string, LocalProgressPhoto[]>();
    // Group by Lou's local (London) date, not UTC. Photos taken near
    // midnight London time straddle UTC dates and would otherwise split
    // a single capture session across two cards. en-CA gives YYYY-MM-DD.
    const LOCALE = 'en-CA';
    const TZ = 'Europe/London';
    for (const p of photos) {
      const date = new Date(p.taken_at).toLocaleDateString(LOCALE, { timeZone: TZ });
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(p);
    }
    const groups = Array.from(byDate.entries())
      .map(([date, ps]) => ({
        date,
        photos: ps.sort((a, b) => {
          const pa = POSE_ORDER[a.pose] ?? 99;
          const pb = POSE_ORDER[b.pose] ?? 99;
          if (pa !== pb) return pa - pb;
          return a.taken_at.localeCompare(b.taken_at);
        }),
        // For sort: use the earliest taken_at in the group (so order is by
        // date/time, not by pose).
        sortKey: ps.reduce((min, p) => (p.taken_at < min ? p.taken_at : min), ps[0].taken_at),
      }))
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return groups;
  }, [photos]);

  const photosSection = (
    <div className="space-y-4">
      {/* Compare banner — show when at least one target exists. */}
      {photos.length > 0 && (
        (projectionCount !== null && projectionCount > 0) ||
        (inspoCount !== null && inspoCount > 0)
      ) && (
        <div className="flex flex-wrap gap-2">
          {projectionCount !== null && projectionCount > 0 && (
            <Link
              href="/projections"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-trans-blue/10 border border-trans-blue/30 text-trans-blue text-xs font-medium flex-1 min-w-[200px]"
            >
              <GitCompare className="h-3.5 w-3.5" />
              <span>Compare with projection</span>
              <span className="ml-auto opacity-60">→</span>
            </Link>
          )}
          {inspoCount !== null && inspoCount > 0 && (
            <Link
              href="/inspo"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-trans-pink/10 border border-trans-pink/30 text-trans-pink text-xs font-medium flex-1 min-w-[200px]"
            >
              <GitCompare className="h-3.5 w-3.5" />
              <span>Compare with inspo</span>
              <span className="ml-auto opacity-60">→</span>
            </Link>
          )}
        </div>
      )}

      {/* Gallery — one card per date with an inline pose strip. */}
      {!photosLoading && photoGroups.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Gallery</p>
          <div className="space-y-3">
            {photoGroups.map((group) => (
              // overflow-visible (not the default ios-section overflow-hidden)
              // so per-tile action dropdowns can stack over neighbouring
              // cells without being clipped.
              <div key={group.date} className="rounded-xl bg-card relative">
                <div className="px-4 py-2 flex items-center justify-between border-b border-border/40">
                  <span className="text-sm font-medium">{formatDate(group.sortKey)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {group.photos.length} {group.photos.length === 1 ? 'shot' : 'shots'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 p-1">
                  {group.photos.map((photo) => (
                    <PhotoTile
                      key={photo.uuid}
                      photo={photo}
                      onDelete={handleDeletePhoto}
                      onCompare={(kind) => openCompare(photo.uuid, kind)}
                      onAdjust={() =>
                        setAdjustState({
                          photo: {
                            uuid: photo.uuid,
                            blob_url: photo.blob_url,
                            crop_offset_y: photo.crop_offset_y,
                            crop_offset_x: photo.crop_offset_x ?? null,
                          },
                          kind: 'progress',
                          blob: photo.blob,
                          mask_url: photo.mask_url ?? null,
                        })
                      }
                      onRetagPose={(pose) => handleRetagPose(photo, pose)}
                      hasProjection={(projectionCount ?? 0) > 0}
                      hasInspo={(inspoCount ?? 0) > 0}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!photosLoading && photos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <ImageIcon className="h-12 w-12 md:h-16 md:w-16 mb-3 opacity-20" />
          <p className="text-sm">No progress photos yet.</p>
          <p className="text-xs mt-1">Tap + to upload your first photo.</p>
        </div>
      )}
    </div>
  );

  const inbodySection = (
    <div className="space-y-4">
      {/* Action row — "New Scan" lives behind the page-header "+" button now */}
      <div className="flex items-center gap-2 flex-wrap">
        {inbodyScans.length >= 2 && (
          <Link
            href="/measurements/inbody/compare"
            className="flex items-center gap-2 px-3 py-2 border border-border text-sm font-medium rounded-lg"
          >
            Compare
          </Link>
        )}
        <Link
          href="/measurements/goals"
          className="flex items-center gap-2 px-3 py-2 border border-border text-sm font-medium rounded-lg"
        >
          <Target className="h-4 w-4" />
          Goals
        </Link>
        {photos.length > 0 && ((projectionCount ?? 0) > 0 || (inspoCount ?? 0) > 0) && (
          <button
            onClick={() => {
              // Pick the newest non-stub progress photo regardless of pose.
              const usable = photos
                .filter((p) => !isLocalStub(p.blob_url))
                .sort((a, b) => b.taken_at.localeCompare(a.taken_at));
              const src = usable[0];
              if (!src) return;
              openCompare(src.uuid, (projectionCount ?? 0) > 0 ? 'projection' : 'inspo');
            }}
            className="flex items-center gap-2 px-3 py-2 border border-trans-blue/30 text-trans-blue text-sm font-medium rounded-lg"
          >
            <GitCompare className="h-4 w-4" />
            Compare photos
          </button>
        )}
      </div>

      {inbodyLoading && <p className="text-xs text-muted-foreground px-1">Loading scans…</p>}

      {!inbodyLoading && inbodyScans.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Activity className="h-12 w-12 md:h-16 md:w-16 mb-3 opacity-20" />
          <p className="text-sm">No InBody scans yet.</p>
          <p className="text-xs mt-1">Hand-enter your first scan from the sheet.</p>
        </div>
      )}

      {/* Trend chart — PBF% with goal + previous-scan reference lines */}
      {!inbodyLoading && inbodyTrendData.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">PBF% Trend</p>
          <div className="ios-section">
            <div className="px-1 py-2">
              <div className="h-[200px] md:h-[320px] lg:h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={inbodyTrendData} margin={{ top: 4, right: 24, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: 12,
                      }}
                      formatter={(v) => [`${v}%`, 'PBF']}
                    />
                    {goalValue != null && (
                      <ReferenceLine
                        y={goalValue}
                        stroke="currentColor"
                        strokeDasharray="4 4"
                        opacity={0.5}
                        label={{ value: 'Goal', position: 'right', fill: 'currentColor', fontSize: 10 }}
                      />
                    )}
                    {previousScanValue != null && (
                      <ReferenceLine
                        y={previousScanValue}
                        stroke="currentColor"
                        strokeDasharray="2 6"
                        opacity={0.4}
                        label={{ value: 'Prev', position: 'right', fill: 'currentColor', fontSize: 10 }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={inbodyTrendData.length <= 10}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {!inbodyLoading && inbodyScans.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Scans</p>
          <div className="space-y-2">
            {inbodyScans.map(scan => (
              <Link
                key={scan.uuid}
                href={`/measurements/inbody/detail?uuid=${scan.uuid}`}
                className="block rounded-2xl bg-card border border-border p-4 active:scale-[0.99] transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{formatDate(scan.scanned_at)}</div>
                    <div className="text-xs text-muted-foreground">{scan.device}{scan.venue ? ` · ${scan.venue}` : ''}</div>
                  </div>
                  {scan.inbody_score != null && (
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Score</div>
                      <div className="text-lg font-bold">{scan.inbody_score}</div>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
                  {scan.weight_kg != null && (
                    <div><span className="text-muted-foreground">Weight </span><span className="font-medium">{scan.weight_kg} kg</span></div>
                  )}
                  {scan.pbf_pct != null && (
                    <div><span className="text-muted-foreground">PBF </span><span className="font-medium">{scan.pbf_pct}%</span></div>
                  )}
                  {scan.smm_kg != null && (
                    <div><span className="text-muted-foreground">SMM </span><span className="font-medium">{scan.smm_kg} kg</span></div>
                  )}
                  {scan.visceral_fat_level != null && (
                    <div><span className="text-muted-foreground">VFL </span><span className="font-medium">{scan.visceral_fat_level}</span></div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <main className="tab-content bg-background">
      <div className="max-w-lg md:max-w-5xl mx-auto">
        <div className="px-4 pt-safe pb-4 flex items-center gap-3">
          <Link href="/settings" className="text-primary p-1 -ml-1">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">Measurements</h1>
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'photos') setPhotoSheetOpen(true);
              else if (activeTab === 'inbody') setInbodySheetOpen(true);
              else setLogSheetOpen(true);
            }}
            className="ml-auto flex items-center justify-center text-muted-foreground min-h-[44px] min-w-[44px]"
            aria-label={
              activeTab === 'photos'
                ? 'Add photo'
                : activeTab === 'inbody'
                  ? 'New InBody scan'
                  : 'Log measurement'
            }
          >
            <Plus className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Mobile tab switcher — hidden at md:+ (grid renders all three sections) */}
        <div className="flex border-b border-border mx-4 mb-4 md:hidden">
          {(['measurements', 'photos', 'inbody'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground'
              }`}
            >
              {tab === 'measurements' ? 'Measurements' : tab === 'photos' ? 'Photos' : 'InBody'}
            </button>
          ))}
        </div>

        {/* Content grid:
            - mobile: single column, section visibility driven by activeTab
            - md:+    3-column grid, all three sections visible side-by-side
                     layout hierarchy (D1): InBody left (col-span-2), Measurements+Photos stacked right (col-span-1)
        */}
        <div className="px-4 pb-8 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 auto-rows-min">
          {/* InBody — primary pane on iPad (md:col-span-2), hidden on mobile unless tab active */}
          <section
            className={`${activeTab === 'inbody' ? 'block' : 'hidden'} md:block md:col-span-2 md:row-span-2`}
          >
            {inbodySection}
          </section>

          {/* Measurements — right rail top */}
          <section
            className={`${activeTab === 'measurements' ? 'block' : 'hidden'} md:block md:col-span-1`}
          >
            {measurementsSection}
          </section>

          {/* Photos — right rail bottom */}
          <section
            className={`${activeTab === 'photos' ? 'block' : 'hidden'} md:block md:col-span-1`}
          >
            {photosSection}
          </section>
        </div>
      </div>

      <Sheet
        open={logSheetOpen}
        onClose={() => setLogSheetOpen(false)}
        title="Log Measurement"
        height="auto"
        footer={
          <div className="flex justify-end">
            <button
              onClick={handleSaveMeasurements}
              disabled={saving || !hasInput}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="p-4">
          <div className="ios-section">
            <div className="ios-row justify-between">
              <span className="text-sm text-muted-foreground">Date</span>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="bg-transparent text-sm text-right outline-none min-h-[44px] text-muted-foreground"
              />
            </div>
            <div className="ios-row flex-wrap gap-3">
              {SITES.map(s => (
                <input
                  key={s.key}
                  type="number"
                  inputMode="decimal"
                  placeholder={`${s.label} (cm)`}
                  value={inputs[s.key] ?? ''}
                  onChange={e => setInputs(prev => ({ ...prev, [s.key]: e.target.value }))}
                  className="flex-1 min-w-[110px] bg-transparent text-sm outline-none min-h-[44px]"
                />
              ))}
            </div>
            <div className="ios-row">
              <input
                type="number"
                inputMode="decimal"
                placeholder={`Weight (${label})`}
                value={weightInput}
                onChange={e => setWeightInput(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none min-h-[44px]"
              />
            </div>
          </div>
        </div>
      </Sheet>

      <PhotoSheet open={photoSheetOpen} onClose={() => setPhotoSheetOpen(false)} />
      <InbodyScanSheet open={inbodySheetOpen} onClose={() => setInbodySheetOpen(false)} />
      <AdjustOffsetDialog
        open={adjustState !== null}
        onClose={() => setAdjustState(null)}
        photo={adjustState?.photo ?? null}
        kind={adjustState?.kind ?? 'progress'}
        blob={adjustState?.blob ?? null}
        mask_url={adjustState?.mask_url ?? null}
        onSaved={handleAdjustSaved}
      />
    </main>
  );
}

// ─── Photo tile — one cell in a same-date group ─────────────────────────────

function PhotoTile({
  photo,
  onDelete,
  onCompare,
  onAdjust,
  onRetagPose,
  hasProjection,
  hasInspo,
}: {
  photo: LocalProgressPhoto;
  onDelete: (uuid: string) => void;
  onCompare: (kind: 'projection' | 'inspo') => void;
  onAdjust: () => void;
  onRetagPose: (pose: ProgressPhotoPose) => void;
  hasProjection: boolean;
  hasInspo: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [poseEditOpen, setPoseEditOpen] = useState(false);
  const stub = isLocalStub(photo.blob_url);
  // Compare only makes sense for poses that have a counterpart in the
  // projection/inspo sets. 'other' is excluded.
  const canCompare = isComparablePose(photo.pose);

  return (
    <div className="relative group">
      <div className="relative">
        <AlignedPhoto
          blobUrl={photo.blob_url}
          blob={photo.blob}
          cropOffsetY={photo.crop_offset_y}
          aspectRatio="3 / 4"
          alt={`${POSE_LABELS[photo.pose] ?? photo.pose} progress photo`}
          className="rounded-lg"
          sizes="(max-width: 768px) 33vw, 200px"
        />
        {/* Pose label */}
        <span className="absolute bottom-1 left-1 text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white">
          {POSE_LABELS[photo.pose] ?? photo.pose}
        </span>
        {photo.uploaded === '0' && (
          <span className="absolute top-1 left-1 text-[9px] font-medium px-1.5 py-0.5 rounded bg-black/70 text-amber-300 uppercase tracking-wide">
            Queued
          </span>
        )}
      </div>

      {/* Action triggers — small icons over the top-right corner. The
          button sits at z-20 on top of the queued badge / pose label. */}
      <div className="absolute top-1 right-1 flex gap-1 z-20">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="h-7 w-7 rounded-full bg-black/70 text-white flex items-center justify-center shadow-md ring-1 ring-white/10"
          aria-label="Photo actions"
        >
          ⋯
        </button>
      </div>

      {/* Dropdown menus — z-30 so they stack over neighbouring tiles. The
          parent group card has overflow-visible so this isn't clipped. */}
      {menuOpen && !poseEditOpen && (
        <div className="absolute top-9 right-1 z-30 w-44 rounded-lg bg-zinc-900 border border-white/10 shadow-xl overflow-hidden">
          {hasProjection && !stub && canCompare && (
            <button
              onClick={() => { onCompare('projection'); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 text-trans-blue"
            >
              <GitCompare className="h-3.5 w-3.5" />
              Compare to projection
            </button>
          )}
          {hasInspo && !stub && canCompare && (
            <button
              onClick={() => { onCompare('inspo'); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 text-trans-pink"
            >
              <GitCompare className="h-3.5 w-3.5" />
              Compare to inspo
            </button>
          )}
          <button
            onClick={() => { onAdjust(); setMenuOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 text-white/80"
          >
            <Move className="h-3.5 w-3.5" />
            Adjust alignment
          </button>
          <button
            onClick={() => setPoseEditOpen(true)}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 text-white/80"
          >
            <Tag className="h-3.5 w-3.5" />
            Change pose
          </button>
          <button
            onClick={() => { onDelete(photo.uuid); setMenuOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}

      {poseEditOpen && (
        <div className="absolute top-9 right-1 z-30 w-48 rounded-lg bg-zinc-900 border border-white/10 shadow-xl overflow-hidden">
          <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-white/50">Tag as…</p>
          {ALL_POSES.map((p) => {
            const isCurrent = p === photo.pose;
            return (
              <button
                key={p}
                onClick={() => {
                  if (!isCurrent) onRetagPose(p);
                  setPoseEditOpen(false);
                  setMenuOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 ${
                  isCurrent ? 'text-trans-blue' : 'text-white/80'
                }`}
              >
                <span className="w-3.5 h-3.5 inline-flex items-center justify-center">
                  {isCurrent && '✓'}
                </span>
                {POSE_LABELS[p]}
              </button>
            );
          })}
          <button
            onClick={() => { setPoseEditOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/5 text-white/40 border-t border-white/10"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default function MeasurementsPage() {
  return (
    <Suspense
      fallback={
        <main className="tab-content bg-background">
          <div className="max-w-lg md:max-w-5xl mx-auto">
            <div className="px-4 pt-safe pb-4 flex items-center gap-3">
              <h1 className="text-2xl font-bold">Measurements</h1>
            </div>
            <p className="px-4 text-sm text-muted-foreground">Loading…</p>
          </div>
        </main>
      }
    >
      <MeasurementsInner />
    </Suspense>
  );
}
