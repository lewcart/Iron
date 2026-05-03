'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil, Check, X, Sparkles, Loader2 } from 'lucide-react';

// Inline edit affordance for ExerciseDetail's About / Steps / Tips sections.
// Read mode renders the existing layout (paragraph for prose, numbered list
// for steps, bullet list for tips). Edit mode shows a textarea (prose) or a
// list-of-textareas with add/remove (list). On save, calls onSave with the
// new value; the parent's mutation pushes through Dexie + sync.
//
// The pencil icon is only rendered when `editable` is true. Modal mode
// (`chrome='modal'`) passes editable=false so the in-workout reference
// surface stays read-only.
//
// Optional `onMagicGenerate` adds a Sparkles button next to the Pencil that
// AI-generates new content for this section. The handler returns the new
// value (string for prose, string[] for lists). On click: enter edit mode,
// disable the textarea(s) during loading, populate the draft on response.
// AbortController lets Cancel actually stop the spend, not just hide the
// spinner. Hidden when offline or when the prop isn't provided.

type Mode = 'prose' | 'numbered-list' | 'bullet-list';

interface ProseProps {
  mode: 'prose';
  label: string;
  value: string | null;
  emptyPlaceholder?: string;
  editable: boolean;
  onSave: (next: string | null) => Promise<void>;
  onMagicGenerate?: (signal: AbortSignal) => Promise<string | null>;
}

interface ListProps {
  mode: 'numbered-list' | 'bullet-list';
  label: string;
  value: string[];
  emptyPlaceholder?: string;
  editable: boolean;
  onSave: (next: string[]) => Promise<void>;
  onMagicGenerate?: (signal: AbortSignal) => Promise<string[]>;
}

type Props = ProseProps | ListProps;

