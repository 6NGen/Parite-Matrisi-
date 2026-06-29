// GÖREV 3 — Backtest / falsifikasyon koşumu.
// Üretilen AL/SAT sinyalinin öngörü değeri var mı? Point-in-time (geçmişe bakmadan)
// skor hesaplanır, t+N dönemdeki İLERİ rölatif getiriyle eşleştirilir, sinyal
// kovaları karşılaştırılır. Asıl test: ortalama ileri getiri AL→SAT yönünde monoton
// azalıyor mu (sinyal ayrışıyor mu)?

import type { AssetClass, Candle, Signal, Timeframe } from './types';
import { computeCell, regimeFromSeries, overextensionFromSeries } from './calc';
import { computeScore, type ScoreContext } from './score';
import {
  REFERENCES,
  findInstrumentBySymbol,
  getIndex,
} from './catalog';
import { fetchReference, fetchLeaf, fetchIndexSeries, instrumentSpec } from './series';

const REBALANCE_STEP = 3; // örtüşmeyi azaltmak için her 3 dönemde bir yeniden örnekle

const NA_CELL = { ratioNow: NaN, deltaPct: 0, trendUp: false, na: true };

const SIGNAL_ORDER: Signal[] = [
  'GÜÇLÜ AL',
  'KADEMELİ AL',
  'NÖTR',
  'KADEMELİ SAT',
  'GÜÇLÜ SAT',
];

// Skor için sınıfa göre gereken referanslar (computeScore alt kümeyi kendi seçer).
const SCORE_REFS = ['USDTRY', 'US10Y', 'WALCL', 'M2SL', 'NDX', 'COPPER', 'XAUUSD', 'DXY'];

// İleri rölatif getiri için sınıf başına TEK benchmark (priceable seri).
const BENCHMARK: Record<AssetClass, string> = {
  stock: 'USDTRY', // doları yenmek
  crypto: 'NDX', // risk iştahına karşı
  commodity: 'DXY', // dolar gücüne karşı
  forex: 'DXY',
};

export interface BucketStat {
  signal: Signal;
  count: number;
  meanFwd: number; // ortalama ileri rölatif getiri (%)
  medianFwd: number;
  hitRate: number; // pozitif ileri getiri oranı (%)
}

export interface HorizonResult {
  horizon: number;
  buckets: BucketStat[];
  monotonic: boolean; // ortalamalar AL→SAT yönünde (zayıf) azalıyor mu
  spearman: number | null; // skor ↔ ileri getiri rank korelasyonu
  samples: number;
}

export interface BacktestResult {
  symbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  benchmark: string;
  horizons: HorizonResult[];
  notes: string[];
}

function sliceTo(s: Candle[], t: number): Candle[] {
  // s artan sıralı; c.t <= t olan önek.
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return s.slice(0, lo);
}

function valueAt(s: Candle[], t: number): number | null {
  const pre = sliceTo(s, t);
  return pre.length ? pre[pre.length - 1].close : null;
}

