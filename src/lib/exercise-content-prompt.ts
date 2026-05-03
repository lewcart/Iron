// Prompt builder for the AI "magic" content generator on exercises.
//
// Powers the Sparkles button next to the Pencil edit affordance on
// ExerciseDetail (per-field: About / Steps / Tips) AND the bundled
// "Auto-fill" button on CreateExerciseForm (kind='all').
//
// Two ground rules:
//   1. CROSS-FIELD CONTEXT, NEVER OWN. Generating Steps sees existing
//      description + tips, never the existing steps. LLMs rephrase rather
//      than rethink when handed their own current value, defeating the
//      "click magic to escape this text" intent.
//   2. CROSS-FIELD IS DATA, NOT INSTRUCTIONS. User-typed content can
//      contain "ignore previous instructions". Wrap in <exercise_context>
//      tags so the model treats it as quoted data.
//
// The schemas are enforced by OpenAI structured outputs (strict mode) at
// the API call site; the route also runs a defensive post-parse check.

export type ContentKind = 'description' | 'steps' | 'tips' | 'all';

export interface ExerciseLike {
  title: string;
  primary_muscles?: string[];
  secondary_muscles?: string[];
  equipment?: string[];
  movement_pattern?: string | null;
  tracking_mode?: 'reps' | 'time' | null;
  description?: string | null;
  steps?: string[];
  tips?: string[];
}

export interface BuildContentPromptInput {
  kind: ContentKind;
  exercise: ExerciseLike;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  /** OpenAI structured-output schema. Always object root, strict-compatible. */
  schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
}

const PROMPT_SOFT_CAP_CHARS = 2000;

const VOICE = {
  description:
    'You write factual, third-person, encyclopedia-style descriptions of strength exercises. ' +
    'One or two sentences max. Name the primary muscle action and movement pattern. ' +
    'No fluff, no "this exercise is great for...", no marketing voice.',
  steps:
    'You write imperative, second-person setup-and-execution steps for strength exercises. ' +
    'One discrete action per step. No numbering (the UI numbers them). ' +
    'Aim for 3-7 steps total. Each step under 120 characters. Setup first, then execution, then return.',
  tips:
    'You write short imperative or warning coaching cues for strength exercises. ' +
    'Each cue addresses a common form mistake or a thing to watch for. ' +
    'Aim for 2-5 cues total. Each cue under 100 characters. Direct, no hedging.',
  all:
    'You generate a complete first draft of an exercise catalog entry: a factual description, ' +
    'imperative setup-and-execution steps, and short coaching cues. See the per-field schemas for length and count bounds. ' +
    'description: third-person factual, 1-2 sentences. ' +
    'steps: second-person imperative, 3-7 actions, no numbering. ' +
    'tips: short cues for common form mistakes, 2-5 items.',
} as const;

// Property schema fragments (reused inside `all` and the single-field wrappers).
const DESCRIPTION_PROP = { type: 'string', maxLength: 280 } as const;
const STEPS_PROP = {
  type: 'array',
  minItems: 3,
  maxItems: 8,
  items: { type: 'string', maxLength: 120 },
} as const;
const TIPS_PROP = {
  type: 'array',
  minItems: 2,
  maxItems: 6,
  items: { type: 'string', maxLength: 100 },
} as const;

function schemaFor(kind: ContentKind): BuiltPrompt['schema'] {
  // OpenAI structured outputs require an object root + strict + additionalProperties:false
  // + every key listed in required.
  switch (kind) {
    case 'description':
      return {
        name: 'exercise_description',
        strict: true,
        schema: {
          type: 'object',
          properties: { description: DESCRIPTION_PROP },
          required: ['description'],
          additionalProperties: false,
        },
      };
    case 'steps':
      return {
        name: 'exercise_steps',
        strict: true,
        schema: {
          type: 'object',
          properties: { steps: STEPS_PROP },
          required: ['steps'],
          additionalProperties: false,
        },
      };
    case 'tips':
      return {
        name: 'exercise_tips',
        strict: true,
        schema: {
          type: 'object',
          properties: { tips: TIPS_PROP },
          required: ['tips'],
          additionalProperties: false,
        },
      };
    case 'all':
      return {
        name: 'exercise_content_all',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            description: DESCRIPTION_PROP,
            steps: STEPS_PROP,
            tips: TIPS_PROP,
          },
          required: ['description', 'steps', 'tips'],
          additionalProperties: false,
        },
      };
  }
}

/** Sanitize a user-supplied string before embedding it inside <exercise_context>
 *  tags. Defense-in-depth: strip any literal close-tag so a crafted description
 *  can't escape the data block and feed instructions to the model. */
function escapeForContext(s: string): string {
  return s.replace(/<\/exercise_context>/gi, '<\\/exercise_context>');
}

/** Build the catalog (always-include) section: title, muscles, equipment,
 *  movement pattern, tracking mode. These are app-controlled fields that
 *  don't carry user-prompt-injection risk. */
