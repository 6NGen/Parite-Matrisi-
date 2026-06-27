// Yahoo Finance chart API'sinden zaman serisi çekme (§8).
// Anahtar gerektirmez. Günlük: 2y aralık · Haftalık: 5y aralık + 1wk interval.

import type { Candle, Timeframe } from '../types';
import { fetchWithRetry } from './http';
import { startOfUtcDay } from '../align';

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

interface YahooChart {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators: { quote: Array<{ close?: (number | null)[] }> };
    }>;
    error?: { description?: string } | null;
  };
}

export async function fetchYahoo(
  apiSymbol: string,
  timeframe: Timeframe
): Promise<Candle[]> {
  const interval = timeframe === 'daily' ? '1d' : '1wk';
  const range = timeframe === 'daily' ? '2y' : '5y';
  const qs = `interval=${interval}&range=${range}&includePrePost=false`;

  let lastErr: unknown;
  for (const host of HOSTS) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(apiSymbol)}?${qs}`;
    try {
      const res = await fetchWithRetry(url, { timeoutMs: 15000, retries: 2 });
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} (${apiSymbol})`);
      const json = (await res.json()) as YahooChart;
      if (json.chart.error) {
        throw new Error(`Yahoo: ${json.chart.error.description ?? apiSymbol}`);
      }
      const result = json.chart.result?.[0];
      const ts = result?.timestamp;
      const closes = result?.indicators?.quote?.[0]?.close;
      if (!ts || !closes) throw new Error(`Yahoo: boş seri (${apiSymbol})`);

      const candles: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const close = closes[i];
        if (close == null || !Number.isFinite(close)) continue;
        candles.push({ t: startOfUtcDay(ts[i] * 1000), close });
      }
      if (candles.length === 0) throw new Error(`Yahoo: geçerli kapanış yok (${apiSymbol})`);
      candles.sort((a, b) => a.t - b.t);
      return candles;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Yahoo başarısız (${apiSymbol})`);
}
