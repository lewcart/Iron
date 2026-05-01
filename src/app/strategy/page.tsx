'use client';

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
} from 'lucide-react';
import {
  useActiveVision,
  useActivePlan,
  useCheckpointsForPlan,
} from '@/lib/useLocalDB-strategy';
import type {
  LocalBodyVision,
  LocalBodyPlan,
  LocalPlanCheckpoint,
  NorthStarMetric,
  ProgrammingDose,
} from '@/db/local';

export default function StrategyPage() {
  const vision = useActiveVision();
  const plan = useActivePlan();
  const checkpoints = useCheckpointsForPlan(plan?.uuid);

  // useLiveQuery returns undefined while loading, null/[] when nothing matches.
  const loading = vision === undefined || plan === undefined;

  return (
    <main className="tab-content px-4 pt-6 pb-8 max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight gradient-brand-text">
          Strategy
        </h1>
        <p className="text-sm text-muted-foreground">
          Vision and Plan — what you&apos;re building, and how.
        </p>
      </header>

      {loading && <SkeletonCards />}

      {!loading && !vision && !plan && <EmptyState />}

      {vision && <VisionCard vision={vision} />}
      {plan && <PlanCard plan={plan} checkpoints={checkpoints} />}
    </main>
  );
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

      {checkpoints.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Checkpoints
          </p>
          <ol className="space-y-1.5">
            {checkpoints.map((c) => (
              <CheckpointRow key={c.uuid} checkpoint={c} />
            ))}
          </ol>
        </div>
      )}

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
