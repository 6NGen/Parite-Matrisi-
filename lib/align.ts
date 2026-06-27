// Takvim hizalama & resample (§6). Tüm seriler ortak takvime ileri-doldurma ile
// hizalanır. Frekans tuzağı: M2SL/WALCL (haftalık/aylık) günlük fiyatla aynı
// rasyoya sokulmadan önce ileri-doldurma ile hedef frekansa resample edilir.

import type { Candle, Timeframe } from './types';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Haftalık çapa: ilgili UTC haftasının Pazartesi 00:00'ı. */
export function weekAnchor(ms: number): number {
  const day = startOfUtcDay(ms);
  // 1970-01-01 Perşembe → Pazartesi'ye kaydır
  const dow = Math.floor(day / DAY_MS + 4) % 7; // 0=Pazar
  const offset = (dow + 6) % 7; // Pazartesi'ye geri
  return day - offset * DAY_MS;
}

function step(timeframe: Timeframe): number {
  return timeframe === 'daily' ? DAY_MS : WEEK_MS;
}

function anchor(ms: number, timeframe: Timeframe): number {
  return timeframe === 'daily' ? startOfUtcDay(ms) : weekAnchor(ms);
}

/** Sıralı candle dizisinde t anına kadarki son kapanışı döndürür (ileri-doldurma).
 *  t ilk noktadan önceyse null. t son noktadan sonraysa son değer taşınır. */
function sampleForward(candles: Candle[], t: number): number | null {
  if (candles.length === 0 || t < candles[0].t) return null;
  // binary search: <= t olan en büyük index
  let lo = 0;
  let hi = candles.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return candles[ans].close;
}

export interface AlignedPair {
  calendar: number[];
  a: number[];
  b: number[];
}

/** İki seriyi ortak takvime hizalar. Başlangıç = iki serinin de başladığı an,
 *  bitiş = en güncel verinin anı (eksik günler ileri doldurma). */
export function alignPair(a: Candle[], b: Candle[], timeframe: Timeframe): AlignedPair {
  if (a.length === 0 || b.length === 0) return { calendar: [], a: [], b: [] };
  const stepMs = step(timeframe);
  const start = anchor(Math.max(a[0].t, b[0].t), timeframe);
  const end = anchor(Math.max(a[a.length - 1].t, b[b.length - 1].t), timeframe);
  if (end < start) return { calendar: [], a: [], b: [] };

  const calendar: number[] = [];
  const av: number[] = [];
  const bv: number[] = [];
  for (let t = start; t <= end; t += stepMs) {
    const va = sampleForward(a, t);
    const vb = sampleForward(b, t);
    if (va == null || vb == null) continue;
    calendar.push(t);
    av.push(va);
    bv.push(vb);
  }
  return { calendar, a: av, b: bv };
}

/** Tek seriyi hedef frekanslı kendi takvimine resample eder (synthetic toplam
 *  için constituent serilerini hizalamada kullanılır). */
export function resampleToCalendar(
  candles: Candle[],
  calendar: number[]
): (number | null)[] {
  return calendar.map((t) => sampleForward(candles, t));
}

/** Bir grup serinin ortak takvimini üretir (synthetic endeks toplamı için). */
export function commonCalendar(seriesList: Candle[][], timeframe: Timeframe): number[] {
  const valid = seriesList.filter((s) => s.length > 0);
  if (valid.length === 0) return [];
  const stepMs = step(timeframe);
  const start = anchor(Math.max(...valid.map((s) => s[0].t)), timeframe);
  const end = anchor(Math.max(...valid.map((s) => s[s.length - 1].t)), timeframe);
  const cal: number[] = [];
  for (let t = start; t <= end && cal.length < 5000; t += stepMs) cal.push(t);
  return cal;
}
