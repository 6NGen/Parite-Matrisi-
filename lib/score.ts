// Skorlama motoru (§5). Sınıfa göre anlamlı referansların ağırlıklı alt kümesi.
// Yön kuralı tekdüze: enstrüman/referans rasyosu yükseliyorsa +puan (§5.1).
// Eksik kriterler skora katılmaz; skor mevcut geçerli ağırlığa göre normalize edilir (§11).

import type {
  AssetClass,
  CellResult,
  RegimeInfo,
  ScoreBreakdownItem,
  ScoreResult,
  Signal,
  Timeframe,
} from './types';
import { convictionFromDelta, convictionFromSpread } from './calc';

// Yapısal düşüş rejiminde skora uygulanan çarpan (İYİLEŞTİRME 2).
const REGIME_PENALTY = 0.6;

export interface ScoreContext {
  symbol: string;
  assetClass: AssetClass;
  isIndex: boolean;
  timeframe: Timeframe;
  cells: Record<string, CellResult>; // 11 makro satır
  ownIndexCell: CellResult; // enstrüman / sektör (parent) endeksi
  bankCell?: CellResult; // enstrüman / XBANK (faizsiz finansman bayrağı)
  useBankRef?: boolean;
  /** Forex faiz makası sonucu (rasyo değil fark yolu). */
  forexTrend?: { trendUp: boolean; na: boolean; deltaAbs?: number };
  /** Emtia alt-türü ipucu. */
  commodityKind?: 'gold' | 'silver' | 'generic';
  /** Enstrümanın kendi fiyatının uzun vadeli rejimi (kapı). */
  regime?: RegimeInfo;
}

interface Criterion {
  ref: string;
  weight: number;
  cell?: CellResult; // rasyo tabanlı kriter
  pass?: boolean; // doğrudan sonuç (forex)
  na?: boolean;
  conviction?: number; // doğrudan kanaat (forex için)
}

export function signalFromScore(score: number): Signal {
  if (score >= 80) return 'GÜÇLÜ AL';
  if (score >= 60) return 'KADEMELİ AL';
  if (score >= 40) return 'NÖTR';
  if (score >= 20) return 'KADEMELİ SAT';
  return 'GÜÇLÜ SAT';
}

function pick(cells: Record<string, CellResult>, key: string): CellResult | undefined {
  return cells[key];
}

function buildCriteria(ctx: ScoreContext): Criterion[] {
  switch (ctx.assetClass) {
    case 'stock': {
      // İYİLEŞTİRME 4 — BIST hisseleri için makro baskı referansı TR10Y
      // (Türk varlığına daha doğrudan); TR10Y yoksa US10Y'ye düş.
      // Faizsiz finansman bayraklı hisseler (KTLEV) yine /XBANK kullanır.
      const tr = pick(ctx.cells, 'TR10Y');
      const trUsable = tr && !tr.na;
      const macroRef = ctx.useBankRef ? 'XBANK' : trUsable ? 'TR10Y' : 'US10Y';
      const macroCell = ctx.useBankRef
        ? ctx.bankCell
        : trUsable
          ? tr
          : pick(ctx.cells, 'US10Y');
      return [
        { ref: 'USDTRY', weight: 40, cell: pick(ctx.cells, 'USDTRY') },
        { ref: 'Sektör Endeksi', weight: 40, cell: ctx.ownIndexCell },
        { ref: macroRef, weight: 20, cell: macroCell },
      ];
    }
    case 'crypto': {
      const walcl = pick(ctx.cells, 'WALCL');
      const liq = walcl && !walcl.na ? walcl : pick(ctx.cells, 'M2SL');
      const liqRef = walcl && !walcl.na ? 'WALCL' : 'M2SL';
      return [
        { ref: liqRef, weight: 50, cell: liq },
        { ref: 'NDX', weight: 50, cell: pick(ctx.cells, 'NDX') },
      ];
    }
    case 'commodity': {
      const kind = ctx.commodityKind ?? 'generic';
      if (kind === 'gold') {
        return [
          { ref: 'US10Y', weight: 50, cell: pick(ctx.cells, 'US10Y') },
          { ref: 'COPPER', weight: 50, cell: pick(ctx.cells, 'COPPER') },
        ];
      }
      if (kind === 'silver') {
        return [
          { ref: 'XAUUSD', weight: 50, cell: pick(ctx.cells, 'XAUUSD') },
          { ref: 'COPPER', weight: 50, cell: pick(ctx.cells, 'COPPER') },
        ];
      }
      return [
        { ref: 'US10Y', weight: 50, cell: pick(ctx.cells, 'US10Y') },
        { ref: 'DXY', weight: 50, cell: pick(ctx.cells, 'DXY') },
      ];
    }
    case 'forex': {
      const t = ctx.forexTrend;
      const na = t?.na ?? true;
      const conviction = na
        ? undefined
        : convictionFromSpread(t?.deltaAbs ?? (t?.trendUp ? 0.5 : -0.5));
      return [{ ref: 'Faiz Makası', weight: 100, pass: t?.trendUp, na, conviction }];
    }
    default:
      return [];
  }
}

export function computeScore(ctx: ScoreContext): ScoreResult {
  const criteria = buildCriteria(ctx);
  const breakdown: ScoreBreakdownItem[] = [];
  let earned = 0;
  let available = 0;

  for (const c of criteria) {
    const na = c.na ?? (c.cell ? c.cell.na : c.pass === undefined);
    // İYİLEŞTİRME 1 — dereceli katkı: ağırlık × kanaat. Rasyo hücresi için
    // oynaklığa-göreli kanaat (cell.conviction) tercih edilir; yoksa delta%'ye düşülür.
    const conviction = na
      ? 0
      : c.conviction ??
        (c.cell ? c.cell.conviction ?? convictionFromDelta(c.cell.deltaPct, ctx.timeframe) : 0.5);
    const passed = c.pass ?? (c.cell ? c.cell.trendUp : false);
    if (!na) {
      available += c.weight;
      earned += c.weight * conviction;
    }
    breakdown.push({
      ref: c.ref,
      weight: c.weight,
      passed: !na && passed,
      na,
      conviction: na ? undefined : Number(conviction.toFixed(2)),
    });
  }

  if (available === 0) {
    const regime = ctx.regime ? { ...ctx.regime, applied: false } : undefined;
    return { symbol: ctx.symbol, score: 0, signal: 'NÖTR', breakdown, regime };
  }

  const rawScore = Math.round((earned / available) * 100);

  // İYİLEŞTİRME 2 — rejim kapısı: yapısal düşüşte (fiyat < yavaş SMA) skoru kıs.
  let score = rawScore;
  let regime: RegimeInfo | undefined;
  if (ctx.regime && !ctx.regime.na) {
    const applied = !ctx.regime.up;
    if (applied) score = Math.round(rawScore * REGIME_PENALTY);
    regime = { ...ctx.regime, applied };
  } else if (ctx.regime) {
    regime = { ...ctx.regime, applied: false };
  }

  return {
    symbol: ctx.symbol,
    score,
    rawScore,
    signal: signalFromScore(score),
    breakdown,
    regime,
  };
}
