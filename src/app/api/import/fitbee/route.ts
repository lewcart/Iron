/**
 * POST /api/import/fitbee
 *
 * multipart/form-data:
 *   - archive: ZIP containing Fitbee CSVs (food_entries.csv, water.csv, weight_entries.csv, workouts.csv)
 *   - OR food_entries, water, weight_entries, workouts: individual text/csv file parts
 */
import { createHash } from 'crypto';
import { unzipSync } from 'fflate';
import { NextRequest, NextResponse } from 'next/server';
import { importFitbeeExport } from '@/db/queries';
import { parseFitbeeExportFiles } from '@/lib/fitbee/parse';
import { requireApiKey } from '@/lib/api-auth';

const FOOD_NAMES = ['food_entries.csv', 'food_entries'];
const WATER_NAMES = ['water.csv', 'water'];
const WEIGHT_NAMES = ['weight_entries.csv', 'weight_entries'];
const WORKOUT_NAMES = ['workouts.csv', 'workouts'];

function basenameKey(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? path;
}

function pickCsv(map: Map<string, string>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const hit = map.get(c.toLowerCase());
    if (hit !== undefined) return hit;
  }
  for (const [k, v] of map) {
    if (candidates.some((c) => k.endsWith(c.toLowerCase()))) return v;
  }
  return undefined;
}

function decodeZip(buffer: ArrayBuffer): Map<string, string> {
  const out = new Map<string, string>();
  const unzipped = unzipSync(new Uint8Array(buffer));
  const decoder = new TextDecoder('utf-8');
  for (const path of Object.keys(unzipped)) {
    if (path.endsWith('/')) continue;
    const name = basenameKey(path).toLowerCase();
    out.set(name, decoder.decode(unzipped[path]!));
  }
  return out;
}

function hashText(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const fileMap = new Map<string, string>();

  const archive = form.get('archive');
  if (archive instanceof File && archive.size > 0) {
    const buf = await archive.arrayBuffer();
    const zipped = decodeZip(buf);
    for (const [k, v] of zipped) fileMap.set(k, v);
  }

  async function addPart(field: string, alt?: string) {
    const f = form.get(field) ?? (alt ? form.get(alt) : null);
    if (f instanceof File && f.size > 0) {
      const text = await f.text();
      fileMap.set(`${field.toLowerCase()}.csv`, text);
    }
  }

  await addPart('food_entries');
  await addPart('water');
  await addPart('weight_entries');
  await addPart('workouts');

  const food_entries = pickCsv(fileMap, FOOD_NAMES);
  const water = pickCsv(fileMap, WATER_NAMES);
  const weight_entries = pickCsv(fileMap, WEIGHT_NAMES);
  const workouts = pickCsv(fileMap, WORKOUT_NAMES);

  if (!food_entries && !weight_entries && !workouts && fileMap.size === 0) {
    return NextResponse.json(
      { error: 'Provide a ZIP as archive or attach at least one of food_entries, water, weight_entries, workouts' },
      { status: 400 },
    );
  }

  const parsed = parseFitbeeExportFiles({
    food_entries,
    water,
    weight_entries,
    workouts,
  });

  const file_hashes: Record<string, string> = {};
  if (food_entries) file_hashes.food_entries = hashText(food_entries);
  if (water) file_hashes.water = hashText(water);
  if (weight_entries) file_hashes.weight_entries = hashText(weight_entries);
  if (workouts) file_hashes.workouts = hashText(workouts);

  try {
    const summary = await importFitbeeExport(parsed, { file_hashes, label: 'api-upload' });
    return NextResponse.json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Import failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
