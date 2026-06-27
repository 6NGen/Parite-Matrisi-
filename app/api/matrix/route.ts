// Matris API uç noktası. Tüm veri çekme ve hesap sunucu tarafında yapılır;
// API anahtarları istemciye düşmez (§13).

import { NextRequest, NextResponse } from 'next/server';
import { buildMatrix } from '@/lib/matrix';
import type { MatrixSelection, Timeframe } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseTimeframe(v: string | null): Timeframe {
  return v === 'weekly' ? 'weekly' : 'daily';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const timeframe = parseTimeframe(req.nextUrl.searchParams.get('timeframe'));
  try {
    const data = await buildMatrix([], timeframe);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Matris üretilemedi' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { timeframe?: string; selections?: MatrixSelection[] } = {};
  try {
    body = await req.json();
  } catch {
    // boş gövde → varsayılan
  }
  const timeframe = parseTimeframe(body.timeframe ?? null);
  const selections = Array.isArray(body.selections) ? body.selections : [];
  try {
    const data = await buildMatrix(selections, timeframe);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Matris üretilemedi' },
      { status: 500 }
    );
  }
}
