'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { createExercise } from '@/lib/api/exercises';
import { queryKeys } from '@/lib/api/query-keys';

const MUSCLE_OPTIONS = [
  'chest', 'pectoralis',
  'back', 'latissimus', 'rhomboids', 'trapezius',
  'shoulders', 'deltoids',
  'biceps', 'triceps', 'forearms',
  'quadriceps', 'hamstrings', 'glutes', 'calves',
  'abdominals', 'core', 'obliques',
  'hip abductors', 'hip flexors', 'lower back',
];

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
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [primaryMuscles, setPrimaryMuscles] = useState<string[]>([]);
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [movementPattern, setMovementPattern] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: createExercise,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.exercises.catalog() });
      onCreated();
    },
  });

  const canSubmit = title.trim().length > 0 && primaryMuscles.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate({
      title: title.trim(),
      primary_muscles: primaryMuscles,
      secondary_muscles: secondaryMuscles.length > 0 ? secondaryMuscles : undefined,
      equipment: equipment.length > 0 ? equipment : undefined,
      movement_pattern: movementPattern || undefined,
      description: description.trim() || undefined,
    });
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

          {/* Primary muscles */}
          <TagInput
            label="Primary Muscles *"
            values={primaryMuscles}
            options={MUSCLE_OPTIONS}
            onChange={setPrimaryMuscles}
            placeholder="e.g. hamstrings"
          />

          {/* Secondary muscles */}
          <TagInput
            label="Secondary Muscles"
            values={secondaryMuscles}
            options={MUSCLE_OPTIONS}
            onChange={setSecondaryMuscles}
            placeholder="e.g. lower back"
          />

          {/* Equipment */}
          <TagInput
            label="Equipment"
            values={equipment}
            options={EQUIPMENT_OPTIONS}
            onChange={setEquipment}
            placeholder="e.g. barbell"
          />

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

          {mutation.isError && (
            <p className="text-sm text-destructive">
              Failed to create exercise. Please try again.
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="px-4 pb-safe-or-4 pt-3 border-t border-border shrink-0">
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={!canSubmit || mutation.isPending}
            className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-xl text-sm disabled:opacity-40 transition-opacity"
          >
            {mutation.isPending ? 'Creating…' : 'Create Exercise'}
          </button>
        </div>
      </div>
    </div>
  );
}