function buildCatalogSection(exercise: ExerciseLike): string[] {
  const lines: string[] = [`Title: ${exercise.title}`];
  if (exercise.primary_muscles?.length) {
    lines.push(`Primary muscles: ${exercise.primary_muscles.join(', ')}`);
  }
  if (exercise.secondary_muscles?.length) {
    lines.push(`Secondary muscles: ${exercise.secondary_muscles.join(', ')}`);
  }
  const equipment = exercise.equipment?.length ? exercise.equipment.join(', ') : 'bodyweight';
  lines.push(`Equipment: ${equipment}`);
  if (exercise.movement_pattern) {
    lines.push(`Movement pattern: ${exercise.movement_pattern}`);
  }
  if (exercise.tracking_mode) {
    lines.push(
      `Tracking mode: ${exercise.tracking_mode === 'time' ? 'isometric hold (duration)' : 'reps × weight'}`,
    );
  }
  return lines;
}

/** Build the cross-field context block. Excludes the kind being generated
 *  (the "rephrase trap" rule). For kind='all', returns no cross-field — the
 *  CreateForm path has nothing to draw from. */
function buildCrossFieldBlock(kind: ContentKind, exercise: ExerciseLike): string {
  if (kind === 'all') return '';

  const parts: string[] = [];
  if (kind !== 'description' && exercise.description?.trim()) {
    parts.push(`Description: ${escapeForContext(exercise.description.trim())}`);
  }
  if (kind !== 'steps' && exercise.steps?.length) {
    const cleaned = exercise.steps.map((s) => escapeForContext(s.trim())).filter(Boolean);
    if (cleaned.length) parts.push(`Steps: ${cleaned.join('. ')}`);
  }
  if (kind !== 'tips' && exercise.tips?.length) {
    const cleaned = exercise.tips.map((t) => escapeForContext(t.trim())).filter(Boolean);
    if (cleaned.length) parts.push(`Tips: ${cleaned.join('. ')}`);
  }

  if (parts.length === 0) return '';
  return ['<exercise_context>', ...parts, '</exercise_context>'].join('\n');
}

/** Apply the soft size cap. Trim cross-field FIRST (it's the variable-length
 *  bit), preserve the catalog section (always small + always relevant). */
function softCap(catalogBlock: string, crossFieldBlock: string, taskLine: string): string {
  const join = (cf: string) =>
    [catalogBlock, cf, taskLine].filter((s) => s.length > 0).join('\n\n');

  let joined = join(crossFieldBlock);
  if (joined.length <= PROMPT_SOFT_CAP_CHARS) return joined;

  // Truncate cross-field block from the end, leaving the closing tag intact.
  const closeTag = '\n</exercise_context>';
  const hasTags = crossFieldBlock.endsWith(closeTag);
  const overhead = hasTags ? closeTag.length + '<exercise_context>\n'.length : 0;
  const targetCfLen = Math.max(0, PROMPT_SOFT_CAP_CHARS - (joined.length - crossFieldBlock.length));

  if (targetCfLen < overhead + 50) {
    // Not enough headroom for any meaningful cross-field — drop it entirely.
    return join('');
  }

  const innerTarget = targetCfLen - overhead - 4; // " ..." marker
  const innerStart = '<exercise_context>\n'.length;
  const innerEnd = crossFieldBlock.length - closeTag.length;
  const inner = crossFieldBlock.slice(innerStart, innerEnd);
  const truncated = inner.slice(0, Math.max(0, innerTarget)) + ' ...';
  const trimmedCf = `<exercise_context>\n${truncated}\n</exercise_context>`;
  joined = join(trimmedCf);
  return joined;
}

const TASK_LINES: Record<ContentKind, string> = {
  description:
    'Task: write a fresh description for this exercise. Return JSON matching the schema.',
  steps:
    'Task: write fresh setup-and-execution steps for this exercise. Return JSON matching the schema.',
  tips:
    'Task: write fresh coaching cues for common form mistakes on this exercise. Return JSON matching the schema.',
  all:
    'Task: write a complete first-draft entry — description, steps, and tips — for this exercise. Return JSON matching the schema.',
};

export function buildContentPrompt({ kind, exercise }: BuildContentPromptInput): BuiltPrompt {
  const systemPrompt = VOICE[kind];
  const catalog = buildCatalogSection(exercise).join('\n');
  const crossField = buildCrossFieldBlock(kind, exercise);
  const userPrompt = softCap(catalog, crossField, TASK_LINES[kind]);
  return { systemPrompt, userPrompt, schema: schemaFor(kind) };
}

// Exported for the route's defensive post-parse validation.
export const SCHEMA_BOUNDS = {
  description: { maxLength: 280 },
  steps: { minItems: 3, maxItems: 8, itemMaxLength: 120 },
  tips: { minItems: 2, maxItems: 6, itemMaxLength: 100 },
} as const;
