// CoinGecko'dan kripto fiyat ve piyasa değeri serileri (§8).
// Free public API anahtarsız çalışır; COINGECKO_API_KEY varsa Pro uç noktası.
// market_chart günlük noktalar döndürür; haftalık hizalama align katmanında yapılır.

import type { Candle, Timeframe } from '../types';
import { fetchWithRetry } from './http';
import { startOfUtcDay } from '../align';

export type CoinField = 'price' | 'mcap';

interface MarketChart {
  prices?: [number, number][];
  market_caps?: [number, number][];
}

export async function fetchCoinGecko(
  coinId: string,
  timeframe: Timeframe,
  field: CoinField = 'price'
): Promise<Candle[]> {
  const days = timeframe === 'daily' ? 730 : 1825;
  const key = process.env.COINGECKO_API_KEY?.trim();
  const host = key ? 'pro-api.coingecko.com' : 'api.coingecko.com';
  const url =
    `https://${host}/api/v3/coins/${encodeURIComponent(coinId)}/market_chart` +
    `?vs_currency=usd&days=${days}&interval=daily`;

  const res = await fetchWithRetry(url, {
    timeoutMs: 20000,
    retries: 2,
    headers: key ? { 'x-cg-pro-api-key': key } : undefined,
  });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status} (${coinId})`);
  const json = (await res.json()) as MarketChart;
  const rows = field === 'mcap' ? json.market_caps : json.prices;
  if (!rows || rows.length === 0) throw new Error(`CoinGecko: boş seri (${coinId})`);

  // Aynı güne düşen birden çok nokta olabilir; gün başına son değeri al.
  const byDay = new Map<number, number>();
  for (const [ms, val] of rows) {
    if (!Number.isFinite(val)) continue;
    byDay.set(startOfUtcDay(ms), val);
  }
  const candles: Candle[] = [...byDay.entries()]
    .map(([t, close]) => ({ t, close }))
    .sort((a, b) => a.t - b.t);
  if (candles.length === 0) throw new Error(`CoinGecko: geçerli veri yok (${coinId})`);
  return candles;
}
