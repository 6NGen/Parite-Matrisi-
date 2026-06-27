// Haber akışı uç noktası — AYRI ve skora dahil DEĞİL (yalnızca bağlam).
// Seçili sembol(ler) için Yahoo başlıklarını çeker.

import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooNews } from '@/lib/sources/yahooNews';
import { newsQueryFor } from '@/lib/catalog';
import type { NewsItem } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = req.nextUrl.searchParams.get('symbols') ?? '';
  const symbols = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6); // makul sınır

  if (symbols.length === 0) {
    return NextResponse.json({ items: [], warnings: [] });
  }

  const warnings: string[] = [];
  const results = await Promise.all(
    symbols.map(async (sym) => {
      try {
        return await fetchYahooNews(newsQueryFor(sym), sym, 6);
      } catch (err) {
        warnings.push(`${sym}: ${err instanceof Error ? err.message : 'haber alınamadı'}`);
        return [] as NewsItem[];
      }
    })
  );

  // Sembollere göre düzleştir, en yeni önce, tekrarları (link) ele.
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const list of results) {
    for (const it of list) {
      if (seen.has(it.link)) continue;
      seen.add(it.link);
      items.push(it);
    }
  }
  items.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));

  return NextResponse.json({ items, warnings });
}
