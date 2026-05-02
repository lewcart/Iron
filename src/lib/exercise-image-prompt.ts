// Prompts for AI-generated exercise demonstration images.
//
// Two-stage flow (replaces the old 2-panel composite + split):
//   1. Frame 1 (start position) — text-only prompt → openai.images.generate
//      → 1024×1536 PNG → resize to 600×800 JPEG.
//   2. Frame 2 (end position)   — text-only prompt + reference image
//      → openai.images.edit({ image: frame1AsPng }) → 1024×1536 PNG
//      → resize to 600×800 JPEG. Visual consistency comes from passing
//      frame 1 as the reference, not from prompt repetition.
//
// Both helpers return prompt strings only. The reference image for frame 2
// is passed via the `image` parameter to openai.images.edit() — see
// src/app/api/exercises/[uuid]/generate-images/route.ts.

interface ExerciseLike {
  title: string;
  description?: string | null;
  steps?: string[];
  equipment?: string[];
}

const SHARED_STYLE_NOTES = [
  'Style: clean line-art / simple anatomy-textbook illustration, black outlines on white.',
  'Femme-presenting athlete: athletic feminine physique, toned, fit, mid-20s to 30s build.',
  'Side-view, full body visible.',
  'Plain neutral light-grey background, minimal distractions.',
  'No text, no labels, no numbers in the image.',
] as const;

function commonContext(exercise: ExerciseLike): string[] {
  const equipment = (exercise.equipment ?? []).join(', ') || 'bodyweight';
  const firstSteps = (exercise.steps ?? []).slice(0, 3).join('. ');
  const desc = exercise.description?.trim() || '';
  return [
    `Equipment: ${equipment}`,
    desc ? `Movement description: ${desc}` : '',
    firstSteps ? `Key steps: ${firstSteps}` : '',
  ].filter(Boolean);
}

/** Frame 1 — start / setup / relaxation position.
 *  Generated standalone via openai.images.generate. Sets the visual
 *  vocabulary (athlete, gym, lighting, framing) that frame 2 inherits. */
export function buildExerciseImagePromptFrame1(exercise: ExerciseLike): string {
  return [
    `Exercise demonstration of "${exercise.title}".`,
    'Show the STARTING position (relaxation / setup phase) — the athlete in the resting position before the contraction begins.',
    '',
    ...SHARED_STYLE_NOTES,
    '',
    ...commonContext(exercise),
  ].filter(Boolean).join('\n');
}

/** Frame 2 — end / peak contraction / full extension position.
 *  Generated via openai.images.edit() with frame 1 as the `image` reference,
 *  so the model preserves the athlete, gym, lighting, framing from frame 1
 *  and only changes the body pose to show the end of the movement. */
export function buildExerciseImagePromptFrame2(exercise: ExerciseLike): string {
  return [
    `Same exercise demonstration of "${exercise.title}".`,
    'Show the END position (peak contraction / full extension) — the athlete at the opposite end of the movement from the reference image.',
    'Keep the SAME athlete, SAME camera angle, SAME gym setting, SAME lighting, SAME framing as the reference image. Only change the body pose to show the end of the movement.',
    '',
    ...SHARED_STYLE_NOTES,
    '',
    ...commonContext(exercise),
  ].filter(Boolean).join('\n');
}
