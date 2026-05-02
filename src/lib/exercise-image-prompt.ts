// Prompts for AI-generated exercise demonstration images.
//
// Two-stage flow (replaces the old 2-panel composite + split):
//   1. Frame 1 (start position) — text-only prompt → openai.images.generate
//      → 1024×1536 PNG → resize to 600×800 JPEG.
//      OR, when a user-uploaded reference is attached, the route uses
//      openai.images.edit({ image: ref }) for frame 1 instead, seeding
//      the pair from the reference.
//   2. Frame 2 (end position)   — text-only prompt + reference image
//      → openai.images.edit({ image: frame1AsPng }) → 1024×1536 PNG
//      → resize to 600×800 JPEG. Visual consistency comes from passing
//      frame 1 as the reference, not from prompt repetition.
//
// Both helpers return prompt strings only. The reference image for frame 2
// (and optionally for frame 1) is passed via the `image` parameter to
// openai.images.edit() — see src/app/api/exercises/[uuid]/generate-images/route.ts.
//
// Optional `notes` is free-form user guidance from the manager sheet,
// validated to ≤280 chars by the route. Threaded into BOTH frame prompts
// so the model sees the correction whether it's painting frame 1 from
// scratch or chaining frame 2 off frame 1.

interface ExerciseLike {
  title: string;
  description?: string | null;
  steps?: string[];
  tips?: string[];
  equipment?: string[];
}

interface PromptOptions {
  /** Free-form user guidance from the manager sheet. ≤280 chars (route-validated). */
  notes?: string | null;
}

const SHARED_STYLE_NOTES = [
  'Style: clean line-art / simple anatomy-textbook illustration, black outlines on white.',
  'Femme-presenting athlete: athletic feminine physique, toned, fit, mid-20s to 30s build.',
  'Side-view, full body visible.',
  'Plain neutral light-grey background, minimal distractions.',
  'No text, no labels, no numbers in the image.',
] as const;

/** Soft cap on the total prompt size. gpt-image-1 doesn't strictly enforce
 *  but very long prompts trade marginal signal for marginal latency. Keeps
 *  catalog steps + tips from blowing the budget on outlier exercises. */
const PROMPT_SOFT_CAP_CHARS = 2000;

function commonContext(exercise: ExerciseLike): string[] {
  const equipment = (exercise.equipment ?? []).join(', ') || 'bodyweight';
  // Use ALL steps, not just the first 3 — more signal helps the model render
  // the right pose / equipment grip / setup. Period-joined to read as a
  // single instruction string rather than a list.
  const allSteps = (exercise.steps ?? []).map(s => s.trim()).filter(Boolean).join('. ');
  // Tips are form-correctness hints ("back flat", "elbows tucked"). Until
  // now they were invisible to the model — surfacing them gives the same
  // hints to the image gen that we'd give to a real athlete.
  const allTips = (exercise.tips ?? []).map(t => t.trim()).filter(Boolean).join('. ');
  const desc = exercise.description?.trim() || '';
  return [
    `Equipment: ${equipment}`,
    desc       ? `Movement description: ${desc}`        : '',
    allSteps   ? `Steps: ${allSteps}`                   : '',
    allTips    ? `Things to watch for: ${allTips}`      : '',
  ].filter(Boolean);
}

/** Apply the soft size cap. Truncate the longest catalog field first
 *  (steps then tips) before touching the user's notes — user's correction
 *  is the most valuable signal, never trim it. Returns the joined prompt. */
function softCap(parts: string[]): string {
  let joined = parts.join('\n');
  if (joined.length <= PROMPT_SOFT_CAP_CHARS) return joined;
  // Find the longest line that starts with "Steps:" or "Things to watch for:"
  // and trim it down. Order: trim Steps first, then Tips.
  for (const prefix of ['Steps: ', 'Things to watch for: ']) {
    const idx = parts.findIndex(p => p.startsWith(prefix));
    if (idx === -1) continue;
    const overflow = joined.length - PROMPT_SOFT_CAP_CHARS;
    if (overflow <= 0) break;
    const line = parts[idx];
    if (line.length <= prefix.length + 50) continue; // can't usefully trim
    parts[idx] = line.slice(0, line.length - overflow - 3) + '...';
    joined = parts.join('\n');
    if (joined.length <= PROMPT_SOFT_CAP_CHARS) break;
  }
  return joined;
}

function notesLine(notes: string | null | undefined): string {
  const trimmed = notes?.trim();
  if (!trimmed) return '';
  // Phrased as user-authoritative so the model treats it as a correction
  // over the catalog defaults, not as a hint that competes with them.
  return `Additional guidance from the user: ${trimmed}`;
}

/** Frame 1 — start / setup / relaxation position.
 *  Generated standalone via openai.images.generate (or via images.edit when
 *  a user reference is attached). Sets the visual vocabulary (athlete, gym,
 *  lighting, framing) that frame 2 inherits. */
export function buildExerciseImagePromptFrame1(
  exercise: ExerciseLike,
  options: PromptOptions = {},
): string {
  const parts = [
    `Exercise demonstration of "${exercise.title}".`,
    'Show the STARTING position (relaxation / setup phase) — the athlete in the resting position before the contraction begins.',
    '',
    ...SHARED_STYLE_NOTES,
    '',
    ...commonContext(exercise),
    notesLine(options.notes),
  ].filter(Boolean);
  return softCap(parts);
}

/** Frame 2 — end / peak contraction / full extension position.
 *  Generated via openai.images.edit() with frame 1 as the `image` reference,
 *  so the model preserves the athlete, gym, lighting, framing from frame 1
 *  and only changes the body pose to show the end of the movement. */
export function buildExerciseImagePromptFrame2(
  exercise: ExerciseLike,
  options: PromptOptions = {},
): string {
  const parts = [
    `Same exercise demonstration of "${exercise.title}".`,
    'Show the END position (peak contraction / full extension) — the athlete at the opposite end of the movement from the reference image.',
    'Keep the SAME athlete, SAME camera angle, SAME gym setting, SAME lighting, SAME framing as the reference image. Only change the body pose to show the end of the movement.',
    '',
    ...SHARED_STYLE_NOTES,
    '',
    ...commonContext(exercise),
    notesLine(options.notes),
  ].filter(Boolean);
  return softCap(parts);
}
