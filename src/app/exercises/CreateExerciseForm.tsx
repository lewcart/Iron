'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { createCustomExercise } from '@/lib/mutations-exercises';
import { MUSCLE_SLUGS, MUSCLE_DEFS, type MuscleSlug } from '@/lib/muscles';

const EQUIPMENT_OPTIONS = [
  'barbell', 'dumbbell', 'cable', 'machine',
  'bodyweight', 'kettlebell', 'resistance band', 'pull-up bar',
  'bench', 'smith machine', 'trap bar',
];

const MOVEMENT_PATTERNS = [
  'push (horizontal)', 'push (vertical)',
  'pull (horizontal)', 'pull (vertical)',
  'hinge', 'squat', 'carry', 'rotation', 'isolation',
];

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Canonical-only muscle multi-select. Renders one chip per slug, grouped by
 * parent_group. Tap to toggle. Slugs already selected as primary appear
 * dimmed in the secondary picker (and vice versa) so a muscle can't end up
 * in both lists.
 */
function MusclePicker({
  label,
  values,
  disabledSlugs,
  onChange,
}: {
  label: string;
  values: MuscleSlug[];
  disabledSlugs: MuscleSlug[];
  onChange: (v: MuscleSlug[]) => void;
}) {
  const disabled = new Set<string>(disabledSlugs);
  const selected = new Set<string>(values);

  // Group canonical slugs by parent_group, preserving display_order.
  const groupOrder = ['chest', 'back', 'shoulders', 'arms', 'core', 'legs'];
  const groups = new Map<string, MuscleSlug[]>();
  for (const slug of MUSCLE_SLUGS) {
    const pg = MUSCLE_DEFS[slug].parent_group;
    if (!groups.has(pg)) groups.set(pg, []);
    groups.get(pg)!.push(slug);
  }

  const toggle = (slug: MuscleSlug) => {
    if (disabled.has(slug)) return;
    onChange(selected.has(slug) ? values.filter(v => v !== slug) : [...values, slug]);
  };

  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="mt-1 space-y-2">
        {groupOrder.filter(g => groups.has(g)).map(g => (
          <div key={g}>
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 capitalize">{g}</div>
            <div className="flex flex-wrap gap-1.5">
              {groups.get(g)!.map(slug => {
                const isSelected = selected.has(slug);
                const isDisabled = disabled.has(slug);
                return (
                  <button
                    type="button"
                    key={slug}
                    onClick={() => toggle(slug)}
                    disabled={isDisabled}
                    className={
                      'px-2 py-1 text-xs rounded-full border transition-colors ' +
                      (isSelected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : isDisabled
                        ? 'bg-secondary/40 text-muted-foreground/40 border-border cursor-not-allowed'
                        : 'bg-secondary text-foreground border-border hover:bg-primary/10')
                    }
                    title={isDisabled ? `Already selected as ${label.includes('Primary') ? 'secondary' : 'primary'}` : undefined}
                  >
                    {MUSCLE_DEFS[slug].display_name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TagInput({
  label,
  values,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  options: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');
  const filtered = input.trim()
    ? options.filter(
        (o) => o.toLowerCase().includes(input.toLowerCase()) && !values.includes(o)
      )
    : [];

  const add = (val: string) => {
    const trimmed = val.trim().toLowerCase();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
  };

  const remove = (val: string) => onChange(values.filter((v) => v !== val));

  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="mt-1 flex flex-wrap gap-1.5 min-h-[36px] p-2 bg-secondary rounded-lg">
        {values.map((v) => (
          <span
            key={v}
            className="flex items-center gap-1 px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full"
          >
            {v}
            <button type="button" onClick={() => remove(v)} className="leading-none">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (input.trim()) add(input);
            }
          }}
          placeholder={values.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none"
        />
      </div>
      {filtered.length > 0 && (
        <div className="mt-1 bg-popover border border-border rounded-lg overflow-hidden shadow-lg z-10">
          {filtered.slice(0, 5).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => add(o)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-secondary capitalize"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CreateExerciseForm({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [primaryMuscles, setPrimaryMuscles] = useState<string[]>([]);
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [movementPattern, setMovementPattern] = useState('');
  const [description, setDescription] = useState('');
  const [trackingMode, setTrackingMode] = useState<'reps' | 'time'>('reps');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 0 && primaryMuscles.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    // Validate YouTube URL inline. Empty is fine. Garbage rejects with an
    // error rather than silently dropping — the user gets feedback.
    let ytClean: string | null = null;
    const ytTrimmed = youtubeUrl.trim();
    if (ytTrimmed.length > 0) {
      const { parseYouTubeUrl } = await import('@/lib/youtube-url');
      const parsed = parseYouTubeUrl(ytTrimmed);
      if (!parsed) {
        setYoutubeError('Not a valid YouTube URL');
        return;
      }
      ytClean = ytTrimmed;
    }
    setYoutubeError(null);

    setSubmitting(true);
    try {
      await createCustomExercise({
        title: title.trim(),
        primary_muscles: primaryMuscles,
        secondary_muscles: secondaryMuscles.length > 0 ? secondaryMuscles : undefined,
        equipment: equipment.length > 0 ? equipment : undefined,
        movement_pattern: movementPattern || undefined,
        description: description.trim() || undefined,
        tracking_mode: trackingMode,
        youtube_url: ytClean,
      });
      onCreated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-background rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold">New Exercise</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-4 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Exercise Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "Romanian Deadlift: Dumbbell"'
              autoFocus
              className="mt-1 w-full px-3 py-2 bg-secondary rounded-lg text-sm outline-none"
            />
          </div>

          {/* Primary muscles — canonical-only multi-select grouped by area */}
          <MusclePicker
            label="Primary Muscles *"
            values={primaryMuscles as MuscleSlug[]}
            disabledSlugs={secondaryMuscles as MuscleSlug[]}
            onChange={(v) => setPrimaryMuscles(v as string[])}
          />

          {/* Secondary muscles */}
          <MusclePicker
            label="Secondary Muscles"
            values={secondaryMuscles as MuscleSlug[]}
            disabledSlugs={primaryMuscles as MuscleSlug[]}
            onChange={(v) => setSecondaryMuscles(v as string[])}
          />

          {/* Equipment */}
          <TagInput
            label="Equipment"
            values={equipment}
            options={EQUIPMENT_OPTIONS}
            onChange={setEquipment}
            placeholder="e.g. barbell"
          />

          {/* Tracking mode — reps × weight vs held duration */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Tracking
            </label>
            <div className="mt-1 flex gap-2 bg-secondary rounded-lg p-1">
              <button
                type="button"
                onClick={() => setTrackingMode('reps')}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  trackingMode === 'reps' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                Reps × Weight
              </button>
              <button
                type="button"
                onClick={() => setTrackingMode('time')}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  trackingMode === 'time' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                Time (held)
              </button>
            </div>
          </div>

          {/* Movement pattern */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Movement Pattern
            </label>
            <select
              value={movementPattern}
              onChange={(e) => setMovementPattern(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-secondary rounded-lg text-sm outline-none appearance-none"
            >
              <option value="">— Select —</option>
              {MOVEMENT_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Notes / Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional cues or description…"
              rows={3}
              className="mt-1 w-full px-3 py-2 bg-secondary rounded-lg text-sm outline-none resize-none"
            />
          </div>

          {/* YouTube URL — optional. Tap on the demo strip later opens this.
              Validate inline; reject garbage on submit. */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              YouTube reference (optional)
            </label>
            <input
              type="url"
              value={youtubeUrl}
              onChange={(e) => { setYoutubeUrl(e.target.value); setYoutubeError(null); }}
              placeholder="https://youtu.be/… or https://www.youtube.com/watch?v=…"
              className="mt-1 w-full px-3 py-2 bg-secondary rounded-lg text-sm outline-none"
            />
            {youtubeError && (
              <p className="mt-1 text-xs text-destructive">{youtubeError}</p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Add ?t=42 to start at a specific second (or ?t=1m23s).
            </p>
          </div>

        </form>

        {/* Footer */}
        <div className="px-4 pb-safe-or-4 pt-3 border-t border-border shrink-0">
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-xl text-sm disabled:opacity-40 transition-opacity"
          >
            {submitting ? 'Creating…' : 'Create Exercise'}
          </button>
        </div>
      </div>
    </div>
  );
}
