// Skorlama motoru (§5). Sınıfa göre anlamlı referansların ağırlıklı alt kümesi.
// Yön kuralı tekdüze: enstrüman/referans rasyosu yükseliyorsa +puan (§5.1).
// Eksik kriterler skora katılmaz; skor mevcut geçerli ağırlığa göre normalize edilir (§11).

import type {
  AssetClass,
  CellResult,
  OverextInfo,
  RegimeInfo,
  ScoreBreakdownItem,
  ScoreResult,
  Signal,
  Timeframe,
} from './types';
import { convictionFromDelta, convictionFromSpread } from './calc';

// Yapısal düşüş rejiminde skora uygulanan çarpan (İYİLEŞTİRME 2).
const REGIME_PENALTY = 0.6;

// Aşırı uzama (overextension) dampeneri — momentum modelinin parabolik/blow-off
// hareketlerde (ör. 1 yılda 30x) GÜÇLÜ AL basmasını engeller. İki yol:
//  (a) MUTLAK stretch: fiyat uzun SMA'nın çok üstünde (sürdürülen parabolik harekette
//      stretch sabit-yüksek olur, z≈0 kalır; bu yüzden mutlak ölçü şarttır).
//  (b) z-skor: fiyatın kendi geçmişine göre olağandışı ani sıçraması.
// Severity = max(iki yolun fazlası); skor faktörü severity ile kademeli düşer.
// Eşikler reel (enflasyondan arındırılmış) düşünülür: TR enflasyonunda SMA200 gecikmesi
// fiyatı ~%20 üste taşır; %50+ stretch gerçek bir reel parabolik harekettir.
const OVEREXT_STRETCH_THRESHOLD = 50; // % — bunun üstündeki mutlak stretch cezalanır
const OVEREXT_STRETCH_SCALE = 50; // %/severity birimi
const OVEREXT_Z_THRESHOLD = 2.5; // ani sıçrama için z eşiği
const OVEREXT_MIN_STRETCH_FOR_Z = 25; // z-yolu için asgari mutlak stretch (%)
const OVEREXT_SLOPE = 0.25; // severity birimi başına kıstırma
const OVEREXT_FLOOR = 0.35; // en agresif çarpan (uç parabolikte ~KADEMELİ SAT'a iner)

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
  /** Aşırı uzama (parabolik/blow-off) dampeneri için. */
  overext?: OverextInfo;
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

// Birikmiş ağırlık/kanaat + rejim kapısından nihai ScoreResult üretir.
function finalize(
  symbol: string,
  earned: number,
  available: number,
  breakdown: ScoreBreakdownItem[],
  ctxRegime?: RegimeInfo,
  ctxOverext?: OverextInfo
): ScoreResult {
  if (available === 0) {
    // GÖREV 5 — "veri yok" ≠ gerçek 0 skor. na işaretle; UI "—" gösterir, sinyal basmaz.
    const regime = ctxRegime ? { ...ctxRegime, applied: false } : undefined;
    const overext = ctxOverext ? { ...ctxOverext, applied: false } : undefined;
    return { symbol, score: 0, signal: 'NÖTR', breakdown, regime, overext, na: true };
  }
  const rawScore = Math.round((earned / available) * 100);

  // İki dampener de rawScore üzerine çarpan olarak uygulanır (skor düşürür, yükseltmez).
  let factor = 1;

  // İYİLEŞTİRME 2 — rejim kapısı: yapısal düşüşte (fiyat < yavaş SMA) skoru kıs.
  let regime: RegimeInfo | undefined;
  if (ctxRegime && !ctxRegime.na) {
    const applied = !ctxRegime.up;
    if (applied) factor *= REGIME_PENALTY;
    regime = { ...ctxRegime, applied };
  } else if (ctxRegime) {
    regime = { ...ctxRegime, applied: false };
  }

  // Aşırı uzama dampeneri: mutlak stretch (sürdürülen parabolik) ya da yüksek z (ani
  // sıçrama) ne kadar şiddetliyse skoru o kadar kıs.
  let overext: OverextInfo | undefined;
  if (ctxOverext && !ctxOverext.na) {
    const stretchExcess = Math.max(
      0,
      (ctxOverext.stretchPct - OVEREXT_STRETCH_THRESHOLD) / OVEREXT_STRETCH_SCALE
    );
    const zExcess =
      ctxOverext.stretchPct >= OVEREXT_MIN_STRETCH_FOR_Z
        ? Math.max(0, ctxOverext.z - OVEREXT_Z_THRESHOLD)
        : 0;
    const severity = Math.max(stretchExcess, zExcess);
    const applied = severity > 0;
    if (applied) factor *= Math.max(OVEREXT_FLOOR, 1 - OVEREXT_SLOPE * severity);
    overext = { ...ctxOverext, applied };
  } else if (ctxOverext) {
    overext = { ...ctxOverext, applied: false };
  }

  const score = Math.round(rawScore * factor);
  return { symbol, score, rawScore, signal: signalFromScore(score), breakdown, regime, overext };
}

// ODAKLI skor — sınıf için anlamlı referansların ağırlıklı alt kümesi (varsayılan).
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

  return finalize(ctx.symbol, earned, available, breakdown, ctx.regime, ctx.overext);
}

// GENİŞ skor — matristeki TÜM referans satırları (+ kendi endeksi) eşit ağırlıkla,
// kanaat-ortalaması. "Enstrüman tüm makro panele karşı ne kadar geniş ve güçlü
// yükselişte" sorusunu yanıtlar. Anlamsız/eksik (na) satırlar atlanır.
export function computeBroadScore(ctx: ScoreContext): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  let earned = 0;
  let available = 0;

  const add = (ref: string, cell: CellResult) => {
    if (cell.na) {
      breakdown.push({ ref, weight: 1, passed: false, na: true });
      return;
    }
    const conviction = cell.conviction ?? convictionFromDelta(cell.deltaPct, ctx.timeframe);
    earned += conviction;
    available += 1;
    breakdown.push({
      ref,
      weight: 1,
      passed: cell.trendUp,
      na: false,
      conviction: Number(conviction.toFixed(2)),
    });
  };

  if (!ctx.ownIndexCell.na) add('Kendi Endeksi', ctx.ownIndexCell);
  for (const [ref, cell] of Object.entries(ctx.cells)) add(ref, cell);

  return finalize(ctx.symbol, earned, available, breakdown, ctx.regime, ctx.overext);
}
