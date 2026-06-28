// Veri çekme orkestrasyonu: leaf seri (yahoo/fred/coingecko) + cache +
// synthetic endeks türetme (avg / mcapSum). Her hücre için ayrı çağrı yapılmaz;
// matrix katmanı benzersiz sembolleri bir kez ister (§9).

import type { Candle, IndexDef, Instrument, ReferenceRow, Timeframe } from './types';
import { getCached, setCached } from './cache';
import { fetchYahoo } from './sources/yahoo';
import { fetchFred } from './sources/fred';
import { fetchCoinGecko, fetchGlobalMcap, type CoinField } from './sources/coingecko';
import { commonCalendar, resampleToCalendar } from './align';
import { smaWindows } from './calc';

export interface LeafSpec {
  apiSource: Instrument['apiSource'];
  apiSymbol: string;
  scale?: number;
  coinField?: CoinField;
}

function cacheSymbol(spec: LeafSpec): string {
  const suffix = spec.coinField === 'mcap' ? '#mcap' : '';
  return `${spec.apiSource}:${spec.apiSymbol}${suffix}`;
}

// Eşzamanlı çift çağrıları önlemek için uçuştaki istekleri tekilleştir.
const inflight = new Map<string, Promise<Candle[]>>();

/** Tekil (leaf) seri çekme — cache'li ve uçuş tekilleştirmeli. */
export async function fetchLeaf(spec: LeafSpec, timeframe: Timeframe): Promise<Candle[]> {
  const sym = cacheSymbol(spec);
  const cached = getCached(sym, timeframe);
  if (cached) return cached.candles;

  const key = `${timeframe}:${sym}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = doFetchLeaf(spec, sym, timeframe).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function doFetchLeaf(spec: LeafSpec, sym: string, timeframe: Timeframe): Promise<Candle[]> {
  let candles: Candle[];
  switch (spec.apiSource) {
    case 'yahoo':
      candles = await fetchYahoo(spec.apiSymbol, timeframe);
      break;
    case 'fred':
      candles = await fetchFred(spec.apiSymbol);
      break;
    case 'coingecko':
      candles = await fetchCoinGecko(spec.apiSymbol, timeframe, spec.coinField ?? 'price');
      break;
    default:
      throw new Error(`Bilinmeyen leaf kaynağı: ${spec.apiSource}`);
  }

  if (spec.scale && spec.scale !== 1) {
    candles = candles.map((c) => ({ t: c.t, close: c.close * spec.scale! }));
  }
  setCached({ symbol: sym, timeframe, candles });
  return candles;
}

export function refSpec(r: ReferenceRow): LeafSpec {
  return { apiSource: r.apiSource, apiSymbol: r.apiSymbol, scale: r.scale };
}

/** Referans serisini çeker; birincil kaynak veri vermezse alternatifleri sırayla
 *  dener (ör. TR10Y: FRED ölü → Stooq). İlk geçerli seri kazanır. Hepsi
 *  başarısızsa son hatayı fırlatır (tek uyarı üretir). */
export async function fetchReference(r: ReferenceRow, timeframe: Timeframe): Promise<Candle[]> {
  const specs: LeafSpec[] = [refSpec(r), ...(r.alternates ?? [])];
  let lastErr: unknown;
  for (const spec of specs) {
    try {
      const s = await fetchLeaf(spec, timeframe);
      if (s.length > 0) return s;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Referans serisi alınamadı: ${r.symbol}`);
}

export function instrumentSpec(i: Instrument): LeafSpec {
  return { apiSource: i.apiSource, apiSymbol: i.apiSymbol, scale: i.scale };
}

/** Eşit-ağırlıklı normalize ortalama (forex sepeti, emtia grupları). */
function averageSeries(seriesList: Candle[][], timeframe: Timeframe): Candle[] {
  const cal = commonCalendar(seriesList, timeframe);
  if (cal.length === 0) return [];
  const resampled = seriesList.map((s) => resampleToCalendar(s, cal));
  const out: Candle[] = [];
  for (let i = 0; i < cal.length; i++) {
    let sum = 0;
    let n = 0;
    for (const r of resampled) {
      const first = r.find((v) => v != null && Number.isFinite(v) && v !== 0);
      const v = r[i];
      if (first == null || v == null || !Number.isFinite(v)) continue;
      sum += (v / first) * 100; // ilk geçerli değere göre indeksle
      n++;
    }
    if (n > 0) out.push({ t: cal[i], close: sum / n });
  }
  return out;
}

/** Piyasa değeri toplamı (kripto TOTAL/TOTAL2/TOTAL3). */
function mcapSumSeries(seriesList: Candle[][], timeframe: Timeframe): Candle[] {
  const cal = commonCalendar(seriesList, timeframe);
  if (cal.length === 0) return [];
  const resampled = seriesList.map((s) => resampleToCalendar(s, cal));
  const out: Candle[] = [];
  for (let i = 0; i < cal.length; i++) {
    let sum = 0;
    let any = false;
    for (const r of resampled) {
      const v = r[i];
      if (v == null || !Number.isFinite(v)) continue;
      sum += v;
      any = true;
    }
    if (any) out.push({ t: cal[i], close: sum });
  }
  return out;
}

