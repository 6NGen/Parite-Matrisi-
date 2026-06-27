// FRED'den makro serileri çekme (§8). FRED_API_KEY varsa JSON API, yoksa
// anahtarsız public fredgraph.csv uç noktası kullanılır.
// M2SL/WALCL haftalık/aylık yayınlanır; günlük frekansa resample sonradan yapılır.

import type { Candle } from '../types';
import { fetchWithRetry } from './http';
import { startOfUtcDay } from '../align';

export async function fetchFred(seriesId: string): Promise<Candle[]> {
  const key = process.env.FRED_API_KEY?.trim();
  return key ? fetchFredJson(seriesId, key) : fetchFredCsv(seriesId);
}

async function fetchFredJson(seriesId: string, apiKey: string): Promise<Candle[]> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${encodeURIComponent(seriesId)}&api_key=${apiKey}&file_type=json`;
  const res = await fetchWithRetry(url, { timeoutMs: 15000, retries: 2 });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} (${seriesId})`);
  const json = (await res.json()) as {
    observations?: Array<{ date: string; value: string }>;
  };
  const candles: Candle[] = [];
  for (const o of json.observations ?? []) {
    const v = Number(o.value);
    if (!Number.isFinite(v)) continue; // FRED eksik veriyi "." ile döner
    candles.push({ t: startOfUtcDay(Date.parse(`${o.date}T00:00:00Z`)), close: v });
  }
  if (candles.length === 0) throw new Error(`FRED: boş seri (${seriesId})`);
  candles.sort((a, b) => a.t - b.t);
  return candles;
}

async function fetchFredCsv(seriesId: string): Promise<Candle[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const res = await fetchWithRetry(url, { timeoutMs: 15000, retries: 2 });
  if (!res.ok) throw new Error(`FRED CSV HTTP ${res.status} (${seriesId})`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  const candles: Candle[] = [];
  // başlık satırını atla
  for (let i = 1; i < lines.length; i++) {
    const [date, value] = lines[i].split(',');
    const v = Number(value);
    if (!date || !Number.isFinite(v)) continue;
    candles.push({ t: startOfUtcDay(Date.parse(`${date.trim()}T00:00:00Z`)), close: v });
  }
  if (candles.length === 0) throw new Error(`FRED CSV: boş seri (${seriesId})`);
  candles.sort((a, b) => a.t - b.t);
  return candles;
}
