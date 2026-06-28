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

// Stooq Vercel IP'sini blokluyor (teşhisle doğrulandı). FRED Vercel'den çalışıyor,
// bu yüzden FRED'in canlı Türkiye faiz serilerini probe ediyoruz.
const PROBES: Probe[] = [
  { source: 'fred', symbol: 'DGS10' }, // ABD 10Y (kesin canlı) — FRED erişim kontrolü
  { source: 'fred', symbol: 'INTGSBTRM193N' }, // TR devlet tahvili getirisi (IMF IFS)
  { source: 'fred', symbol: 'INTGSTTRM193N' }, // TR hazine bonosu
  { source: 'fred', symbol: 'IR3TIB01TRM156N' }, // TR 3 aylık interbank
  { source: 'fred', symbol: 'IRLTLT01TRM156N' }, // eski OECD (muhtemelen ölü)
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
