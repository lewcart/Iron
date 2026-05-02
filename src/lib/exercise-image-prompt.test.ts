import { describe, it, expect } from 'vitest';
import {
  buildExerciseImagePromptFrame1,
  buildExerciseImagePromptFrame2,
} from './exercise-image-prompt';

const baseExercise = {
  title: 'Push Up',
  description: 'A foundational chest, triceps, and shoulder pushing movement.',
  steps: [
    'Begin in a high plank position with hands shoulder-width apart.',
    'Engage the core and keep the body in a straight line from head to heels.',
    'Lower the chest toward the floor by bending the elbows back at about 45 degrees.',
    'Stop just before the chest touches the floor.',
    'Press back up to the starting position by extending the arms.',
  ],
  tips: [
    'Keep the core tight throughout — no sagging hips.',
    'Elbows should track at ~45° from the torso, not flared out to 90°.',
    'Look slightly ahead, not straight down, to keep the neck neutral.',
  ],
  equipment: ['bodyweight'],
};

describe('buildExerciseImagePromptFrame1', () => {
  it('includes ALL steps (not just the first 3)', () => {
    const prompt = buildExerciseImagePromptFrame1(baseExercise);
    // 4th and 5th steps are present
    expect(prompt).toContain('Stop just before the chest touches the floor');
    expect(prompt).toContain('Press back up to the starting position');
  });

  it('includes tips when present, prefixed "Things to watch for"', () => {
    const prompt = buildExerciseImagePromptFrame1(baseExercise);
    expect(prompt).toContain('Things to watch for: ');
    expect(prompt).toContain('no sagging hips');
    expect(prompt).toContain('not flared out to 90');
    expect(prompt).toContain('keep the neck neutral');
  });

  it('omits tips line when tips empty/absent', () => {
    const prompt = buildExerciseImagePromptFrame1({ ...baseExercise, tips: [] });
    expect(prompt).not.toContain('Things to watch for');
  });

  it('omits steps line when steps empty/absent', () => {
    const prompt = buildExerciseImagePromptFrame1({ ...baseExercise, steps: [] });
    expect(prompt).not.toContain('Steps:');
  });

  it('appends notes as user-authoritative correction when provided', () => {
    const prompt = buildExerciseImagePromptFrame1(baseExercise, {
      notes: 'Use a barbell, not dumbbells. Wider stance.',
    });
    expect(prompt).toContain('Additional guidance from the user: Use a barbell, not dumbbells. Wider stance.');
  });

  it('omits notes line when notes empty/whitespace/null', () => {
    expect(buildExerciseImagePromptFrame1(baseExercise, { notes: '' }))
      .not.toContain('Additional guidance from the user');
    expect(buildExerciseImagePromptFrame1(baseExercise, { notes: '   \n  ' }))
      .not.toContain('Additional guidance from the user');
    expect(buildExerciseImagePromptFrame1(baseExercise, { notes: null }))
      .not.toContain('Additional guidance from the user');
    expect(buildExerciseImagePromptFrame1(baseExercise))
      .not.toContain('Additional guidance from the user');
  });

  it('still names the exercise + STARTING position cue', () => {
    const prompt = buildExerciseImagePromptFrame1(baseExercise);
    expect(prompt).toContain('"Push Up"');
    expect(prompt).toContain('STARTING position');
  });

  it('keeps equipment line', () => {
    const prompt = buildExerciseImagePromptFrame1(baseExercise);
    expect(prompt).toContain('Equipment: bodyweight');
  });

  it('soft-caps very long prompts at ~2000 chars', () => {
    // Synthesize an exercise with absurdly long step list to force truncation.
    const huge = {
      ...baseExercise,
      steps: Array.from({ length: 50 }, (_, i) => `Step ${i + 1}: do an extended thing with many descriptive words to bloat the prompt.`),
    };
    const prompt = buildExerciseImagePromptFrame1(huge);
    expect(prompt.length).toBeLessThanOrEqual(2010);  // soft cap with small slack
  });

  it('soft-cap NEVER trims user notes', () => {
    const huge = {
      ...baseExercise,
      steps: Array.from({ length: 50 }, (_, i) => `Step ${i + 1}: many descriptive words.`),
    };
    const notes = 'IMPORTANT: render with a barbell, not dumbbells. The model keeps drawing dumbbells.';
    const prompt = buildExerciseImagePromptFrame1(huge, { notes });
    expect(prompt).toContain(notes);
  });
});

describe('buildExerciseImagePromptFrame2', () => {
  it('shows END position cue + reference-image instruction', () => {
    const prompt = buildExerciseImagePromptFrame2(baseExercise);
    expect(prompt).toContain('END position');
    expect(prompt).toContain('reference image');
    expect(prompt).toContain('SAME athlete');
  });

  it('also threads notes through (so the correction applies on both panels)', () => {
    const prompt = buildExerciseImagePromptFrame2(baseExercise, {
      notes: 'Use a barbell, not dumbbells.',
    });
    expect(prompt).toContain('Additional guidance from the user: Use a barbell, not dumbbells.');
  });

  it('also includes ALL steps + tips', () => {
    const prompt = buildExerciseImagePromptFrame2(baseExercise);
    expect(prompt).toContain('Press back up');
    expect(prompt).toContain('Things to watch for: ');
  });
});

describe('common — equipment fallback', () => {
  it('falls back to "bodyweight" when equipment is empty/missing', () => {
    expect(buildExerciseImagePromptFrame1({ ...baseExercise, equipment: [] }))
      .toContain('Equipment: bodyweight');
    expect(buildExerciseImagePromptFrame1({ ...baseExercise, equipment: undefined }))
      .toContain('Equipment: bodyweight');
  });
});