function commodityKind(symbol: string): 'gold' | 'silver' | 'generic' {
  if (symbol === 'XAUUSD' || symbol === 'PRECIOUS') return 'gold';
  if (symbol === 'XAGUSD') return 'silver';
  return 'generic';
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

// Ortalama-sıra (average rank) ile Spearman rank korelasyonu.
export function spearman(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const rank = (v: number[]): number[] => {
    const idx = v.map((val, i) => [val, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1; // 1-tabanlı ortalama sıra
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x);
  const ry = rank(y);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export async function runBacktest(
  symbol: string,
  timeframe: Timeframe
): Promise<BacktestResult> {
  const instrument = findInstrumentBySymbol(symbol);
  if (!instrument) throw new Error(`Bilinmeyen enstrüman: ${symbol}`);
  const assetClass = instrument.assetClass;
  const notes: string[] = [];

  if (assetClass === 'forex') {
    notes.push('Forex faiz-makası skoru backtest kapsamı dışında.');
  }

  // Tüm seriler bir kez çekilir (tam geçmiş).
  const instSeries = await fetchLeaf(instrumentSpec(instrument), timeframe);

  const refSeries: Record<string, Candle[]> = {};
  await Promise.all(
    REFERENCES.filter((r) => SCORE_REFS.includes(r.symbol)).map(async (r) => {
      try {
        refSeries[r.symbol] = await fetchReference(r, timeframe);
      } catch {
        refSeries[r.symbol] = [];
      }
    })
  );

  // Sektör vekili (leave-one-out) — stock için.
  let sectorSeries: Candle[] = [];
  if (assetClass === 'stock') {
    const parent = getIndex(instrument.parentIndex);
    if (parent) {
      try {
        sectorSeries = await fetchIndexSeries(parent, timeframe, instrument.symbol);
      } catch {
        sectorSeries = [];
        notes.push('Sektör vekili alınamadı; sektör kriteri backtest boyunca na.');
      }
    }
  }

  // Faizsiz finansman bayrağı → XBANK serisi.
  let xbankSeries: Candle[] = [];
  if (instrument.scoreFlags?.useBankRef) {
    const xbank = getIndex('XBANK');
    if (xbank) {
      try {
        xbankSeries = await fetchIndexSeries(xbank, timeframe);
      } catch {
        xbankSeries = [];
      }
    }
  }

  const benchKey = BENCHMARK[assetClass];
  const benchSeries = refSeries[benchKey] ?? [];
  if (benchSeries.length === 0) {
    notes.push(`Benchmark (${benchKey}) serisi yok; ileri rölatif getiri hesaplanamadı.`);
  }

  notes.push(
    'Sektör üyeliği statik kataloğa dayanır (survivorship sınırı): geçmiş bileşen ' +
      'listesi değil bugünkü liste kullanılır.'
  );

  // Point-in-time skor: t anındaki skor yalnızca ≤ t veriyi kullanır.
  function scoreAt(t: number): { score: number; signal: Signal; na: boolean } {
    const sInst = sliceTo(instSeries, t);
    const cells: Record<string, (typeof NA_CELL) | ReturnType<typeof computeCell>> = {};
    for (const sym of SCORE_REFS) {
      const ser = refSeries[sym];
      cells[sym] = ser && ser.length ? computeCell(sInst, sliceTo(ser, t), timeframe) : NA_CELL;
    }
    const ownIndexCell =
      sectorSeries.length > 0 ? computeCell(sInst, sliceTo(sectorSeries, t), timeframe) : NA_CELL;
    const bankCell =
      xbankSeries.length > 0 ? computeCell(sInst, sliceTo(xbankSeries, t), timeframe) : NA_CELL;

    const ctx: ScoreContext = {
      symbol: instrument!.symbol,
      assetClass,
      isIndex: false,
      timeframe,
      cells: cells as ScoreContext['cells'],
      ownIndexCell,
      bankCell,
      useBankRef: instrument!.scoreFlags?.useBankRef,
      commodityKind: assetClass === 'commodity' ? commodityKind(instrument!.symbol) : undefined,
      regime: regimeFromSeries(sInst, timeframe),
      overext: overextensionFromSeries(sInst, timeframe),
    };
    const res = computeScore(ctx);
    return { score: res.score, signal: res.signal, na: res.na ?? false };
  }

  // Yeniden örnekleme noktaları: skorun değerlendirilebildiği aralık (uzun SMA dolduktan
  // sonra) ve ileri pencerenin sığacağı son nokta.
  const horizons = timeframe === 'daily' ? [10, 20] : [4, 8];
  const idxs: number[] = [];
  const minStartIdx = Math.min(60, instSeries.length); // uzun SMA + tampon
  const maxH = Math.max(...horizons);
  for (let i = minStartIdx; i + maxH < instSeries.length; i += REBALANCE_STEP) {
    idxs.push(i);
  }

  const horizonResults: HorizonResult[] = horizons.map((N) => {
    const rows: { score: number; signal: Signal; fwd: number }[] = [];
    for (const i of idxs) {
      const t = instSeries[i].t;
      const { score, signal, na } = scoreAt(t);
      if (na) continue;
      const p0 = instSeries[i].close;
      const p1 = instSeries[i + N]?.close;
      if (p0 == null || p1 == null || p0 === 0) continue;
      const instRet = (p1 / p0 - 1) * 100;

      // İleri rölatif getiri: enstrüman − benchmark (aynı pencere).
      let fwd = instRet;
      if (benchSeries.length) {
        const b0 = valueAt(benchSeries, t);
        const b1 = valueAt(benchSeries, instSeries[i + N].t);
        if (b0 != null && b1 != null && b0 !== 0) {
          fwd = instRet - (b1 / b0 - 1) * 100;
        }
      }
      rows.push({ score, signal, fwd });
    }

    const buckets: BucketStat[] = SIGNAL_ORDER.map((sig) => {
      const fwds = rows.filter((r) => r.signal === sig).map((r) => r.fwd);
      return {
        signal: sig,
        count: fwds.length,
        meanFwd: Number(mean(fwds).toFixed(3)),
        medianFwd: Number(median(fwds).toFixed(3)),
        hitRate: fwds.length
          ? Number(((fwds.filter((v) => v > 0).length / fwds.length) * 100).toFixed(1))
          : 0,
      };
    });

    // Monotonluk: dolu kovaların ortalamaları AL→SAT yönünde (zayıf) azalıyor mu.
    const filled = buckets.filter((b) => b.count > 0);
    let monotonic = true;
    for (let k = 1; k < filled.length; k++) {
      if (filled[k].meanFwd > filled[k - 1].meanFwd + 1e-9) {
        monotonic = false;
        break;
      }
    }

    return {
      horizon: N,
      buckets,
      monotonic: filled.length >= 2 ? monotonic : false,
      spearman: (() => {
        const sp = spearman(rows.map((r) => r.score), rows.map((r) => r.fwd));
        return sp == null ? null : Number(sp.toFixed(3));
      })(),
      samples: rows.length,
    };
  });

  return { symbol, assetClass, timeframe, benchmark: benchKey, horizons: horizonResults, notes };
}
