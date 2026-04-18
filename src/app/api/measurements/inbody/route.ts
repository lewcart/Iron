import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import {
  listInbodyScans,
  createInbodyScan,
  createMeasurementLog,
  type InbodyScanInput,
} from '@/db/queries';

const CIRC_FIELD_TO_SITE: Record<string, string> = {
  circ_neck_cm: 'neck',
  circ_chest_cm: 'chest',
  circ_abdomen_cm: 'abdomen',
  circ_hip_cm: 'hips',
  circ_right_arm_cm: 'right_bicep',
  circ_left_arm_cm: 'left_bicep',
  circ_right_thigh_cm: 'right_thigh',
  circ_left_thigh_cm: 'left_thigh',
};

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '90', 10);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const scans = await listInbodyScans({ limit, from, to });
  return NextResponse.json(scans);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (!body.scanned_at) {
    return NextResponse.json({ error: 'scanned_at is required' }, { status: 400 });
  }

  const autoInsertCircs = body.auto_insert_circumferences !== false;
  delete body.auto_insert_circumferences;

  const scan = await createInbodyScan(body as InbodyScanInput);

  // Auto-insert circumference measurements into measurement_logs, tagged so they
  // can be identified later (source='inbody_scan', source_ref=scan.uuid).
  if (autoInsertCircs) {
    for (const [field, site] of Object.entries(CIRC_FIELD_TO_SITE)) {
      const val = (scan as unknown as Record<string, number | null>)[field];
      if (val != null && Number.isFinite(val)) {
        await createMeasurementLog({
          site,
          value_cm: val,
          notes: `Auto-logged from InBody scan`,
          measured_at: scan.scanned_at,
          source: 'inbody_scan',
          source_ref: scan.uuid,
        });
      }
    }
  }

  return NextResponse.json(scan, { status: 201 });
}
