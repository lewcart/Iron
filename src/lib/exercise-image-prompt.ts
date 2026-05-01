// Prompt template for AI-generating exercise demonstration images.
//
// Strategy: one 3-panel composite image (1024×1536 portrait, 3 phases stacked
// vertically, each panel 1024×512). Splitting after generation gives us
// frame-to-frame consistency — same person, same gym, same lighting — that
// independent generations would miss.
//
// The split helper at scripts/lib/split-three-panel.ts produces three
// 1024×512 buffers, then resizes each to 600×800 portrait JPEG q75.
// (See plan: aspect ratio standardized at 600×800.)

interface ExerciseLike {
  title: string;
  description?: string | null;
  steps?: string[];
  equipment?: string[];
}

export function buildExerciseImagePrompt(exercise: ExerciseLike): string {
  const equipment = (exercise.equipment ?? []).join(', ') || 'bodyweight';
  const firstSteps = (exercise.steps ?? []).slice(0, 3).join('. ');
  const desc = exercise.description?.trim() || '';

  return [
    `Three-panel exercise demonstration showing the "${exercise.title}" exercise.`,
    'Render as ONE single PORTRAIT image with three panels STACKED VERTICALLY (one above the other), each panel showing a different phase:',
    '  Top panel: Starting position',
    '  Middle panel: Mid-movement (peak contraction or transition)',
    '  Bottom panel: End position',
    '',
    'Strict constraints — these must be identical across all three panels:',
    '- Same gender-neutral athlete in all three panels',
    '- Same gym setting and lighting in all three panels',
    '- Same camera angle (side-view, full body visible)',
    '- Plain neutral light-grey background, minimal distractions',
    `- Equipment: ${equipment}`,
    '- Style: clean line-art / simple anatomy-textbook illustration',
    '- Each panel clearly delineated by a thin horizontal line',
    '- No text, no labels, no numbers in the image',
    '',
    desc ? `Movement description: ${desc}` : '',
    firstSteps ? `Key steps: ${firstSteps}` : '',
  ].filter(Boolean).join('\n');
}
