// Shared client-safe types for the nutrition API surfaces.
//
// These live outside src/app/api so the Capacitor build (which moves
// src/app/api out of the build tree before `next build`) can still type-import
// them from client pages and lib helpers. The route files re-export from here.

export interface HistoryDay {
  date: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  log_count: number;
  approved_status: 'pending' | 'approved';
}

export interface SummaryDay {
  date: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  hit_count: number;
  target_count: number;
  has_data: boolean;
  approved_status: 'pending' | 'approved';
}

export interface FoodResult {
  source: 'local' | 'off' | 'usda';
  food_name: string;
  serving_size: { qty: number; unit: string } | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  nutrients: Record<string, unknown> | null;
  external_id: string | null;
  meta: { times_logged?: number; last_logged_at?: string } | null;
}
