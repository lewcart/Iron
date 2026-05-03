'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
  Target,
  Sparkles,
  Calendar,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ArrowRight,
  ChevronLeft,
  Trophy,
  Camera,
} from 'lucide-react';
import {
  useActiveVision,
  useActivePlan,
  useCheckpointsForPlan,
} from '@/lib/useLocalDB-strategy';
import { useBodyGoals, useInbodyScans, useProgressPhotos } from '@/lib/useLocalDB-measurements';
import type {
  LocalBodyVision,
  LocalBodyPlan,
  LocalPlanCheckpoint,
  LocalBodyGoal,
  LocalInbodyScan,
  NorthStarMetric,
  ProgrammingDose,
} from '@/db/local';
import type { InspoPhoto, ProjectionPhoto, ProgressPhotoPose } from '@/types';
import { METRIC_LABEL } from '@/lib/inbody';
import { isComparablePose, POSE_LABELS } from '@/lib/poses';
import { offsetTransform } from '@/lib/photo-offset';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';
import { isLocalStub } from '@/lib/photo-upload-queue';
import { CompareDialog, type CompareTarget } from '@/app/measurements/CompareDialog';
import { AdjustOffsetDialog, type AdjustablePhotoKind } from '@/app/measurements/AdjustOffsetDialog';
import {
  EditVisionButton,
  EditPlanButton,
  NewCheckpointButton,
} from './StrategyEditors';

export default function StrategyPage() {
  const vision = useActiveVision();
  const plan = useActivePlan();
  const checkpoints = useCheckpointsForPlan(plan?.uuid);
  const goals = useBodyGoals();
  const scans = useInbodyScans(1);
  const latestScan = scans[0] ?? null;
  const inspoPhotos = useInspoPhotosFeed(8);
  const projections = useProjectionsFeed(4);
  const progressPhotos = useProgressPhotos(50);

  // Compare state — opens when Lou taps a Projection or Inspiration thumb.
  // Source = latest matching-pose progress photo. defaultTargetUuid pre-
  // selects the specific thumb in the carousel so the dialog shows what
  // Lou tapped, not just "newest at this pose".
  const [compareSource, setCompareSource] = useState<{
    uuid: string;
    blob_url: string;
    pose: ProgressPhotoPose;
    taken_at: string;
    crop_offset_y: number | null;
  } | null>(null);
  const [compareTarget, setCompareTarget] = useState<CompareTarget>('projection');
  const [compareTargetUuid, setCompareTargetUuid] = useState<string | null>(null);

  // Adjust offset dialog (so the in-dialog "Adjust source/target" buttons work).
  const [adjustState, setAdjustState] = useState<{
    photo: { uuid: string; blob_url: string; crop_offset_y: number | null };
    kind: AdjustablePhotoKind;
  } | null>(null);

  const latestProgressByPose = useMemo(() => {
    const byPose: Partial<Record<ProgressPhotoPose, ProgressPhotoLike>> = {};
    for (const p of progressPhotos ?? []) {
      if (isLocalStub(p.blob_url)) continue;
      if (!isComparablePose(p.pose)) continue;
      const cur = byPose[p.pose];
      if (!cur || p.taken_at > cur.taken_at) {
        byPose[p.pose] = {
          uuid: p.uuid,
          blob_url: p.blob_url,
          pose: p.pose,
          taken_at: p.taken_at,
          crop_offset_y: p.crop_offset_y ?? null,
        };
      }
    }
    return byPose;
  }, [progressPhotos]);

  const openCompare = useCallback(
    (target: CompareTarget, pose: ProgressPhotoPose | null, targetUuid: string) => {
      const matchingPose: ProgressPhotoPose = isComparablePose(pose) ? pose : 'front';
      const src = latestProgressByPose[matchingPose];
      if (!src) {
        // No progress photo at this pose. Fall through to whichever pose has one.
        const fallback =
          latestProgressByPose.front ??
          latestProgressByPose.side ??
          latestProgressByPose.back ??
          latestProgressByPose.face_front ??
          latestProgressByPose.face_side;
        if (!fallback) return; // no progress photos at all — nothing to compare
        setCompareSource(fallback);
      } else {
        setCompareSource(src);
      }
      setCompareTarget(target);
      setCompareTargetUuid(targetUuid);
    },
    [latestProgressByPose],
  );

  // useLiveQuery returns undefined while loading, null/[] when nothing matches.
  const loading = vision === undefined || plan === undefined;

  return (
    <main className="tab-content px-4 pt-safe pb-8 max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Link href="/feed" className="text-primary p-1 -ml-1">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight gradient-brand-text">
            Strategy
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Vision and Plan — what you&apos;re building, and how.
        </p>
      </header>

      {loading && <SkeletonCards />}

      {!loading && !vision && !plan && <EmptyState />}

      {vision && <VisionCard vision={vision} />}
      {plan && <PlanCard plan={plan} checkpoints={checkpoints} />}
      {goals.length > 0 && <GoalsCard goals={goals} latestScan={latestScan} />}
      <ProjectionsCard
        photos={projections}
        onCompare={(p) => openCompare('projection', p.pose, p.uuid)}
      />
      <InspoCard
        photos={inspoPhotos}
        onCompare={(p) =>
          openCompare(
            'inspo',
            isComparablePose(p.pose) ? p.pose : null,
            p.uuid,
          )
        }
      />

      <CompareDialog
        open={compareSource !== null}
        onClose={() => { setCompareSource(null); setCompareTargetUuid(null); }}
        source={compareSource}
        defaultTarget={compareTarget}
        defaultTargetUuid={compareTargetUuid}
        onAdjust={(photo, kind) => setAdjustState({ photo, kind })}
      />
      <AdjustOffsetDialog
        open={adjustState !== null}
        onClose={() => setAdjustState(null)}
        photo={adjustState?.photo ?? null}
        kind={adjustState?.kind ?? 'progress'}
        onSaved={() => { /* no-op; Dexie sync engine carries through */ }}
      />
    </main>
  );
}

