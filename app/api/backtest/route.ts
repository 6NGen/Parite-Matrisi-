// Backtest uç noktası (GÖREV 3). Bir enstrümanın sinyal kovalarının ileri rölatif
// getiriyle ilişkisini point-in-time hesaplayıp JSON metrik tablosu döndürür.
// Örnek: /api/backtest?symbol=AKFYE&timeframe=daily

import { NextRequest, NextResponse } from 'next/server';
import { runBacktest } from '@/lib/backtest';
import type { Timeframe } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const symbol = req.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  const timeframe: Timeframe =
    req.nextUrl.searchParams.get('timeframe') === 'weekly' ? 'weekly' : 'daily';
  if (!symbol) {
    return NextResponse.json({ error: 'symbol parametresi gerekli' }, { status: 400 });
  }
  try {
    const result = await runBacktest(symbol, timeframe);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Backtest başarısız' },
      { status: 500 }
    );
  }
}
