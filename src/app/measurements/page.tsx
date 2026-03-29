'use client';

import { useEffect, useState, useRef } from 'react';
import { ChevronLeft, Trash2, Camera, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useUnit } from '@/context/UnitContext';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { MeasurementLog, ProgressPhoto } from '@/types';

const SITES = [
  { key: 'waist',     label: 'Waist' },
  { key: 'hips',      label: 'Hips' },
  { key: 'upper_arm', label: 'Upper Arm' },
  { key: 'thigh',     label: 'Thigh' },
] as const;

type SiteKey = typeof SITES[number]['key'];

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key
    ? { 'Content-Type': 'application/json', 'X-Api-Key': key }
    : { 'Content-Type': 'application/json' };
}

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

export default function MeasurementsPage() {
  const { fromInput, label } = useUnit();
  const [activeTab, setActiveTab] = useState<'measurements' | 'photos'>('measurements');

  // Measurements state
  const [date, setDate] = useState(toDateInputValue);
  const [inputs, setInputs] = useState<Partial<Record<SiteKey, string>>>({});
  const [weightInput, setWeightInput] = useState('');
  const [logs, setLogs] = useState<MeasurementLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chartSite, setChartSite] = useState<SiteKey>('waist');

  // Photos state
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [selectedPose, setSelectedPose] = useState<'front' | 'side' | 'back'>('front');
  const [photoNote, setPhotoNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/measurements?limit=90', { headers: apiHeaders() })
      .then(r => r.json())
      .then((data: MeasurementLog[]) => { setLogs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/progress-photos?limit=50', { headers: apiHeaders() })
      .then(r => r.json())
      .then((data: ProgressPhoto[]) => { setPhotos(data); setPhotosLoading(false); })
      .catch(() => setPhotosLoading(false));
  }, []);

  const handleSaveMeasurements = async () => {
    const hasAny = SITES.some(s => inputs[s.key]) || !!weightInput;
    if (!hasAny) return;
    setSaving(true);
    try {
      const measured_at = date ? new Date(date).toISOString() : undefined;
      const promises: Promise<Response>[] = [];

      for (const site of SITES) {
        const val = inputs[site.key];
        if (val) {
          promises.push(fetch('/api/measurements', {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({ site: site.key, value_cm: parseFloat(val), measured_at }),
          }));
        }
      }

      if (weightInput) {
        promises.push(fetch('/api/bodyweight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weight_kg: fromInput(parseFloat(weightInput)) }),
        }));
      }

      const responses = await Promise.all(promises);
      const newLogs: MeasurementLog[] = [];
      for (const res of responses) {
        if (res.ok) {
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('application/json')) {
            const data = await res.json();
            if (data.site) newLogs.push(data as MeasurementLog);
          }
        }
      }

      if (newLogs.length > 0) {
        setLogs(prev => [...newLogs, ...prev]);
      }
      setInputs({});
      setWeightInput('');
      setDate(toDateInputValue());
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMeasurement = async (uuid: string) => {
    await fetch(`/api/measurements/${uuid}`, { method: 'DELETE', headers: apiHeaders() });
    setLogs(prev => prev.filter(l => l.uuid !== uuid));
  };

  const handlePhotoUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('pose', selectedPose);

      const uploadRes = await fetch('/api/progress-photos/upload', {
        method: 'POST',
        headers: apiHeadersNoContentType(),
        body: formData,
      });
      if (!uploadRes.ok) return;
      const { url } = await uploadRes.json();

      const res = await fetch('/api/progress-photos', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ blob_url: url, pose: selectedPose, notes: photoNote || null }),
      });
      if (res.ok) {
        const photo: ProgressPhoto = await res.json();
        setPhotos(prev => [photo, ...prev]);
        setPhotoNote('');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async (uuid: string) => {
    await fetch(`/api/progress-photos/${uuid}`, { method: 'DELETE', headers: apiHeaders() });
    setPhotos(prev => prev.filter(p => p.uuid !== uuid));
  };

  // Chart data: last 30 entries for the selected site, oldest first
  const chartData = logs
    .filter(l => l.site === chartSite)
    .slice(0, 30)
    .reverse()
    .map(l => ({
      date: formatChartDate(l.measured_at),
      value: parseFloat(String(l.value_cm)),
    }));

  // Most recent value per site (for snapshot row)
  const latestBySite: Partial<Record<SiteKey, MeasurementLog>> = {};
  for (const log of logs) {
    const s = log.site as SiteKey;
    if (SITES.find(si => si.key === s) && !latestBySite[s]) {
      latestBySite[s] = log;
    }
  }

  const hasInput = SITES.some(s => inputs[s.key]) || !!weightInput;

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-4 flex items-center gap-3">
        <Link href="/settings" className="text-primary p-1 -ml-1">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Measurements</h1>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-border mx-4 mb-4">
        {(['measurements', 'photos'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground'
            }`}
          >
            {tab === 'measurements' ? 'Measurements' : 'Photos'}
          </button>
        ))}
      </div>

      <div className="px-4 pb-8 space-y-4">

        {activeTab === 'measurements' && (
          <>
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
                  <div className="ios-row flex-wrap gap-2 py-1">
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
                  {chartData.length > 1 ? (
                    <div className="px-1 py-2">
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
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
                  ) : (
                    <p className="text-xs text-muted-foreground px-2 pb-3">Log at least 2 entries for {SITES.find(s => s.key === chartSite)?.label.toLowerCase()} to see a trend.</p>
                  )}
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
          </>
        )}

        {activeTab === 'photos' && (
          <>
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
                <ImageIcon className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-sm">No progress photos yet.</p>
                <p className="text-xs mt-1">Upload your first photo above.</p>
              </div>
            )}
          </>
        )}

      </div>
    </main>
  );
}