interface ProgressPhotoLike {
  uuid: string;
  blob_url: string;
  pose: ProgressPhotoPose;
  taken_at: string;
  crop_offset_y: number | null;
}

// ─── Projections (REST — projection_photos is REST-only, like inspo) ────────

function useProjectionsFeed(limit: number): ProjectionPhoto[] | undefined {
  const [photos, setPhotos] = useState<ProjectionPhoto[] | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetchJsonAuthed<ProjectionPhoto[]>(`${apiBase()}/api/projection-photos?limit=${limit}`)
      .then((rows) => {
        if (!cancelled) setPhotos(rows);
      })
      .catch(() => {
        if (!cancelled) setPhotos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);
  return photos;
}

// ─── Inspo photos (REST — inspo_photos is local-only / not in CDC sync) ──────
//
// Inspo photos are intentionally outside the change_log sync layer (see
// `SYNCED_TABLES` in src/lib/sync.ts). The capture path writes to Dexie + POSTs
// to the server, but the gallery reads via REST. Strategy page mirrors that
// pattern: pull a small recent set on mount.

function useInspoPhotosFeed(limit: number): InspoPhoto[] | undefined {
  const [photos, setPhotos] = useState<InspoPhoto[] | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetchJsonAuthed<InspoPhoto[]>(`${apiBase()}/api/inspo-photos?limit=${limit}`)
      .then((rows) => {
        if (!cancelled) setPhotos(rows);
      })
      .catch(() => {
        if (!cancelled) setPhotos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);
  return photos;
}

// ─── Vision ──────────────────────────────────────────────────────────────────

function VisionCard({ vision }: { vision: LocalBodyVision }) {
  return (
    <section className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3 flex items-start gap-3">
        <div className="rounded-xl bg-trans-pink/10 p-2 shrink-0">
          <Sparkles className="h-5 w-5 text-trans-pink" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{vision.title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Active vision</p>
        </div>
        <EditVisionButton vision={vision} />
      </header>

      {(vision.build_emphasis.length > 0 ||
        vision.maintain_emphasis.length > 0 ||
        vision.deemphasize.length > 0) && (
        <div className="px-5 pb-4 space-y-2">
          {vision.build_emphasis.length > 0 && (
            <TagRow label="Build" tone="build" tags={vision.build_emphasis} />
          )}
          {vision.maintain_emphasis.length > 0 && (
            <TagRow label="Maintain" tone="maintain" tags={vision.maintain_emphasis} />
          )}
          {vision.deemphasize.length > 0 && (
            <TagRow label="De-emphasize" tone="deemphasize" tags={vision.deemphasize} />
          )}
        </div>
      )}

      {vision.principles.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Principles
          </p>
          <ul className="space-y-1.5">
            {vision.principles.map((p, i) => (
              <li key={i} className="text-sm leading-snug flex gap-2">
                <span className="text-trans-blue mt-0.5">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ProseBlock markdown={vision.body_md} placeholder="No prose yet — Vision body will render here once written." />
    </section>
  );
}

// ─── Plan ────────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  checkpoints,
}: {
  plan: LocalBodyPlan;
  checkpoints: LocalPlanCheckpoint[];
}) {
  return (
    <section className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3 flex items-start gap-3">
        <div className="rounded-xl bg-trans-blue/10 p-2 shrink-0">
          <Target className="h-5 w-5 text-trans-blue" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{plan.title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>{plan.horizon_months}-month horizon</span>
            <span className="text-border">·</span>
            <Calendar className="h-3 w-3" />
            <span>
              {formatDate(plan.start_date)} → {formatDate(plan.target_date)}
            </span>
          </p>
        </div>
        <EditPlanButton plan={plan} />
      </header>

      {plan.summary && (
        <p className="px-5 pb-4 text-sm italic text-muted-foreground leading-relaxed">
          {plan.summary}
        </p>
      )}

      {plan.north_star_metrics.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" /> North-star metrics
          </p>
          <div className="space-y-2">
            {plan.north_star_metrics.map((m) => (
              <NorthStarRow key={m.metric_key} metric={m} />
            ))}
          </div>
        </div>
      )}

      {plan.programming_dose && Object.keys(plan.programming_dose).length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Programming dose
          </p>
          <ProgrammingDoseBlock dose={plan.programming_dose} />
        </div>
      )}

      {plan.reevaluation_triggers.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> Re-evaluate when
          </p>
          <div className="flex flex-wrap gap-1.5">
            {plan.reevaluation_triggers.map((t, i) => (
              <span
                key={i}
                className="text-xs px-2 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 pb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Checkpoints
          </p>
          <NewCheckpointButton planId={plan.uuid} />
        </div>
        {checkpoints.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No checkpoints yet — use the button above to log a quarterly review.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {checkpoints.map((c) => (
              <CheckpointRow key={c.uuid} checkpoint={c} />
            ))}
          </ol>
        )}
      </div>

      <ProseBlock markdown={plan.body_md} placeholder="No prose yet — Plan strategy body will render here once written." />
    </section>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TagRow({
  label,
  tone,
  tags,
}: {
  label: string;
  tone: 'build' | 'maintain' | 'deemphasize';
  tags: string[];
}) {
  const toneClasses = {
    build: 'bg-trans-blue/10 text-trans-blue border-trans-blue/20',
    maintain: 'bg-muted text-muted-foreground border-border',
    deemphasize: 'bg-muted/40 text-muted-foreground/70 border-border line-through',
  }[tone];
  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <span
            key={i}
            className={`text-xs px-2 py-0.5 rounded-md border ${toneClasses}`}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function NorthStarRow({ metric }: { metric: NorthStarMetric }) {
  const hasTarget = metric.target_value != null;
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">
          {metric.metric_key}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          {metric.baseline_value != null ? metric.baseline_value : '—'}
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          {hasTarget ? (
            <span className="text-trans-blue">{metric.target_value}</span>
          ) : (
            <span className="text-muted-foreground italic">target pending</span>
          )}
        </span>
      </div>
      {metric.reasoning && (
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          {metric.reasoning}
        </p>
      )}
    </div>
  );
}

function ProgrammingDoseBlock({ dose }: { dose: ProgrammingDose }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2.5 space-y-2 text-sm">
      {dose.strength_sessions_per_week && (
        <div>
          <span className="font-medium">Strength: </span>
          <span className="tabular-nums">
            {dose.strength_sessions_per_week.min}
            {dose.strength_sessions_per_week.max !== dose.strength_sessions_per_week.min &&
              `–${dose.strength_sessions_per_week.max}`}
            ×/week
          </span>
          {dose.strength_sessions_per_week.rationale && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {dose.strength_sessions_per_week.rationale}
            </p>
          )}
        </div>
      )}
      {dose.cardio_floor_minutes_weekly && (
        <div>
          <span className="font-medium">Cardio floor: </span>
          <span className="tabular-nums">
            {dose.cardio_floor_minutes_weekly.target} min/week
          </span>
          {dose.cardio_floor_minutes_weekly.rationale && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {dose.cardio_floor_minutes_weekly.rationale}
            </p>
          )}
        </div>
      )}
      {dose.movement_principles && dose.movement_principles.length > 0 && (
        <div>
          <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Movement principles
          </p>
          <ul className="space-y-0.5">
            {dose.movement_principles.map((p, i) => (
              <li key={i} className="text-xs flex gap-1.5">
                <span className="text-trans-blue">›</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dose.add_more_when && dose.add_more_when.length > 0 && (
        <div>
          <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Add more when
          </p>
          <ul className="space-y-0.5">
            {dose.add_more_when.map((p, i) => (
              <li key={i} className="text-xs flex gap-1.5">
                <span className="text-trans-blue">+</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CheckpointRow({ checkpoint }: { checkpoint: LocalPlanCheckpoint }) {
  const done = checkpoint.status === 'completed';
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon
        className={`h-4 w-4 shrink-0 ${
          done ? 'text-trans-blue' : 'text-muted-foreground/60'
        }`}
        strokeWidth={done ? 2.5 : 1.75}
      />
      <span className={`font-medium ${done ? '' : 'text-muted-foreground'}`}>
        {checkpoint.quarter_label}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatDate(checkpoint.target_date)}
      </span>
      {checkpoint.assessment && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-auto">
          {checkpoint.assessment.replace('_', ' ')}
        </span>
      )}
    </li>
  );
}

// ─── Goals ───────────────────────────────────────────────────────────────────

function GoalsCard({
  goals,
  latestScan,
}: {
  goals: LocalBodyGoal[];
  latestScan: LocalInbodyScan | null;
}) {
  // Sort goals by metric label for a stable, readable ordering. metric_key is
  // a snake_case identifier — METRIC_LABEL gives the human-readable name.
  const sorted = [...goals].sort((a, b) =>
    (METRIC_LABEL[a.metric_key] ?? a.metric_key).localeCompare(
      METRIC_LABEL[b.metric_key] ?? b.metric_key,
    ),
  );

  // Pull latest scan value per metric_key so each goal can show "current → target".
  const scanRecord = latestScan as unknown as Record<string, number | null | undefined>;
  return (
    <section className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3 flex items-start gap-3">
        <div className="rounded-xl bg-amber-500/10 p-2 shrink-0">
          <Trophy className="h-5 w-5 text-amber-500" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold leading-tight">Goals</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {goals.length} target{goals.length === 1 ? '' : 's'} · edit on{' '}
            <Link href="/measurements/goals" className="text-trans-blue underline underline-offset-2">
              Body Goals
            </Link>
          </p>
        </div>
      </header>
      <div className="px-5 pb-4 space-y-1.5">
        {sorted.map((g) => {
          const current = scanRecord ? scanRecord[g.metric_key] : null;
          const label = METRIC_LABEL[g.metric_key] ?? g.metric_key;
          return <GoalRow key={g.metric_key} goal={g} label={label} current={current ?? null} />;
        })}
      </div>
    </section>
  );
}

function GoalRow({
  goal,
  label,
  current,
}: {
  goal: LocalBodyGoal;
  label: string;
  current: number | null | undefined;
}) {
  const arrow = goal.direction === 'higher' ? '≥' : goal.direction === 'lower' ? '≤' : '=';
  const currentText = typeof current === 'number' ? current.toFixed(1) : null;
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2 flex items-center gap-2 text-sm">
      <span className="font-medium flex-1 min-w-0 truncate">{label}</span>
      {currentText && (
        <span className="text-xs text-muted-foreground tabular-nums">{currentText}</span>
      )}
      {currentText && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
      <span className="text-trans-blue tabular-nums text-sm font-medium">
        {arrow} {goal.target_value}
        {goal.unit ? ` ${goal.unit}` : ''}
      </span>
    </div>
  );
}

// ─── Projections (Lou, AI-generated) ────────────────────────────────────────

function ProjectionsCard({
  photos,
  onCompare,
}: {
  photos: ProjectionPhoto[] | undefined;
  onCompare: (photo: ProjectionPhoto) => void;
}) {
  if (photos === undefined) {
    return (
      <section className="rounded-2xl bg-card border border-border shadow-sm h-40 animate-pulse" />
    );
  }
  return (
    <section className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3 flex items-start gap-3">
        <div className="rounded-xl bg-trans-blue/10 p-2 shrink-0">
          <Sparkles className="h-5 w-5 text-trans-blue" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold leading-tight">Projections</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Where you&apos;re heading ·{' '}
            <Link href="/projections" className="text-trans-blue underline underline-offset-2">
              Open gallery
            </Link>
          </p>
        </div>
      </header>
      <div className="px-5 pb-5">
        {photos.length === 0 ? (
          <Link
            href="/projections"
            className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border border-dashed border-trans-blue/40 text-trans-blue"
          >
            <Sparkles className="h-5 w-5" />
            <span className="text-sm font-medium">Upload your first projection</span>
            <span className="text-[11px] text-muted-foreground text-center max-w-xs">
              Generate one elsewhere (ChatGPT/Midjourney) and link it to a progress photo
            </span>
          </Link>
        ) : (
          // Larger, landscape-leaning thumbs so the section feels distinct from
          // the 4-col Inspiration strip below. Show last 4, dominant. Tap →
          // open compare with the latest matching-pose progress photo.
          <div className="grid grid-cols-2 gap-2">
            {photos.slice(0, 4).map((photo) => (
              <button
                key={photo.uuid}
                onClick={() => onCompare(photo)}
                className="relative aspect-[4/5] overflow-hidden rounded-lg bg-muted ring-1 ring-trans-blue/20 text-left"
                aria-label={`Compare with ${POSE_LABELS[photo.pose] ?? photo.pose} projection`}
              >
                <Image
                  src={photo.blob_url}
                  alt={photo.notes ?? 'Projection'}
                  fill
                  sizes="(max-width: 640px) 50vw, 25vw"
                  className="object-cover"
                  style={{
                    transform: offsetTransform(photo.crop_offset_y),
                    transformOrigin: 'center',
                  }}
                  unoptimized
                />
                <div className="absolute bottom-1 left-1 flex gap-1">
                  <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white">
                    {POSE_LABELS[photo.pose] ?? photo.pose}
                  </span>
                  {photo.target_horizon && (
                    <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-trans-blue/80 text-white">
                      {photo.target_horizon}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Inspo photos ────────────────────────────────────────────────────────────

function InspoCard({
  photos,
  onCompare,
}: {
  photos: InspoPhoto[] | undefined;
  onCompare: (photo: InspoPhoto) => void;
}) {
  // undefined = loading, [] = no photos yet, otherwise render strip.
  if (photos === undefined) {
    return (
      <section className="rounded-2xl bg-card border border-border shadow-sm h-32 animate-pulse" />
    );
  }
  return (
    <section className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3 flex items-start gap-3">
        <div className="rounded-xl bg-trans-pink/10 p-2 shrink-0">
          <Camera className="h-5 w-5 text-trans-pink" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold leading-tight">Inspiration</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Physiques to draw from ·{' '}
            <Link href="/inspo" className="text-trans-pink underline underline-offset-2">
              Open gallery
            </Link>
          </p>
        </div>
      </header>
      <div className="px-5 pb-5">
        {photos.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No inspo photos yet. Tap the dumbbell button to capture.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {photos.slice(0, 8).map((photo) => {
              const comparable = isComparablePose(photo.pose);
              const transformStyle = {
                transform: offsetTransform(photo.crop_offset_y),
                transformOrigin: 'center' as const,
              };
              const poseLabel = photo.pose ? (POSE_LABELS[photo.pose] ?? photo.pose) : null;
              return comparable ? (
                <button
                  key={photo.uuid}
                  onClick={() => onCompare(photo)}
                  className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted text-left"
                  aria-label={`Compare with ${poseLabel} inspiration`}
                >
                  <Image
                    src={photo.blob_url}
                    alt={photo.notes ?? 'Inspo photo'}
                    fill
                    sizes="(max-width: 640px) 25vw, 12vw"
                    className="object-cover"
                    style={transformStyle}
                    unoptimized
                  />
                  <span className="absolute bottom-1 left-1 text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white">
                    {poseLabel}
                  </span>
                </button>
              ) : (
                // Untagged or 'other' — no comparable pose. Fall back to gallery link.
                <Link
                  key={photo.uuid}
                  href="/inspo"
                  className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted"
                >
                  <Image
                    src={photo.blob_url}
                    alt={photo.notes ?? 'Inspo photo'}
                    fill
                    sizes="(max-width: 640px) 25vw, 12vw"
                    className="object-cover"
                    style={transformStyle}
                    unoptimized
                  />
                  {poseLabel && (
                    <span className="absolute bottom-1 left-1 text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white">
                      {poseLabel}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function ProseBlock({
  markdown,
  placeholder,
}: {
  markdown: string | null;
  placeholder: string;
}) {
  if (!markdown || markdown.trim().length === 0) {
    return (
      <div className="border-t border-border bg-muted/30 px-5 py-4">
        <p className="text-xs italic text-muted-foreground">{placeholder}</p>
      </div>
    );
  }
  return (
    <div className="border-t border-border px-5 py-4 text-sm leading-relaxed space-y-3">
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{markdown}</ReactMarkdown>
    </div>
  );
}

// Tailwind typography plugin isn't installed — explicit per-element styling
// keeps bundle small and matches the app's design tokens. The `node` prop
// from react-markdown is destructured out so the rest can spread cleanly.
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ node: _node, ...props }) => (
    <h1 className="text-lg font-semibold tracking-tight mt-4 mb-2" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className="text-base font-semibold tracking-tight mt-4 mb-1.5" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="text-sm font-semibold tracking-tight mt-3 mb-1" {...props} />
  ),
  p: ({ node: _node, ...props }) => (
    <p className="leading-relaxed" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="list-disc list-outside ml-5 space-y-1" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="list-decimal list-outside ml-5 space-y-1" {...props} />
  ),
  li: ({ node: _node, ...props }) => (
    <li className="leading-snug" {...props} />
  ),
  strong: ({ node: _node, ...props }) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
  em: ({ node: _node, ...props }) => (
    <em className="italic" {...props} />
  ),
  a: ({ node: _node, ...props }) => (
    <a className="text-trans-blue underline underline-offset-2 hover:opacity-80" {...props} />
  ),
  code: ({ node: _node, ...props }) => (
    <code className="font-mono text-xs px-1 py-0.5 rounded bg-muted" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="border-l-2 border-trans-blue/40 pl-3 italic text-muted-foreground" {...props} />
  ),
  hr: () => <hr className="my-4 border-border" />,
};

function SkeletonCards() {
  return (
    <>
      <div className="rounded-2xl bg-card border border-border h-48 animate-pulse" />
      <div className="rounded-2xl bg-card border border-border h-96 animate-pulse" />
    </>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-card border border-border px-5 py-8 text-center space-y-2">
      <Target className="h-8 w-8 text-muted-foreground mx-auto" strokeWidth={1.5} />
      <p className="text-sm font-medium">No active strategy yet</p>
      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
        Create a Vision and Plan to see them here. The Q2&apos;26 Androgod(ess)
        seed should populate after migration 024 runs.
      </p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(yyyymmdd: string) {
  // Parse as local-date (no TZ shift) then format short.
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
