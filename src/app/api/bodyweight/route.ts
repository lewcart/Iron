import { NextResponse } from 'next/server';
import { listBodyweightLogs, logBodyweight } from '@/db/queries';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '90', 10);
  const logs = await listBodyweightLogs(limit);
  return NextResponse.json(logs);
}

export async function POST(request: Request) {
  const body = await request.json();
  const weight_kg = parseFloat(body.weight_kg);
  if (!weight_kg || weight_kg <= 0) {
    return NextResponse.json({ error: 'weight_kg is required and must be positive' }, { status: 400 });
  }
  const log = await logBodyweight(weight_kg, body.note);
  return NextResponse.json(log, { status: 201 });
}
