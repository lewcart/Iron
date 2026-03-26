import { randomUUID } from 'crypto';
import { query, queryOne } from './db';
import type { FitbeeImportSummary, MealType } from '../types';
import { activityDedupeKey, fitbeeAggregateExternalRef, foodEntryDedupeKey, weightDedupeKey } from '../lib/fitbee/dedupe';
import type { ParsedFitbeeFiles } from '../lib/fitbee/parse';

async function upsertDayHydration(date: string, hydration_ml: number): Promise<void> {
  const uuid = randomUUID();
  await query(
    `INSERT INTO nutrition_day_notes (uuid, date, hydration_ml, notes, updated_at)
     VALUES ($1, $2, $3, NULL, NOW())
     ON CONFLICT (date) DO UPDATE SET
       hydration_ml = EXCLUDED.hydration_ml,
       updated_at = NOW()`,
    [uuid, date, hydration_ml],
  );
}

export async function importFitbeeExport(
  parsed: ParsedFitbeeFiles,
  options: { file_hashes?: Record<string, string>; label?: string } = {},
): Promise<FitbeeImportSummary> {
  const warnings = [
    ...parsed.food.warnings,
    ...parsed.water.warnings,
    ...parsed.weight.warnings,
    ...parsed.activity.warnings,
  ];

  const batchUuid = randomUUID();
  await query(
    `INSERT INTO fitbee_import_batches (uuid, label, file_hashes) VALUES ($1, $2, $3::jsonb)`,
    [batchUuid, options.label ?? null, JSON.stringify(options.file_hashes ?? {})],
  );

  let food_entries_inserted = 0;
  let food_entries_skipped_duplicates = 0;

  const foodRows = parsed.food.rows;
  if (foodRows.length > 0) {
    const chunkSize = 400;
    for (let offset = 0; offset < foodRows.length; offset += chunkSize) {
      const chunk = foodRows.slice(offset, offset + chunkSize);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const row of chunk) {
        const dedupe = foodEntryDedupeKey(row);
        placeholders.push(
          `($${p++},$${p++}::timestamptz,$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb,$${p++},$${p++},$${p++})`,
        );
        values.push(
          randomUUID(),
          row.logged_at_iso,
          row.day_local,
          row.meal_type,
          row.food_name,
          row.calories,
          row.protein_g,
          row.carbs_g,
          row.fat_g,
          JSON.stringify(row.nutrients),
          'fitbee',
          batchUuid,
          dedupe,
        );
      }
      const inserted = await query<{ uuid: string }>(
        `INSERT INTO nutrition_food_entries (uuid, logged_at, day_local, meal_type, food_name, calories, protein_g, carbs_g, fat_g, nutrients, source, import_batch_uuid, dedupe_key)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING uuid`,
        values,
      );
      food_entries_inserted += inserted.length;
    }
    food_entries_skipped_duplicates = foodRows.length - food_entries_inserted;
  }

  const affectedDays = [...new Set(foodRows.map((r) => r.day_local))];
  let nutrition_aggregates_upserted = 0;
  if (affectedDays.length > 0) {
    const groups = await query<{
      day_local: string;
      meal_type: string;
      cals: string;
      prot: string;
      carb: string;
      fat: string;
      n: string;
    }>(
      `SELECT day_local, meal_type,
        COALESCE(SUM(calories), 0)::text AS cals,
        COALESCE(SUM(protein_g), 0)::text AS prot,
        COALESCE(SUM(carbs_g), 0)::text AS carb,
        COALESCE(SUM(fat_g), 0)::text AS fat,
        COUNT(*)::text AS n
       FROM nutrition_food_entries
       WHERE day_local = ANY($1::text[])
       GROUP BY day_local, meal_type`,
      [affectedDays],
    );

    for (const g of groups) {
      const external_ref = fitbeeAggregateExternalRef(g.day_local, g.meal_type);
      const n = parseInt(g.n, 10);
      const meal_name = `Fitbee · ${g.meal_type} · ${n} item${n === 1 ? '' : 's'}`;
      const notes = `#fitbee-aggregate batch=${batchUuid} items=${n}`;
      const loggedAt = `${g.day_local}T12:00:00.000Z`;

      await query(
        `INSERT INTO nutrition_logs (uuid, logged_at, meal_type, calories, protein_g, carbs_g, fat_g, notes, meal_name, template_meal_id, status, external_ref)
         VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, NULL, 'added', $10)
         ON CONFLICT (external_ref) DO UPDATE SET
           logged_at = EXCLUDED.logged_at,
           meal_type = EXCLUDED.meal_type,
           calories = EXCLUDED.calories,
           protein_g = EXCLUDED.protein_g,
           carbs_g = EXCLUDED.carbs_g,
           fat_g = EXCLUDED.fat_g,
           notes = EXCLUDED.notes,
           meal_name = EXCLUDED.meal_name,
           status = EXCLUDED.status`,
        [
          randomUUID(),
          loggedAt,
          g.meal_type as MealType,
          parseFloat(g.cals) || null,
          parseFloat(g.prot) || null,
          parseFloat(g.carb) || null,
          parseFloat(g.fat) || null,
          notes,
          meal_name,
          external_ref,
        ],
      );
      nutrition_aggregates_upserted++;
    }
  }

  const waterByDate = new Map<string, number>();
  for (const w of parsed.water.rows) {
    waterByDate.set(w.date, (waterByDate.get(w.date) ?? 0) + w.ml);
  }
  let water_days_updated = 0;
  for (const [date, ml] of waterByDate) {
    await upsertDayHydration(date, Math.round(ml));
    water_days_updated++;
  }

  let weights_inserted = 0;
  let weights_skipped_duplicates = 0;
  for (const w of parsed.weight.rows) {
    const dk = weightDedupeKey(w);
    const row = await queryOne<{ uuid: string }>(
      `INSERT INTO bodyweight_logs (uuid, weight_kg, note, logged_at, dedupe_key)
       VALUES ($1, $2, $3, $4::timestamptz, $5)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING uuid`,
      [randomUUID(), w.weight_kg, w.note, w.logged_at_iso, dk],
    );
    if (row) weights_inserted++;
    else weights_skipped_duplicates++;
  }

  let activities_inserted = 0;
  let activities_skipped_duplicates = 0;
  const actRows = parsed.activity.rows;
  if (actRows.length > 0) {
    const chunkSize = 500;
    for (let offset = 0; offset < actRows.length; offset += chunkSize) {
      const chunk = actRows.slice(offset, offset + chunkSize);
      const values: unknown[] = [];
      const ph: string[] = [];
      let p = 1;
      for (const row of chunk) {
        const dk = activityDedupeKey(row);
        ph.push(`($${p++},$${p++}::timestamptz,$${p++},$${p++},$${p++},$${p++})`);
        values.push(randomUUID(), row.logged_at_iso, row.activity_name, row.calories_burned, 'fitbee', dk);
      }
      const ins = await query<{ uuid: string }>(
        `INSERT INTO activity_logs (uuid, logged_at, activity_name, calories_burned, source, dedupe_key)
         VALUES ${ph.join(',')}
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING uuid`,
        values,
      );
      activities_inserted += ins.length;
    }
    activities_skipped_duplicates = actRows.length - activities_inserted;
  }

  return {
    batch_uuid: batchUuid,
    food_entries_inserted,
    food_entries_skipped_duplicates,
    nutrition_aggregates_upserted,
    water_days_updated,
    weights_inserted,
    weights_skipped_duplicates,
    activities_inserted,
    activities_skipped_duplicates,
    warnings,
  };
}
