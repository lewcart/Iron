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
  muscleFrequency: Record<string, number>;
}

export interface FeedBundle {
  stats: StatsData;
  summary: SummaryData;
  timeline: TimelineEntry[];
}
