// Hesap çekirdeği (§3): rasyo serisi → SMA kesişimi → CellResult.
// Prototipteki iki-noktalı yüzde değişimi yerine rasyonun SMA kesişimi kullanılır.

import type { Candle, CellResult, RegimeInfo, Timeframe } from './types';
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
  const { a, b } = alignPair(instrument, reference, timeframe);
  const { short, long } = smaWindows(timeframe);

  // GÖREV 6 — noktasal temizlik: tek bozuk bar (0/NaN payda veya NaN pay) tüm
  // hücreyi düşürmesin; o barı atla. Yalnızca geçerli nokta sayısı uzun pencerenin
  // altına düşerse NA.
  const ratio: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const denom = b[i];
    if (!Number.isFinite(denom) || denom === 0 || !Number.isFinite(a[i])) continue;
    ratio.push(a[i] / denom);
  }
  if (ratio.length < long) return NA;

  const shortSma = smaLast(ratio, short);
  const longSma = smaLast(ratio, long);
  if (shortSma == null || longSma == null || longSma === 0) return NA;

  const deltaPct = (shortSma / longSma - 1) * 100;
  return {
    ratioNow: ratio[ratio.length - 1],
    deltaPct,
    trendUp: shortSma > longSma,
    na: false,
    // Oynaklığa-göreli kanaat: SMA boşluğunu rasyonun KENDİ oynaklığına göre ölçer.
    conviction: convictionFromRatio(ratio, shortSma, longSma, long, timeframe),
  };
}

// Sabit-eşikli kanaat (yedek): delta% büyüklüğünden [0,1].
function fullDelta(timeframe: Timeframe): number {
  return timeframe === 'daily' ? 3 : 6;
}

export function convictionFromDelta(deltaPct: number, timeframe: Timeframe): number {
  if (!Number.isFinite(deltaPct)) return 0.5;
  const norm = Math.max(-1, Math.min(1, deltaPct / fullDelta(timeframe)));
  return 0.5 + 0.5 * norm;
}

function stdev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

// GÖREV 2 — Kanaat gürültü tabanı. Dönemsel getiri oynaklığı için ekonomik anlamlı
// bir minimum (floor). Aksi halde neredeyse düz / floating-point titreşimli rasyoda
// vol→0 olunca strength patlar ve kanaat sahte biçimde ~1'e doyar.
const MIN_PERIODIC_VOL_DAILY = 0.0015; // ~%0.15 günlük
const MIN_PERIODIC_VOL_WEEKLY = 0.004; // ~%0.4 haftalık

function minPeriodicVol(timeframe: Timeframe): number {
  return timeframe === 'daily' ? MIN_PERIODIC_VOL_DAILY : MIN_PERIODIC_VOL_WEEKLY;
}

// SMA boşluğunu (birikmiş sürüklenme) rasyonun dönemsel getiri oynaklığının
// horizon boyunca beklenen rastgele birikimine (vol·√long) böler — z-skor benzeri
// sinyal/gürültü. tanh ile [0,1]'e yumuşatılır. Yüksek oynaklık → daha büyük
// boşluk gerekir; böylece "büyük ama varlığı için normal" hareketler doymaz.
function convictionFromRatio(
  ratio: number[],
  shortSma: number,
  longSma: number,
  long: number,
  timeframe: Timeframe
): number {
  if (longSma === 0) return 0.5;
  const window = ratio.slice(-long);
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    if (prev !== 0 && Number.isFinite(prev) && Number.isFinite(window[i])) {
      returns.push(window[i] / prev - 1);
    }
  }
  // Yetersiz örnek → nötr kanaat.
  if (returns.length < Math.floor(long / 2)) return 0.5;

  const gap = shortSma / longSma - 1; // işaretli birikmiş sürüklenme
  const vol = Math.max(stdev(returns), minPeriodicVol(timeframe)); // gürültü tabanı
  const noise = vol * Math.sqrt(long); // taban sayesinde her zaman > 0
  const strength = gap / noise;
  return Math.max(0, Math.min(1, 0.5 + 0.5 * Math.tanh(strength)));
}

/** Bir farkın (forex faiz makası) büyüklüğünden kanaat (FULL = 0.5 puan ≈ 50bps). */
export function convictionFromSpread(deltaAbs: number): number {
  if (!Number.isFinite(deltaAbs)) return 0.5;
  const norm = Math.max(-1, Math.min(1, deltaAbs / 0.5));
  return 0.5 + 0.5 * norm;
}

// İYİLEŞTİRME 2 — Uzun vadeli rejim kapısı: enstrümanın KENDİ fiyatının yavaş
// SMA'sına (günlük 200 · haftalık 40) göre yapısal yön. Yapısal düşüşteyken
// kısa vadeli zıplamanın "GÜÇLÜ AL" üretmesini engellemek için kullanılır.
export function regimeWindow(timeframe: Timeframe): number {
  return timeframe === 'daily' ? 200 : 40;
}

export function regimeFromSeries(series: Candle[], timeframe: Timeframe): RegimeInfo {
  const n = regimeWindow(timeframe);
  const closes = series.map((c) => c.close).filter((v) => Number.isFinite(v));
  const sma = smaLast(closes, n);
  if (sma == null || sma === 0 || closes.length === 0) {
    return { up: false, deltaPct: 0, na: true, applied: false };
  }
  const last = closes[closes.length - 1];
  const deltaPct = (last / sma - 1) * 100;
  return { up: last >= sma, deltaPct, na: false, applied: false };
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
