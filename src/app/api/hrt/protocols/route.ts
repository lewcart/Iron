import { NextRequest, NextResponse } from 'next/server';
import { listHrtProtocols, createHrtProtocol } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const protocols = await listHrtProtocols();
  return NextResponse.json(protocols);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (!body.medication || !body.dose_description || !body.form || !body.started_at) {
    return NextResponse.json(
      { error: 'medication, dose_description, form, and started_at are required' },
      { status: 400 },
    );
  }
  const protocol = await createHrtProtocol({
    medication: body.medication,
    dose_description: body.dose_description,
    form: body.form,
    started_at: body.started_at,
    ended_at: body.ended_at ?? null,
    includes_blocker: body.includes_blocker ?? false,
    blocker_name: body.blocker_name ?? null,
    notes: body.notes ?? null,
  });
  return NextResponse.json(protocol, { status: 201 });
}
