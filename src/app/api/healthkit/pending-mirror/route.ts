/**
 * Returns nutrition_logs and inbody_scans that haven't been mirrored to HealthKit
 * yet — either never written, or edited since last writeback. Client picks these
 * up during foreground sync and calls native saveNutrition / saveBodyComposition.
 *
 * "Needs mirror" = (no writeback row for source_uuid) OR (max writeback.written_at
 * < source.updated_at for the source row).
 *
 * Scope: last 30 days of nutrition_logs + all inbody_scans (they're sparse; <100
 * rows total). Keeps initial mirror bounded.
 */

import { NextResponse } from 'next/server';
import { query } from '@/db/db';

interface NutritionMirrorRow {
  uuid: string;
  logged_at: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  hydration_ml: number | null;
}

interface InbodyMirrorRow {
  uuid: string;
  scanned_at: string;
  weight_kg: number | null;
  pbf_pct: number | null;
  smm_kg: number | null;   // skeletal muscle mass ≈ usable proxy for "lean mass" input
}

export async function GET() {
  const nutrition = await query<NutritionMirrorRow>(
    `SELECT n.uuid,
            to_char(n.logged_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS logged_at,
            n.calories,
            n.protein_g,
            n.carbs_g,
            n.fat_g,
            NULL::numeric AS hydration_ml
     FROM nutrition_logs n
     LEFT JOIN (
       SELECT source_uuid, MAX(written_at) AS last_written
       FROM healthkit_writeback
       WHERE source_kind = 'meal'
       GROUP BY source_uuid
     ) w ON w.source_uuid = n.uuid
     WHERE n.logged_at >= NOW() - interval '30 days'
       AND (w.last_written IS NULL
            OR w.last_written < n.logged_at)
       -- Only rows with at least one macro to mirror
       AND (n.calories IS NOT NULL
            OR n.protein_g IS NOT NULL
            OR n.carbs_g IS NOT NULL
            OR n.fat_g IS NOT NULL)
     ORDER BY n.logged_at DESC
     LIMIT 200`
  );

  const inbody = await query<InbodyMirrorRow>(
    `SELECT i.uuid,
            to_char(i.scanned_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS scanned_at,
            i.weight_kg,
            i.pbf_pct,
            i.smm_kg
     FROM inbody_scans i
     LEFT JOIN (
       SELECT source_uuid, MAX(written_at) AS last_written
       FROM healthkit_writeback
       WHERE source_kind = 'inbody'
       GROUP BY source_uuid
     ) w ON w.source_uuid = i.uuid
     WHERE w.last_written IS NULL
        OR w.last_written < i.updated_at
     ORDER BY i.scanned_at DESC`
  );

  return NextResponse.json({ nutrition, inbody });
}
