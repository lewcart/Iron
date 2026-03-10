// Core data types for Iron workout tracker

export interface Exercise {
  uuid: string;
  everkinetic_id: number;
  title: string;
  alias: string[]; // JSON array
  description: string | null;
  primary_muscles: string[]; // JSON array
  secondary_muscles: string[]; // JSON array
  equipment: string[]; // JSON array
  steps: string[]; // JSON array
  tips: string[]; // JSON array
  is_custom: boolean;
  is_hidden: boolean;
}

export interface Workout {
  uuid: string;
  start_time: string; // ISO date string
  end_time: string | null;
  title: string | null;
  comment: string | null;
  is_current: boolean;
}

export interface WorkoutExercise {
  uuid: string;
  workout_uuid: string;
  exercise_uuid: string;
  comment: string | null;
  order_index: number;
}

export interface WorkoutSet {
  uuid: string;
  workout_exercise_uuid: string;
  weight: number | null;
  repetitions: number | null;
  min_target_reps: number | null;
  max_target_reps: number | null;
  rpe: number | null; // 7.0-10.0 by 0.5
  tag: 'dropSet' | 'failure' | null;
  comment: string | null;
  is_completed: boolean;
  order_index: number;
}

export interface WorkoutPlan {
  uuid: string;
  title: string | null;
}

export interface WorkoutRoutine {
  uuid: string;
  workout_plan_uuid: string;
  title: string | null;
  comment: string | null;
  order_index: number;
}

export interface WorkoutRoutineExercise {
  uuid: string;
  workout_routine_uuid: string;
  exercise_uuid: string;
  comment: string | null;
  order_index: number;
}

export interface WorkoutRoutineSet {
  uuid: string;
  workout_routine_exercise_uuid: string;
  min_repetitions: number | null;
  max_repetitions: number | null;
  tag: 'dropSet' | null;
  comment: string | null;
  order_index: number;
}

// Helper types
export type MuscleGroup = 'abdominals' | 'arms' | 'back' | 'chest' | 'legs' | 'shoulders';
export type RPEValue = 7.0 | 7.5 | 8.0 | 8.5 | 9.0 | 9.5 | 10.0;
export type SetTag = 'dropSet' | 'failure';

// Computed data types
export interface WorkoutWithStats extends Workout {
  duration_minutes: number | null;
  total_sets: number;
  completed_sets: number;
  total_weight: number;
  muscle_groups: string[];
}

export interface ExerciseHistory {
  exercise: Exercise;
  workouts: {
    workout_uuid: string;
    workout_date: string;
    sets: WorkoutSet[];
  }[];
}

export interface PersonalRecord {
  exercise_uuid: string;
  weight: number;
  repetitions: number;
  estimated_1rm: number;
  date: string;
  workout_uuid: string;
}
