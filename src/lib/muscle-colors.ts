const MUSCLE_COLORS: Record<string, string> = {
  chest: '#3b82f6',
  back: '#f97316',
  shoulders: '#a855f7',
  arms: '#ec4899',
  legs: '#10b981',
  abdominals: '#f59e0b',
  default: '#6b7280',
};

export function getMuscleColor(muscles: string[]): string {
  for (const m of muscles) {
    const key = m.toLowerCase();
    for (const [k, v] of Object.entries(MUSCLE_COLORS)) {
      if (key.includes(k)) return v;
    }
  }
  return MUSCLE_COLORS.default;
}
