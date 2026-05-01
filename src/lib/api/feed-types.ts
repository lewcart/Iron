/** Client-safe shapes for `/api/feed` and feed queries (no server imports). */

export type TimelineModule =
  | 'workout'
  | 'nutrition'
  | 'hrt'
  | 'measurement'
  | 'wellbeing'
  | 'photo'
  | 'bodyweight'
  | 'body_spec'
  | 'inbody_scan'
  | 'dysphoria';

export interface TimelineEntry {
  id: string;
  module: TimelineModule;
  icon: string;
  timestamp: string;
  summary: string;
}

export interface StatsData {
  activeDays: string[];
  weeklyData: { week: string; count: number }[];
}

export interface SummaryData {
  weekWorkouts: number;
  weekVolume: number;
  currentStreak: number;
  lastWorkouts: {
    uuid: string;
    start_time: string;
    end_time: string | null;
    title: string | null;
    exercises: string[];
    volume: number;
  }[];
  /** @deprecated Use setsByMuscle for the canonical sets-per-muscle metric. */
  muscleFrequency: Record<string, number>;
  /**
   * Per-muscle weekly set counts using canonical taxonomy (migration 026).
   * Always returns every canonical muscle in display_order so the UI can
   * render a stable grid. coverage='none' means no exercise in the catalog
   * tags this muscle yet — UI should collapse those into a footer.
   */
  setsByMuscle: SetsByMuscleRow[];
}

export interface SetsByMuscleRow {
  slug: string;
  display_name: string;
  parent_group: string;
  set_count: number;
  /** RIR-weighted hypertrophy sets. RIR 0–3 = 1.0, RIR 4 = 0.5, RIR 5+ = 0.0,
   *  NULL = 1.0 (charitable default until RIR data exists). UI surfaces a
   *  junk-set warning when effective_set_count / set_count < 0.6 AND most
   *  sets in the muscle's week have RIR logged. */
  effective_set_count: number;
  optimal_min: number;
  optimal_max: number;
  display_order: number;
  status: 'zero' | 'under' | 'optimal' | 'over';
  coverage: 'none' | 'tagged';
  kg_volume: number;
}

export interface FeedBundle {
  stats: StatsData;
  summary: SummaryData;
  timeline: TimelineEntry[];
}
