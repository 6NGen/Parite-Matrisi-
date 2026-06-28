// Stooq'tan zaman serisi (anahtarsız CSV). Geniş kapsam: tahvil getirileri,
// endeksler, emtia, forex. Tahvil getiri sembolleri ör. 10try.b (Türkiye 10Y),
// 10usy.b (ABD 10Y). Getiri serileri yüzde olarak gelir (US10Y ile aynı birim).

import type { Candle, Timeframe } from '../types';
import { fetchWithRetry } from './http';
import { startOfUtcDay } from '../align';

export async function fetchStooq(symbol: string, _timeframe: Timeframe): Promise<Candle[]> {
  // Günlük CSV; haftalık hizalama align katmanında yapılır.
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const res = await fetchWithRetry(url, { timeoutMs: 15000, retries: 2 });
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status} (${symbol})`);
  const text = (await res.text()).trim();

  // Geçersiz sembolde Stooq "No data" benzeri kısa metin döndürür.
  if (!text || !text.toLowerCase().startsWith('date')) {
    throw new Error(`Stooq: veri yok (${symbol})`);
  }
  const lines = text.split('\n');
  const candles: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    // Date,Open,High,Low,Close,Volume
    const date = cols[0];
    const close = Number(cols[4]);
    if (!date || !Number.isFinite(close)) continue;
    candles.push({ t: startOfUtcDay(Date.parse(`${date}T00:00:00Z`)), close });
  }
  if (candles.length === 0) throw new Error(`Stooq: geçerli kapanış yok (${symbol})`);
  candles.sort((a, b) => a.t - b.t);
  return candles;
}