export function EditableTextSection(props: Props) {
  const [editing, setEditing] = useState(false);
  // Edit-mode draft state. Cast through a permissive shape so we can
  // unify prose + list inside one component without a discriminated tagged
  // union throughout the body. The Mode discriminator drives the render.
  const [draft, setDraft] = useState<string | string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const magicAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Initial state + listen for connectivity changes. Magic is server-only.
    const update = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    }
  }, []);

  // Cancel any in-flight magic request on unmount.
  useEffect(() => () => magicAbortRef.current?.abort(), []);

  const startEdit = () => {
    if (props.mode === 'prose') {
      setDraft(props.value ?? '');
    } else {
      setDraft([...props.value]);
    }
    setEditing(true);
    setMagicError(null);
  };

  const cancelEdit = () => {
    // Abort an in-flight magic request, if any. Cancel actually stops the
    // upstream spend, not just the spinner.
    if (magicLoading) magicAbortRef.current?.abort();
    setEditing(false);
    setDraft(null);
    setMagicLoading(false);
    setMagicError(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (props.mode === 'prose') {
        const next = typeof draft === 'string' ? draft.trim() : '';
        await props.onSave(next.length > 0 ? next : null);
      } else {
        const next = Array.isArray(draft)
          ? draft.map(s => s.trim()).filter(s => s.length > 0)
          : [];
        await (props as ListProps).onSave(next);
      }
      setEditing(false);
      setDraft(null);
      setMagicError(null);
    } finally {
      setSaving(false);
    }
  };

  const runMagic = async () => {
    if (!props.onMagicGenerate || magicLoading) return;
    if (!editing) startEdit();
    setMagicError(null);
    setMagicLoading(true);
    const controller = new AbortController();
    magicAbortRef.current = controller;
    try {
      if (props.mode === 'prose') {
        const next = await props.onMagicGenerate(controller.signal);
        // Asymmetric stomp policy: detail page = always stomp on response.
        // Editing was disabled during loading so no race with user keystrokes.
        setDraft(next ?? '');
      } else {
        const next = await (props as ListProps).onMagicGenerate!(controller.signal);
        setDraft([...next]);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return; // user cancelled
      setMagicError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setMagicLoading(false);
      magicAbortRef.current = null;
    }
  };

  const isEmpty = props.mode === 'prose'
    ? !props.value || props.value.trim() === ''
    : props.value.length === 0;

  // Hide entirely when read-only AND empty. Edit mode always renders.
  if (!props.editable && isEmpty) return null;

  const showMagic = props.editable && !!props.onMagicGenerate;
  const magicDisabled = magicLoading || !online;

  return (
    <div>
      <div className="flex items-center justify-between mb-1 px-1">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide">{props.label}</p>
        {props.editable && !editing && (
          <div className="flex items-center gap-1">
            {showMagic && (
              <button
                onClick={runMagic}
                disabled={magicDisabled}
                className="text-muted-foreground hover:text-primary p-0.5 disabled:opacity-40"
                aria-label={online ? `Generate ${props.label} with AI` : 'Magic needs internet'}
                title={online ? `Generate ${props.label} with AI` : 'Magic needs internet'}
              >
                {magicLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Sparkles className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              onClick={startEdit}
              className="text-muted-foreground hover:text-primary p-0.5"
              aria-label={`Edit ${props.label}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {props.editable && editing && (
          <div className="flex items-center gap-1">
            {showMagic && (
              <button
                onClick={runMagic}
                disabled={magicDisabled}
                className="text-muted-foreground hover:text-primary p-1 disabled:opacity-40"
                aria-label={online ? `Regenerate ${props.label} with AI` : 'Magic needs internet'}
                title={online ? `Regenerate ${props.label} with AI` : 'Magic needs internet'}
              >
                {magicLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Sparkles className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              onClick={save}
              disabled={saving || magicLoading}
              className="text-primary p-1 disabled:opacity-50"
              aria-label="Save"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="text-muted-foreground p-1 disabled:opacity-50"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <>
          <ProseOrListEditor
            mode={props.mode}
            draft={draft}
            setDraft={setDraft}
            placeholder={props.emptyPlaceholder ?? ''}
            disabled={magicLoading}
          />
          {magicLoading && (
            <p className="mt-1 px-1 text-xs text-muted-foreground italic">
              ✨ Generating…
            </p>
          )}
          {magicError && (
            <p className="mt-1 px-1 text-xs text-destructive">
              {magicError}. Tap ✨ to try again.
            </p>
          )}
        </>
      ) : isEmpty ? (
        <div className="ios-section p-4">
          <p className="text-sm text-muted-foreground italic">
            {props.emptyPlaceholder ?? 'No content yet.'}
          </p>
        </div>
      ) : (
        <ProseOrListReader mode={props.mode} value={(props.mode === 'prose' ? props.value : props.value) as string | string[] | null} />
      )}
    </div>
  );
}

function ProseOrListReader({
  mode,
  value,
}: {
  mode: Mode;
  value: string | string[] | null;
}) {
  if (mode === 'prose') {
    const v = (value as string | null) ?? '';
    return (
      <div className="ios-section p-4">
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{v}</p>
      </div>
    );
  }

  const items = (value as string[]) ?? [];
  return (
    <div className="ios-section">
      {items.map((item, i) =>
        mode === 'numbered-list' ? (
          <div key={i} className="ios-row gap-3">
            <span className="text-xs font-bold text-primary w-5 text-center flex-shrink-0">{i + 1}</span>
            <p className="text-sm flex-1 leading-snug">{item}</p>
          </div>
        ) : (
          <div key={i} className="ios-row">
            <p className="text-sm flex-1 leading-snug">{item}</p>
          </div>
        ),
      )}
    </div>
  );
}

// Exported so CreateExerciseForm can reuse the same list-editor UX without
// duplicating ~60 lines. Already cleanly parent-controlled (takes draft +
// setDraft only), so reuse is safe.
export function ProseOrListEditor({
  mode,
  draft,
  setDraft,
  placeholder,
  disabled = false,
}: {
  mode: Mode;
  draft: string | string[] | null;
  setDraft: (v: string | string[] | null) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  if (mode === 'prose') {
    const v = (draft as string | null) ?? '';
    return (
      <div className="ios-section p-2">
        <textarea
          autoFocus
          value={v}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={4}
          disabled={disabled}
          className="w-full bg-transparent text-sm text-foreground outline-none resize-none leading-relaxed disabled:opacity-50"
        />
      </div>
    );
  }

  const items = (draft as string[]) ?? [];
  return (
    <div className="ios-section divide-y divide-border">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 px-3 py-2">
          {mode === 'numbered-list' && (
            <span className="text-xs font-bold text-primary w-5 text-center flex-shrink-0 mt-1">{i + 1}</span>
          )}
          <textarea
            value={item}
            onChange={e => {
              const next = [...items];
              next[i] = e.target.value;
              setDraft(next);
            }}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            className="flex-1 bg-transparent text-sm text-foreground outline-none resize-none leading-snug disabled:opacity-50"
          />
          <button
            onClick={() => setDraft(items.filter((_, j) => j !== i))}
            disabled={disabled}
            className="text-muted-foreground hover:text-destructive p-1 disabled:opacity-40"
            aria-label="Remove item"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={() => setDraft([...items, ''])}
        disabled={disabled}
        className="w-full text-left px-3 py-2 text-sm text-primary disabled:opacity-40"
      >
        + Add {mode === 'numbered-list' ? 'step' : 'tip'}
      </button>
    </div>
  );
}
