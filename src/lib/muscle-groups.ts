/**
 * Maps UI muscle areas (Exercises tab) to substrings that appear in Iron / DB
 * primary_muscles and secondary_muscles JSON (anatomical names).
 */
const MUSCLE_GROUP_TERMS: Record<string, readonly string[]> = {
  chest: ['pectoralis', 'chest', 'serratus'],
  back: [
    'latissimus',
    'rhomboid',
    'erector',
    'trapezius',
    'infraspinatus',
    'supraspinatus',
    'subscapularis',
    'teres major',
    'teres minor',
    'middle back',
    'lower back',
    'upper back',
    'lats',
  ],
  shoulders: ['deltoid', 'shoulder'],
  arms: ['biceps', 'triceps', 'brachialis', 'brachii', 'forearm', 'brachioradialis'],
  legs: [
    'quadriceps',
    'hamstring',
    'hamstrings',
    'glute',
    'glutes',
    'gastrocnemius',
    'soleus',
    'adductor',
    'abductor',
    'tibialis',
    'vastus',
    'rectus femoris',
    'sartorius',
    'gracilis',
    'popliteus',
    'calves',
    'calf',
  ],
  abdominals: [
    'rectus abdominis',
    'abdominis',
    'oblique',
    'transverse abdominis',
    'intercostal',
    'abs',
    'abdominal',
    'core',
  ],
};

export function muscleGroupSearchTerms(groupKey: string): string[] {
  const terms = MUSCLE_GROUP_TERMS[groupKey.toLowerCase()];
  return terms ? [...terms] : [];
}

/** Client-side: does this exercise belong under the given area filter? */
export function exerciseMatchesMuscleGroup(
  primaryMuscles: string[],
  secondaryMuscles: string[],
  groupKey: string
): boolean {
  const terms = muscleGroupSearchTerms(groupKey);
  if (terms.length === 0) return false;
  const blob = [...primaryMuscles, ...secondaryMuscles].join(' ').toLowerCase();
  return terms.some((t) => blob.includes(t.toLowerCase()));
}
