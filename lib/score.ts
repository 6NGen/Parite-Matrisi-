// Skorlama motoru (§5). Sınıfa göre anlamlı referansların ağırlıklı alt kümesi.
// Yön kuralı tekdüze: enstrüman/referans rasyosu yükseliyorsa +puan (§5.1).
// Eksik kriterler skora katılmaz; skor mevcut geçerli ağırlığa göre normalize edilir (§11).

import type {
  AssetClass,
  CellResult,
  ScoreBreakdownItem,
  ScoreResult,
  Signal,
} from './types';

export interface ScoreContext {
  symbol: string;
  assetClass: AssetClass;
  isIndex: boolean;
  cells: Record<string, CellResult>; // 11 makro satır
  ownIndexCell: CellResult; // enstrüman / sektör (parent) endeksi
  bankCell?: CellResult; // enstrüman / XBANK (faizsiz finansman bayrağı)
  useBankRef?: boolean;
  /** Forex faiz makası sonucu (rasyo değil fark yolu). */
  forexTrend?: { trendUp: boolean; na: boolean };
  /** Emtia alt-türü ipucu. */
  commodityKind?: 'gold' | 'silver' | 'generic';
}

interface Criterion {
  ref: string;
  weight: number;
  cell?: CellResult; // rasyo tabanlı kriter
  pass?: boolean; // doğrudan sonuç (forex)
  na?: boolean;
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
      const macroRef = ctx.useBankRef ? 'XBANK' : 'US10Y';
      const macroCell = ctx.useBankRef ? ctx.bankCell : pick(ctx.cells, 'US10Y');
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
      return [{ ref: 'Faiz Makası', weight: 100, pass: t?.trendUp, na: t?.na ?? true }];
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
    const passed = c.pass ?? (c.cell ? c.cell.trendUp : false);
    if (!na) {
      available += c.weight;
      if (passed) earned += c.weight;
    }
    breakdown.push({ ref: c.ref, weight: c.weight, passed: !na && passed, na });
  }

  if (available === 0) {
    return { symbol: ctx.symbol, score: 0, signal: 'NÖTR', breakdown };
  }
  const score = Math.round((earned / available) * 100);
  return { symbol: ctx.symbol, score, signal: signalFromScore(score), breakdown };
}
