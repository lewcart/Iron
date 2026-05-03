import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiKey } from '@/lib/api-auth';
import {
  buildContentPrompt,
  SCHEMA_BOUNDS,
  type ContentKind,
  type ExerciseLike,
} from '@/lib/exercise-content-prompt';

// POST /api/exercises/generate-content
//
// AI-generated content for exercise About / Steps / Tips fields. Powers the
// Sparkles magic button on ExerciseDetail (per-field) AND the bundled
// "Auto-fill" button on CreateExerciseForm.
//
// Body shapes (discriminated by `kind`):
//   • { kind: 'description'|'steps'|'tips', exercise: { ... live exercise from Dexie ... } }
//   • { kind: 'all',                        exercise: { ... draft from CreateForm ... } }
//
// The CLIENT passes the full exercise object — NEVER look it up server-side
// by uuid. Rebirth is local-first; Dexie has the truth, Postgres lags any
// unsynced edits. Looking up by uuid would feed the LLM stale data.
//
// Auth: requireApiKey (single-user, bounds external abuse on a paid API).
// maxDuration: 60s. Text gen is much faster than image gen — gpt-4o-mini at
// ~500 tokens out is p99 ~5-8s. AbortController bound to ~30s per call.

export const maxDuration = 60;
const PER_CALL_TIMEOUT_MS = 30_000;

const ExerciseLikeSchema = z.object({
  uuid: z.string().optional(),
  title: z.string().min(1),
  primary_muscles: z.array(z.string()).optional(),
  secondary_muscles: z.array(z.string()).optional(),
  equipment: z.array(z.string()).optional(),
  movement_pattern: z.string().nullable().optional(),
  tracking_mode: z.enum(['reps', 'time']).nullable().optional(),
  description: z.string().nullable().optional(),
  steps: z.array(z.string()).optional(),
  tips: z.array(z.string()).optional(),
});

const BodySchema = z.object({
  kind: z.enum(['description', 'steps', 'tips', 'all']),
  exercise: ExerciseLikeSchema,
});

type Body = z.infer<typeof BodySchema>;

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured on server' },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    const raw = await request.json();
    body = BodySchema.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid request body';
    return NextResponse.json({ error: `Invalid body: ${message}` }, { status: 400 });
  }

  // kind='all' is the CreateForm path — draft exercise, no uuid yet. Reject
  // kind='all' with a uuid present so the contract stays unambiguous: the
  // detail page never wants to atomically overwrite all three fields at once.
  if (body.kind === 'all' && body.exercise.uuid) {
    return NextResponse.json(
      { error: "kind='all' is reserved for new-exercise drafts; do not pass uuid" },
      { status: 400 },
    );
  }

  const { systemPrompt, userPrompt, schema } = buildContentPrompt({
    kind: body.kind,
    exercise: body.exercise as ExerciseLike,
  });

  // Lazy-import openai so the client bundle never sees it (matches the
  // generate-images route pattern).
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey });

  // Wire BOTH the per-call timeout AND the request's signal into the OpenAI
  // SDK call. Aborting the browser fetch alone doesn't kill the upstream
  // request — without this, cancel just hides the spinner while the server
  // keeps spending. AbortSignal.any combines our timeout with the client's
  // disconnect signal.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), PER_CALL_TIMEOUT_MS);
  const signal = AbortSignal.any([timeoutController.signal, request.signal]);

  let parsed: unknown;
  try {
    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_schema', json_schema: schema },
      },
      { signal },
    );
    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) throw new Error('OpenAI returned no content');
    parsed = JSON.parse(raw);
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort =
      (err as { name?: string })?.name === 'AbortError' ||
      timeoutController.signal.aborted ||
      request.signal.aborted;
    if (isAbort) {
      return NextResponse.json(
        { error: 'Generation aborted (cancelled or timed out)' },
        { status: 504 },
      );
    }
    const message = err instanceof Error ? err.message : 'OpenAI call failed';
    console.error('[generate-content] OpenAI error:', err);
    return NextResponse.json({ error: `OpenAI: ${message}` }, { status: 502 });
  }
  clearTimeout(timeoutId);

  // Defensive post-parse validation. structured-outputs strict mode normally
  // enforces these, but the route is the only real guard before the value
  // round-trips through Dexie + sync — the DB accepts arbitrary JSON.
  try {
    validateOutput(body.kind, parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Schema check failed';
    console.error('[generate-content] post-parse validation failed:', err, parsed);
    return NextResponse.json(
      { error: `OpenAI returned schema-violating output: ${message}` },
      { status: 502 },
    );
  }

  return NextResponse.json(parsed);
}

function validateOutput(kind: ContentKind, value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error('not an object');
  }
  const obj = value as Record<string, unknown>;

  const checkDescription = (d: unknown) => {
    if (typeof d !== 'string' || d.trim() === '') throw new Error('description must be a non-empty string');
    if (d.length > SCHEMA_BOUNDS.description.maxLength) throw new Error('description exceeds maxLength');
  };
  const checkArray = (
    field: 'steps' | 'tips',
    v: unknown,
    bounds: { minItems: number; maxItems: number; itemMaxLength: number },
  ) => {
    if (!Array.isArray(v)) throw new Error(`${field} must be an array`);
    if (v.length < bounds.minItems) throw new Error(`${field} below minItems (${bounds.minItems})`);
    if (v.length > bounds.maxItems) throw new Error(`${field} above maxItems (${bounds.maxItems})`);
    for (const item of v) {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new Error(`${field} items must be non-empty strings`);
      }
      if (item.length > bounds.itemMaxLength) {
        throw new Error(`${field} item exceeds maxLength (${bounds.itemMaxLength})`);
      }
    }
  };

  switch (kind) {
    case 'description':
      checkDescription(obj.description);
      return;
    case 'steps':
      checkArray('steps', obj.steps, SCHEMA_BOUNDS.steps);
      return;
    case 'tips':
      checkArray('tips', obj.tips, SCHEMA_BOUNDS.tips);
      return;
    case 'all':
      checkDescription(obj.description);
      checkArray('steps', obj.steps, SCHEMA_BOUNDS.steps);
      checkArray('tips', obj.tips, SCHEMA_BOUNDS.tips);
      return;
  }
}
