// Sunucu tarafı fiyat serisi cache'i (§9).
// Varsayılan: bellek-içi TTL cache. SUPABASE_* tanımlıysa kalıcı cache opsiyonel
// olarak eklenebilir; ancak temel akış her hücre için ayrı API çağrısı yapmamaya
// dayanır — benzersiz semboller bir kez çekilir, rasyolar bellekte hesaplanır.

import type { PriceSeries, Timeframe } from './types';

interface Entry {
  series: PriceSeries;
  expires: number;
}

// Modül seviyesi singleton (Next.js sunucu süreci boyunca yaşar).
const store = new Map<string, Entry>();

function ttlFor(timeframe: Timeframe): number {
  const daily = Number(process.env.CACHE_TTL_DAILY ?? 3600);
  const weekly = Number(process.env.CACHE_TTL_WEEKLY ?? 21600);
  return (timeframe === 'daily' ? daily : weekly) * 1000;
}

export function cacheKey(apiSymbol: string, timeframe: Timeframe): string {
  return `${timeframe}:${apiSymbol}`;
}

export function getCached(apiSymbol: string, timeframe: Timeframe): PriceSeries | undefined {
  const entry = store.get(cacheKey(apiSymbol, timeframe));
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(cacheKey(apiSymbol, timeframe));
    return undefined;
  }
  return entry.series;
}

export function setCached(series: PriceSeries): void {
  store.set(cacheKey(series.symbol, series.timeframe), {
    series,
    expires: Date.now() + ttlFor(series.timeframe),
  });
}

export function clearCache(): void {
  store.clear();
}
