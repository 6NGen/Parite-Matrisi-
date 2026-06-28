// Teşhis uç noktası: Türkiye 10Y için aday kaynakları CANLI sunucudan (Vercel)
// dener ve her birinin sonucunu döndürür. Böylece "sembol mü yanlış, kaynak mı
// Vercel'i blokluyor" sorusu kesin yanıtlanır. Gizli bilgi sızdırmaz.

import { NextResponse } from 'next/server';
import { fetchStooq } from '@/lib/sources/stooq';
import { fetchFred } from '@/lib/sources/fred';
import type { Candle } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Probe {
  source: 'stooq' | 'fred';
  symbol: string;
}

const PROBES: Probe[] = [
  { source: 'stooq', symbol: '10try.b' },
  { source: 'stooq', symbol: '10tyy.b' },
  { source: 'stooq', symbol: '10tury.b' },
  { source: 'stooq', symbol: '10usy.b' }, // ABD 10Y — Stooq Vercel'den erişilebilir mi kontrolü
  { source: 'fred', symbol: 'IRLTLT01TRM156N' },
];

export async function GET(): Promise<NextResponse> {
  const results = await Promise.all(
    PROBES.map(async (p) => {
      try {
        const candles: Candle[] =
          p.source === 'stooq' ? await fetchStooq(p.symbol, 'daily') : await fetchFred(p.symbol);
        const last = candles[candles.length - 1];
        return {
          ...p,
          ok: true,
          count: candles.length,
          son: last ? { tarih: new Date(last.t).toISOString().slice(0, 10), deger: last.close } : null,
        };
      } catch (err) {
        return { ...p, ok: false, hata: err instanceof Error ? err.message : String(err) };
      }
    })
  );
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
}