/** Bileşen hisselerinden normalize ortalama türetir (BIST sektör endeksi vekili).
 *  GÖREV 1 — `excludeSymbol` verilirse o bileşen hariç tutulur (leave-one-out):
 *  bir hisseyi içinde kendisi de bulunan sepete bölme dairesini kırar. */
async function syntheticFromConstituents(
  idx: IndexDef,
  timeframe: Timeframe,
  excludeSymbol?: string
): Promise<Candle[]> {
  const members = idx.constituents.filter((c) => c.symbol !== excludeSymbol);
  if (members.length === 0) return []; // tek bileşendi ve o da çıkarıldı → vekil yok
  const series = await Promise.all(
    members.map((c) => fetchLeaf(instrumentSpec(c), timeframe).catch(() => [] as Candle[]))
  );
  const valid = series.filter((s) => s.length > 0);
  if (valid.length === 0) return [];
  return averageSeries(valid, timeframe);
}

// GÖREV 7 — Synthetic mcap-toplam serisinin MERTEBESİNİ gerçek küresel piyasa
// değerine sabitler (CoinGecko /global anlık değeriyle). Sabit çarpan olduğu için
// trend/skor değişmez; yalnızca gösterilen büyüklük trilyon-$ mertebesine gelir.
// Geçmiş şekil yine bileşen sepetinden gelen yaklaşımdır (free API geçmiş global
// piyasa değeri vermez). /global başarısızsa seri ölçeklenmeden döner.
async function anchorToGlobal(summed: Candle[], idx: IndexDef): Promise<Candle[]> {
  if (summed.length === 0) return summed;
  try {
    const g = await fetchGlobalMcap();
    const exc = idx.synthetic?.exclude ?? [];
    let frac = 1;
    if (exc.includes('BTC')) frac -= g.btcPct / 100;
    if (exc.includes('ETH')) frac -= g.ethPct / 100;
    const target = g.total * Math.max(frac, 0.01);
    const last = summed[summed.length - 1].close;
    if (last > 0 && target > 0) {
      const k = target / last;
      return summed.map((c) => ({ t: c.t, close: c.close * k }));
    }
  } catch {
    // /global yoksa ölçeklemeden bırak.
  }
  return summed;
}

/** Bir endeksin sütun/benchmark serisini döndürür (gerçek seri ya da synthetic).
 *  `excludeSymbol` (GÖREV 1) yalnızca synthetic/stock-vekili türetiminde leave-one-out
 *  için kullanılır; gerçek endeks serisinde dairesellik ihmal edilebilir (mcap ağırlığı). */
export async function fetchIndexSeries(
  idx: IndexDef,
  timeframe: Timeframe,
  excludeSymbol?: string
): Promise<Candle[]> {
  if (idx.apiSource !== 'synthetic') {
    // Gerçek seri yalnızca YETERLİ uzunluktaysa kabul edilir. Yahoo BIST sektör
    // endeksleri (XELKT.IS vb.) çoğu zaman boş YA DA çok kısa/seyrek seri döndürür;
    // kısa seri rasyo hizalamasında NA üretir. Bu yüzden uzun SMA penceresi kadar
    // veri yoksa bileşenlerden türetilen vekile düşülür (stock için garantili).
    // Not: gerçek endeks varsa leave-one-out gerekmez (bileşen mcap ağırlığı küçük);
    // LOO yalnızca eşit-ağırlıklı vekilde dairesellik için anlamlıdır.
    const minLen = smaWindows(timeframe).long + 5;
    let real: Candle[] = [];
    try {
      real = await fetchLeaf(
        { apiSource: idx.apiSource, apiSymbol: idx.apiSymbol, scale: idx.scale },
        timeframe
      );
    } catch {
      real = [];
    }
    if (real.length >= minLen) return real;

    if (idx.assetClass === 'stock' && idx.constituents.length > 0) {
      const proxy = await syntheticFromConstituents(idx, timeframe, excludeSymbol);
      if (proxy.length > 0) return proxy;
    }
    if (real.length > 0) return real; // stock değilse en azından kısa gerçek seri
    throw new Error(`Endeks serisi alınamadı: ${idx.key}`);
  }
  const method = idx.synthetic?.method ?? 'avg';
  const exclude = new Set(idx.synthetic?.exclude ?? []);
  if (excludeSymbol) exclude.add(excludeSymbol); // LOO: synthetic endekste de uygula
  const members = idx.constituents.filter((c) => !exclude.has(c.symbol));

  if (method === 'mcapSum') {
    // CoinGecko free API hız limiti (429) burst'lerde tetiklenir; coin'leri
    // paralel değil SIRAYLA çek. Inflight dedupe sayesinde TOTAL/2/3 paylaşılan
    // coin'leri tekrar çekmez.
    const series: Candle[][] = [];
    for (const c of members) {
      series.push(
        await fetchLeaf(
          { apiSource: c.apiSource, apiSymbol: c.apiSymbol, coinField: 'mcap' },
          timeframe
        )
      );
    }
    const summed = mcapSumSeries(series, timeframe);
    return anchorToGlobal(summed, idx);
  }
  // avg
  const series = await Promise.all(members.map((c) => fetchLeaf(instrumentSpec(c), timeframe)));
  return averageSeries(series, timeframe);
}
