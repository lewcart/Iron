'use client';

import { Suspense, useState, useRef } from 'react';
import { ChevronLeft, Trash2, Camera, ImageIcon, Activity, Target, Plus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useUnit } from '@/context/UnitContext';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from 'recharts';
import type { InbodyScan, MeasurementLog, ProgressPhoto } from '@/types';
import { apiBase } from '@/lib/api/client';
import { useMeasurements, useProgressPhotos, useInbodyScans, useBodyGoal } from '@/lib/useLocalDB-measurements';
import { logMeasurement, deleteMeasurement, recordProgressPhoto, deleteProgressPhoto } from '@/lib/mutations-measurements';
import { logBodyweight } from '@/lib/mutations';

const SITES = [
  { key: 'waist',     label: 'Waist' },
  { key: 'hips',      label: 'Hips' },
  { key: 'upper_arm', label: 'Upper Arm' },
  { key: 'thigh',     label: 'Thigh' },
] as const;

type SiteKey = typeof SITES[number]['key'];
type TabKey = 'measurements' | 'photos' | 'inbody';

// Distinct Tailwind-equivalent colors for multi-site overlay (no --chart-N tokens in globals.css)
const SITE_COLORS: Record<SiteKey, string> = {
  waist:     '#3b82f6', // blue-500
  hips:      '#10b981', // emerald-500
  thigh:     '#f97316', // orange-500
  upper_arm: '#a855f7', // purple-500
};

// InBody metric key used for trend chart reference lines.
// PBF% is the headline metric most users track; reference-line enrichment targets it.
const INBODY_TREND_METRIC: keyof InbodyScan = 'pbf_pct';

function apiHeadersNoContentType(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key ? { 'X-Api-Key': key } : {};
}

function formatDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatChartDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short',
  });
}

