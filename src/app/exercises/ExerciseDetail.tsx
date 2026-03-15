'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, Trophy, Medal, Award } from 'lucide-react';
import type { Exercise } from '@/types';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────────────────

interface PRRecord {
  exerciseUuid: string;
  weight: number;
  repetitions: number;
  estimated1RM: number;
  date: string;
}

interface ProgressPoint {
  date: string;
  maxWeight: number;
  totalVolume: number;
  estimated1RM: number;
}

interface VolumeTrendPoint {
  date: string;
  totalVolume: number;
}

interface RecentSet {
  date: string;
  weight: number;
  repetitions: number;
  rpe: number | null;
  workoutUuid: string;
}

interface ProgressData {
  progress: ProgressPoint[];
  prs: {
    estimated1RM: PRRecord | null;
    heaviestWeight: PRRecord | null;
    mostReps: PRRecord | null;
  };
  volumeTrend: VolumeTrendPoint[];
  recentSets: RecentSet[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PRBadge({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-3 min-w-0">
      <div className="text-zinc-400">{icon}</div>
      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide text-center">{label}</p>
      <p className="text-base font-bold text-zinc-100 text-center leading-tight">{value}</p>
      <p className="text-[10px] text-zinc-500 text-center">{sub}</p>
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div className={`bg-zinc-800 rounded-lg animate-pulse ${className ?? ''}`} />
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 px-4 py-4">
      {/* PR badges skeleton */}
      <div className="flex gap-2">
        <SkeletonBlock className="flex-1 h-24" />
        <SkeletonBlock className="flex-1 h-24" />
        <SkeletonBlock className="flex-1 h-24" />
      </div>
      {/* Chart skeleton */}
      <SkeletonBlock className="h-48" />
      <SkeletonBlock className="h-48" />
      {/* Table skeleton */}
      <SkeletonBlock className="h-32" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Trophy className="h-10 w-10 text-zinc-700 mb-3" />
      <p className="text-zinc-400 font-medium">No workout data yet</p>
      <p className="text-zinc-600 text-sm mt-1">Log this exercise to see your progress</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ExerciseDetail({
  exercise,
  onBack,
}: {
  exercise: Exercise;
  onBack: () => void;
}) {
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setProgressData(null);
    fetch(`/api/exercises/${exercise.uuid}/progress`)
      .then(r => r.json())
      .then((data: ProgressData) => {
        setProgressData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [exercise.uuid]);

  const hasData = progressData && progressData.recentSets.length > 0;

  const chartData = progressData?.progress.map(p => ({
    date: formatDate(p.date),
    estimated1RM: Math.round(p.estimated1RM * 10) / 10,
    maxWeight: Math.round(p.maxWeight * 10) / 10,
  })) ?? [];

  const volumeData = progressData?.volumeTrend.map(v => ({
    date: formatDate(v.date),
    totalVolume: Math.round(v.totalVolume),
  })) ?? [];

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: '#18181b',
      border: '1px solid #3f3f46',
      borderRadius: '8px',
      fontSize: 12,
    },
    labelStyle: { color: '#a1a1aa' },
    itemStyle: { color: '#e4e4e7' },
  };

  return (
    <main className="tab-content bg-background">
      {/* Nav bar */}
      <div className="flex items-center gap-2 px-4 pt-14 pb-3 border-b border-border">
        <button onClick={onBack} className="flex items-center gap-1 text-primary font-medium text-base">
          <ChevronLeft className="h-5 w-5" />
          Back
        </button>
      </div>

      <div className="px-4 py-4 space-y-5">
        <h1 className="text-xl font-bold">{exercise.title}</h1>

        {/* ── Progress section ── */}
        {loading ? (
          <LoadingSkeleton />
        ) : !hasData ? (
          <EmptyState />
        ) : (
          <>
            {/* PR Badges */}
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 px-1">Personal Records</p>
              <div className="flex gap-2">
                <PRBadge
                  icon={<Trophy className="h-4 w-4" />}
                  label="Est. 1RM"
                  value={
                    progressData.prs.estimated1RM
                      ? `${Math.round(progressData.prs.estimated1RM.estimated1RM)} kg`
                      : '—'
                  }
                  sub={
                    progressData.prs.estimated1RM
                      ? formatDate(progressData.prs.estimated1RM.date)
                      : 'No data'
                  }
                />
                <PRBadge
                  icon={<Medal className="h-4 w-4" />}
                  label="Heaviest"
                  value={
                    progressData.prs.heaviestWeight
                      ? `${progressData.prs.heaviestWeight.weight} kg`
                      : '—'
                  }
                  sub={
                    progressData.prs.heaviestWeight
                      ? formatDate(progressData.prs.heaviestWeight.date)
                      : 'No data'
                  }
                />
                <PRBadge
                  icon={<Award className="h-4 w-4" />}
                  label="Most Reps"
                  value={
                    progressData.prs.mostReps
                      ? `${progressData.prs.mostReps.repetitions}`
                      : '—'
                  }
                  sub={
                    progressData.prs.mostReps
                      ? `@ ${progressData.prs.mostReps.weight} kg`
                      : 'No data'
                  }
                />
              </div>
            </div>

            {/* Weight Progress Chart */}
            {chartData.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 px-1">Weight Progress</p>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                      <XAxis dataKey="date" stroke="#71717a" fontSize={11} tick={{ fill: '#71717a' }} />
                      <YAxis stroke="#71717a" fontSize={11} tick={{ fill: '#71717a' }} unit=" kg" />
                      <Tooltip {...tooltipStyle} />
                      <Line
                        type="monotone"
                        dataKey="estimated1RM"
                        name="Est. 1RM"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="maxWeight"
                        name="Max Weight"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        strokeDasharray="4 2"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 mt-2 justify-center">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-0.5 bg-blue-500 rounded" />
                      <span className="text-[10px] text-zinc-500">Est. 1RM</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-0.5 bg-emerald-500 rounded" />
                      <span className="text-[10px] text-zinc-500">Max Weight</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Volume Trend Chart */}
            {volumeData.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 px-1">Volume Trend</p>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={volumeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
                      <XAxis dataKey="date" stroke="#71717a" fontSize={11} tick={{ fill: '#71717a' }} />
                      <YAxis stroke="#71717a" fontSize={11} tick={{ fill: '#71717a' }} />
                      <Tooltip {...tooltipStyle} />
                      <Bar dataKey="totalVolume" name="Volume (kg)" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Recent Sets Table */}
            {progressData.recentSets.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 px-1">Recent Sets</p>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-4 px-3 py-2 border-b border-zinc-800">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Date</span>
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide text-right">Weight</span>
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide text-right">Reps</span>
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide text-right">RPE</span>
                  </div>
                  {/* Rows */}
                  {progressData.recentSets.map((set, i) => (
                    <div
                      key={`${set.workoutUuid}-${i}`}
                      className={`grid grid-cols-4 px-3 py-2 ${i % 2 === 0 ? 'bg-zinc-900' : 'bg-zinc-950'}`}
                    >
                      <span className="text-xs text-zinc-400">{formatDate(set.date)}</span>
                      <span className="text-xs text-zinc-200 text-right">{set.weight} kg</span>
                      <span className="text-xs text-zinc-200 text-right">{set.repetitions}</span>
                      <span className="text-xs text-zinc-400 text-right">{set.rpe != null ? set.rpe : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Description */}
        {exercise.description && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">About</p>
            <div className="ios-section p-4">
              <p className="text-sm text-foreground leading-relaxed">{exercise.description}</p>
            </div>
          </div>
        )}

        {/* Muscles */}
        {(exercise.primary_muscles.length > 0 || exercise.secondary_muscles.length > 0) && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Muscles</p>
            <div className="ios-section">
              {exercise.primary_muscles.map(m => (
                <div key={m} className="ios-row">
                  <span className="flex-1 text-sm capitalize">{m}</span>
                  <span className="text-xs text-muted-foreground">Primary</span>
                </div>
              ))}
              {exercise.secondary_muscles.map(m => (
                <div key={m} className="ios-row">
                  <span className="flex-1 text-sm capitalize">{m}</span>
                  <span className="text-xs text-muted-foreground">Secondary</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Equipment */}
        {exercise.equipment.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Equipment</p>
            <div className="ios-section">
              {exercise.equipment.map(eq => (
                <div key={eq} className="ios-row">
                  <span className="text-sm capitalize">{eq}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Steps */}
        {exercise.steps.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Steps</p>
            <div className="ios-section">
              {exercise.steps.map((step, i) => (
                <div key={i} className="ios-row gap-3">
                  <span className="text-xs font-bold text-primary w-5 text-center flex-shrink-0">{i + 1}</span>
                  <p className="text-sm flex-1 leading-snug">{step}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tips */}
        {exercise.tips.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Tips</p>
            <div className="ios-section">
              {exercise.tips.map((tip, i) => (
                <div key={i} className="ios-row">
                  <p className="text-sm flex-1 leading-snug">{tip}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Also known as */}
        {exercise.alias.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Also Known As</p>
            <div className="ios-section">
              {exercise.alias.map((a, i) => (
                <div key={i} className="ios-row">
                  <span className="text-sm">{a}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
