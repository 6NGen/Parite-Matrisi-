// Hesap çekirdeği (§3): rasyo serisi → SMA kesişimi → CellResult.
// Prototipteki iki-noktalı yüzde değişimi yerine rasyonun SMA kesişimi kullanılır.

import type { Candle, CellResult, Timeframe } from './types';
import { alignPair } from './align';

export interface SmaWindows {
  short: number;
  long: number;
}

export function smaWindows(timeframe: Timeframe): SmaWindows {
  return timeframe === 'daily' ? { short: 20, long: 50 } : { short: 10, long: 30 };
}

/** Dizinin son `n` elemanının ortalaması; yetersizse null. */
export function smaLast(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) return null;
    sum += v;
  }
  return sum / n;
}

const NA: CellResult = { ratioNow: NaN, deltaPct: 0, trendUp: false, na: true };

/** enstrüman / referans rasyosunun trendini hesaplar. */
export function computeCell(
  instrument: Candle[],
  reference: Candle[],
  timeframe: Timeframe
): CellResult {
  const { calendar, a, b } = alignPair(instrument, reference, timeframe);
  const { short, long } = smaWindows(timeframe);
  if (calendar.length < long) return NA;

  const ratio: number[] = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const denom = b[i];
    if (!Number.isFinite(denom) || denom === 0 || !Number.isFinite(a[i])) {
      return NA; // NaN/0 bölme koruması (§11)
    }
    ratio[i] = a[i] / denom;
  }

  const shortSma = smaLast(ratio, short);
  const longSma = smaLast(ratio, long);
  if (shortSma == null || longSma == null || longSma === 0) return NA;

  const deltaPct = (shortSma / longSma - 1) * 100;
  return {
    ratioNow: ratio[ratio.length - 1],
    deltaPct,
    trendUp: shortSma > longSma,
    na: false,
  };
}

/** Bir farkın (forex faiz makası) trendini hesaplar — rasyo değil fark yolu (§5.2). */
export function computeSpreadTrend(
  baseRate: Candle[],
  quoteRate: Candle[],
  timeframe: Timeframe
): { trendUp: boolean; na: boolean; deltaAbs: number } {
  const { calendar, a, b } = alignPair(baseRate, quoteRate, timeframe);
  const { short, long } = smaWindows(timeframe);
  if (calendar.length < long) return { trendUp: false, na: true, deltaAbs: 0 };

  const spread = a.map((v, i) => v - b[i]);
  const shortSma = smaLast(spread, short);
  const longSma = smaLast(spread, long);
  if (shortSma == null || longSma == null) return { trendUp: false, na: true, deltaAbs: 0 };

  return { trendUp: shortSma > longSma, na: false, deltaAbs: shortSma - longSma };
}
