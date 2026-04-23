/**
 * POST /api/sync — re-import every pipeline artifact into the local DB.
 * Idempotent. Returns the counts so a future scheduler hook can log them.
 */
import { NextResponse } from 'next/server';
import { initDb } from '../../../db/init';
import { syncAllArtifacts } from '../../../lib/sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  try {
    initDb();
    const result = syncAllArtifacts();
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    note: 'POST to this endpoint to trigger a full sync. GET is a health check.',
  });
}