function toDateInputValue(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

const POSE_GUIDANCE: Record<string, string> = {
  front: 'Face the camera, arms slightly away from your body, feet hip-width apart.',
  side:  'Stand sideways, arms relaxed, feet together, looking straight ahead.',
  back:  'Back to the camera, arms slightly away from your body, feet hip-width apart.',
};

function MeasurementsInner() {
  const { fromInput, label } = useUnit();
  const searchParams = useSearchParams();
  const initialTab = (searchParams?.get('tab') as TabKey | null) ?? 'measurements';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  // All reads come from Dexie via useLiveQuery — no spinner needed beyond
  // the brief first-tick before useLiveQuery resolves. The local types are
  // structurally compatible with the @/types server types (extra _synced /
  // _updated_at / _deleted fields on local rows are harmless extras).
  const logs = useMeasurements({ limit: 90 }) as unknown as MeasurementLog[];
  const photos = useProgressPhotos(50) as unknown as ProgressPhoto[];
  const inbodyScans = useInbodyScans(50) as unknown as InbodyScan[];
  const inbodyGoal = useBodyGoal(INBODY_TREND_METRIC);
  const loading = false;
  const photosLoading = false;
  const inbodyLoading = false;

  // Measurements state
  const [date, setDate] = useState(toDateInputValue);
  const [inputs, setInputs] = useState<Partial<Record<SiteKey, string>>>({});
  const [weightInput, setWeightInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [chartSite, setChartSite] = useState<SiteKey>('waist');

  // Photos state
  const [selectedPose, setSelectedPose] = useState<'front' | 'side' | 'back'>('front');
  const [photoNote, setPhotoNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMeasurement = async (uuid: string) => {
    await deleteMeasurement(uuid);
  };

  const handlePhotoUpload = async (file: File) => {
    setUploading(true);
    try {
      // Photo binary still uploads through /api/progress-photos/upload to
      // Vercel Blob — Dexie holds metadata only (per the local-first plan,
      // PR #14). Once uploaded, recordProgressPhoto writes the URL +
      // metadata to local Dexie and pushes through sync.
      const formData = new FormData();
      formData.append('file', file);
      formData.append('pose', selectedPose);

      const uploadRes = await fetch(`${apiBase()}/api/progress-photos/upload`, {
        method: 'POST',
        headers: apiHeadersNoContentType(),
        body: formData,
      });
      if (!uploadRes.ok) return;
      const { url } = await uploadRes.json();

      await recordProgressPhoto({
        blob_url: url,
        pose: selectedPose,
        notes: photoNote || null,
      });
      setPhotoNote('');
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async (uuid: string) => {
    await deleteProgressPhoto(uuid);
  };

  // Single-site chart data (mobile + iPad portrait)
  const chartData = logs
    .filter(l => l.site === chartSite)
    .slice(0, 30)
    .reverse()
    .map(l => ({
      date: formatChartDate(l.measured_at),
      value: parseFloat(String(l.value_cm)),
    }));

  // Multi-site chart data (lg:+) — one row per measured_at, with all 4 sites as keys
  const multiSiteChartData = (() => {
    const byDate = new Map<string, { date: string } & Partial<Record<SiteKey, number>>>();
    // walk logs oldest-to-newest so Map retains chronological insertion order
    for (const log of [...logs].reverse()) {
      const s = log.site as SiteKey;
      if (!SITES.find(si => si.key === s)) continue;
      const dateKey = formatChartDate(log.measured_at);
      const existing = byDate.get(dateKey) ?? { date: dateKey };
      existing[s] = parseFloat(String(log.value_cm));
      byDate.set(dateKey, existing);
    }
    return Array.from(byDate.values()).slice(-30);
  })();

  // Most recent value per site (for snapshot row)
  const latestBySite: Partial<Record<SiteKey, MeasurementLog>> = {};
  for (const log of logs) {
    const s = log.site as SiteKey;
    if (SITES.find(si => si.key === s) && !latestBySite[s]) {
      latestBySite[s] = log;
    }
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

      {/* Log new entry */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Log Entry</p>
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
          <div className="ios-row justify-end">
            <button
              onClick={handleSaveMeasurements}
              disabled={saving || !hasInput}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

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

      {/* History */}
      {!loading && logs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">History</p>
          <div className="ios-section">
            {logs.slice(0, 30).map((log, i) => (
              <div
                key={log.uuid}
                className={`ios-row justify-between ${i < Math.min(logs.length, 30) - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">
                    {SITES.find(s => s.key === log.site)?.label ?? log.site}
                  </span>
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
            ))}
          </div>
        </div>
      )}

      {!loading && logs.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">No measurements logged yet.</p>
      )}
    </div>
  );

  const photosSection = (
    <div className="space-y-4">
      {/* Upload */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Add Photo</p>
        <div className="ios-section">
          {/* Pose selector */}
          <div className="ios-row gap-2">
            {(['front', 'side', 'back'] as const).map(pose => (
              <button
                key={pose}
                onClick={() => setSelectedPose(pose)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg border capitalize transition-colors ${
                  selectedPose === pose
                    ? 'bg-primary text-white border-primary'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {pose}
              </button>
            ))}
          </div>

          {/* Pose guidance */}
          <div className="ios-row py-1">
            <p className="text-xs text-muted-foreground">{POSE_GUIDANCE[selectedPose]}</p>
          </div>

          {/* Note */}
          <div className="ios-row">
            <input
              type="text"
              placeholder="Note (optional)"
              value={photoNote}
              onChange={e => setPhotoNote(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none min-h-[44px] text-muted-foreground"
            />
          </div>

          <div className="ios-row justify-end">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handlePhotoUpload(file);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              <Camera className="h-4 w-4" />
              {uploading ? 'Uploading…' : 'Choose Photo'}
            </button>
          </div>
        </div>
      </div>

      {/* Gallery */}
      {!photosLoading && photos.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">Gallery</p>
          <div className="space-y-3">
            {photos.map(photo => (
              <div key={photo.uuid} className="ios-section overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.blob_url}
                  alt={`${photo.pose} progress photo`}
                  className="w-full object-cover max-h-[420px] rounded-t-xl"
                />
                <div className="ios-row justify-between">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium capitalize">{photo.pose}</span>
                    {photo.notes && (
                      <span className="text-xs text-muted-foreground">{photo.notes}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatDate(photo.taken_at)}</span>
                    <button
                      onClick={() => handleDeletePhoto(photo.uuid)}
                      className="text-red-500 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
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
          <p className="text-xs mt-1">Upload your first photo above.</p>
        </div>
      )}
    </div>
  );

  const inbodySection = (
    <div className="space-y-4">
      {/* Action row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href="/measurements/inbody/new"
          className="flex items-center gap-2 px-3 py-2 bg-primary text-white text-sm font-medium rounded-lg"
        >
          <Plus className="h-4 w-4" />
          New Scan
        </Link>
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
    </main>
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
