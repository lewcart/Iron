'use client';

// Editor Sheets for the /strategy page — Vision card, Plan card, and a
// per-plan "New checkpoint" form. Read render lives in page.tsx; the sheets
// here are only mounted when the user taps the pencil/plus affordance.
//
// Pattern: controlled draft state inside the sheet, save calls into
// mutations-strategy.ts which writes Dexie + schedules a sync push. The
// useLiveQuery hooks on the read page pick up the change automatically.

import { useEffect, useState } from 'react';
import { Pencil, Plus, Eye, Edit3 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  upsertVision,
  updatePlan,
  logCheckpoint,
} from '@/lib/mutations-strategy';
import type {
  LocalBodyVision,
  LocalBodyPlan,
} from '@/db/local';

// ─── Common pieces ───────────────────────────────────────────────────────────

function ChipInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  // Comma-separated string for v1 — simple, copy/paste-friendly. The list
  // is normalized on save (trim + drop empties).
  const [text, setText] = useState(value.join(', '));
  useEffect(() => { setText(value.join(', ')); }, [value]);
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="text"
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value.split(',').map(s => s.trim()).filter(s => s.length > 0),
          );
        }}
        placeholder={placeholder ?? 'comma, separated, values'}
      />
    </label>
  );
}

function MarkdownTextArea({
  label,
  value,
  onChange,
  placeholder,
  minRows = 12,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minRows?: number;
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        {label ? (
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        ) : <span />}
        <div className="flex rounded-md border border-border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setTab('edit')}
            className={`flex items-center gap-1 px-2 py-1 ${tab === 'edit' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
          >
            <Edit3 className="h-3 w-3" /> Edit
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1 px-2 py-1 border-l border-border ${tab === 'preview' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
          >
            <Eye className="h-3 w-3" /> Preview
          </button>
        </div>
      </div>
      {tab === 'edit' ? (
        <textarea
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
          rows={minRows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? '# Heading\n\nMarkdown body…'}
        />
      ) : (
        <div className="rounded-md border border-border bg-background px-3 py-3 text-sm leading-relaxed min-h-[12rem]">
          {value.trim().length === 0 ? (
            <p className="text-xs italic text-muted-foreground">Nothing to preview yet.</p>
          ) : (
            <ReactMarkdown>{value}</ReactMarkdown>
          )}
        </div>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="text"
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

// ─── Edit-Vision button + sheet ──────────────────────────────────────────────

export function EditVisionButton({ vision }: { vision: LocalBodyVision }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit vision"
        className="inline-flex items-center justify-center rounded-md border border-border bg-background/50 hover:bg-muted transition-colors h-8 w-8 shrink-0"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {open && <VisionEditorSheet vision={vision} onClose={() => setOpen(false)} />}
    </>
  );
}

function VisionEditorSheet({
  vision,
  onClose,
}: {
  vision: LocalBodyVision;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(vision.title);
  const [summary, setSummary] = useState(vision.summary ?? '');
  const [bodyMd, setBodyMd] = useState(vision.body_md ?? '');
  const [principles, setPrinciples] = useState(vision.principles);
  const [build, setBuild] = useState(vision.build_emphasis);
  const [maintain, setMaintain] = useState(vision.maintain_emphasis);
  const [deemph, setDeemph] = useState(vision.deemphasize);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await upsertVision({
        uuid: vision.uuid,
        title: title.trim(),
        body_md: bodyMd.trim() || null,
        summary: summary.trim() || null,
        principles,
        build_emphasis: build,
        maintain_emphasis: maintain,
        deemphasize: deemph,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit Vision"
      height="90vh"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="px-4 py-4 space-y-4">
        <TextField label="Title" value={title} onChange={setTitle} />
        <TextField label="Summary" value={summary} onChange={setSummary} placeholder="Short pull-quote for cards (optional)" />
        <ChipInput label="Principles" value={principles} onChange={setPrinciples} />
        <ChipInput label="Build emphasis" value={build} onChange={setBuild} placeholder="shoulder caps, glute width…" />
        <ChipInput label="Maintain emphasis" value={maintain} onChange={setMaintain} />
        <ChipInput label="De-emphasize" value={deemph} onChange={setDeemph} />
        <MarkdownTextArea
          label="Body (markdown)"
          value={bodyMd}
          onChange={setBodyMd}
          placeholder={'# Why this vision\n\nWhat are we actually building?'}
        />
      </div>
    </Sheet>
  );
}

// ─── Edit-Plan button + sheet ────────────────────────────────────────────────

export function EditPlanButton({ plan }: { plan: LocalBodyPlan }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit plan"
        className="inline-flex items-center justify-center rounded-md border border-border bg-background/50 hover:bg-muted transition-colors h-8 w-8 shrink-0"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {open && <PlanEditorSheet plan={plan} onClose={() => setOpen(false)} />}
    </>
  );
}

function PlanEditorSheet({
  plan,
  onClose,
}: {
  plan: LocalBodyPlan;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(plan.title);
  const [summary, setSummary] = useState(plan.summary ?? '');
  const [bodyMd, setBodyMd] = useState(plan.body_md ?? '');
  const [triggers, setTriggers] = useState(plan.reevaluation_triggers);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updatePlan({
        uuid: plan.uuid,
        title: title.trim(),
        summary: summary.trim() || null,
        body_md: bodyMd.trim() || null,
        reevaluation_triggers: triggers,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit Plan"
      height="90vh"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="px-4 py-4 space-y-4">
        <TextField label="Title" value={title} onChange={setTitle} />
        <TextField
          label="Summary"
          value={summary}
          onChange={setSummary}
          placeholder="One-liner — what this plan is fundamentally about"
        />
        <ChipInput label="Re-evaluate when" value={triggers} onChange={setTriggers} />
        <MarkdownTextArea
          label="Strategy body (markdown)"
          value={bodyMd}
          onChange={setBodyMd}
          placeholder={'## Why this plan\n\n## How we get there\n\n## Risks'}
        />
        <p className="text-xs text-muted-foreground italic leading-relaxed">
          North-star metrics, programming dose, nutrition anchors, and
          horizon dates aren&apos;t in this v1 sheet — they&apos;re structured-heavy and
          better edited via MCP tools (update_plan with the typed fields) or
          a future structured-form view. The sheet here covers the prose +
          summary + triggers Lou edits day-to-day.
        </p>
      </div>
    </Sheet>
  );
}

// ─── New-checkpoint button + sheet ───────────────────────────────────────────

export function NewCheckpointButton({ planId }: { planId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="New checkpoint"
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background/50 hover:bg-muted transition-colors h-7 px-2 text-xs"
      >
        <Plus className="h-3 w-3" /> Checkpoint
      </button>
      {open && <CheckpointSheet planId={planId} onClose={() => setOpen(false)} />}
    </>
  );
}

function CheckpointSheet({
  planId,
  onClose,
}: {
  planId: string;
  onClose: () => void;
}) {
  // Default the target date to today and the quarter_label to "Q? YYYY"
  // best-guess from today's month. Lou can override either in the form.
  const today = new Date();
  const yyyy = today.getFullYear();
  const month = today.getMonth() + 1; // 1-12
  const quarter = Math.ceil(month / 3); // 1-4
  const defaultLabel = `Q${quarter} ${yyyy}`;
  const todayIso = `${yyyy}-${String(month).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [quarterLabel, setQuarterLabel] = useState(defaultLabel);
  const [targetDate, setTargetDate] = useState(todayIso);
  const [reviewDate, setReviewDate] = useState(todayIso);
  const [bodyMd, setBodyMd] = useState('');
  const [assessment, setAssessment] = useState<'' | 'on_track' | 'ahead' | 'behind' | 'reset_required'>('');
  const [adjustments, setAdjustments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await logCheckpoint({
        plan_id: planId,
        quarter_label: quarterLabel.trim() || defaultLabel,
        target_date: targetDate,
        review_date: reviewDate || null,
        status: reviewDate ? 'completed' : 'scheduled',
        notes: bodyMd.trim() || null,
        assessment: assessment || null,
        adjustments_made: adjustments,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="New Checkpoint"
      height="80vh"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !quarterLabel.trim() || !targetDate}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="px-4 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Quarter label" value={quarterLabel} onChange={setQuarterLabel} placeholder="Q3 2026" />
          <TextField label="Target date" value={targetDate} onChange={setTargetDate} placeholder="YYYY-MM-DD" />
        </div>
        <TextField
          label="Review date (today, if completing now)"
          value={reviewDate}
          onChange={setReviewDate}
          placeholder="YYYY-MM-DD"
        />
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Assessment</span>
          <select
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={assessment}
            onChange={(e) => setAssessment(e.target.value as typeof assessment)}
          >
            <option value="">— pick one —</option>
            <option value="on_track">on_track</option>
            <option value="ahead">ahead</option>
            <option value="behind">behind</option>
            <option value="reset_required">reset_required</option>
          </select>
        </label>
        <ChipInput label="Adjustments made" value={adjustments} onChange={setAdjustments} placeholder="e.g. add cardio floor, drop deadlift" />
        <MarkdownTextArea
          label="Notes (markdown)"
          value={bodyMd}
          onChange={setBodyMd}
          minRows={8}
          placeholder={'## What happened\n\n## What I observed\n\n## What changes'}
        />
      </div>
    </Sheet>
  );
}
