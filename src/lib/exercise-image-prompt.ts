// Prompt template for AI-generating exercise demonstration images.
//
// Strategy: one 2-panel composite image (1024×1536 portrait, 2 phases stacked
// vertically, each panel ≈1024×768). Splitting after generation gives us
// frame-to-frame consistency — same person, same gym, same lighting — that
// independent generations would miss.
//
// Why 2 panels (not 3): gpt-image-1 doesn't place 3 evenly-spaced boundaries
// reliably; a fixed 33%/66% split mid-cuts content. The 50% split for 2
// panels lands cleanly. This also matches the everkinetic-data
// relaxation/tension paradigm used for the bundled catalog.
//
// The split helper at src/lib/split-vertical-panels.ts produces two
// 1024×768 buffers, then resizes each to 600×800 portrait JPEG q75.

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
    `Two-panel exercise demonstration showing the "${exercise.title}" exercise.`,
    'Render as ONE single PORTRAIT image with two panels STACKED VERTICALLY (one above the other), each panel showing a different phase:',
    '  Top panel: Starting position (relaxation / setup)',
    '  Bottom panel: End position (peak contraction / full extension)',
    '',
    'Strict constraints — these must be identical across both panels:',
    '- Same femme-presenting athlete in both panels (athletic feminine physique, toned, fit, mid-20s to 30s build)',
    '- Same gym setting and lighting in both panels',
    '- Same camera angle (side-view, full body visible)',
    '- Plain neutral light-grey background, minimal distractions',
    `- Equipment: ${equipment}`,
    '- Style: clean line-art / simple anatomy-textbook illustration, black outlines on white',
    '- Each panel separated by a thin horizontal line at the exact vertical midpoint',
    '- No text, no labels, no numbers in the image',
    '',
    desc ? `Movement description: ${desc}` : '',
    firstSteps ? `Key steps: ${firstSteps}` : '',
  ].filter(Boolean).join('\n');
}
