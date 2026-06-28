// Matris orkestrasyonu (§12.2–3): seçimlere göre sütunları kur, benzersiz
// serileri çek, 11 makro satır + kendi-endeksi satırı için CellResult hesapla,
// sınıfa göre skoru üret. Hatalar warning olarak toplanır, hücre na'ya düşer.

import type {
  CellResult,
  ColumnResult,
  IndexDef,
  Instrument,
  MatrixResponse,
  MatrixSelection,
  Timeframe,
  Candle,
} from './types';
import { ALL_INDICES, REFERENCES, FX_YIELDS, getIndex } from './catalog';
import { fetchLeaf, fetchIndexSeries, instrumentSpec, fetchReference } from './series';
import { computeCell, computeSpreadTrend, regimeFromSeries } from './calc';
import { computeScore, computeBroadScore, type ScoreContext } from './score';

const NA_CELL: CellResult = { ratioNow: NaN, deltaPct: 0, trendUp: false, na: true };

export async function buildMatrix(
  selections: MatrixSelection[],
  timeframe: Timeframe
): Promise<MatrixResponse> {
  const warnings: string[] = [];
  const selMap = new Map(selections.map((s) => [s.indexKey, s.instrument]));

  const safe = async (label: string, fn: () => Promise<Candle[]>): Promise<Candle[] | null> => {
    try {
      const s = await fn();
      return s.length > 0 ? s : null;
    } catch (err) {
      warnings.push(`${label}: ${err instanceof Error ? err.message : 'veri alınamadı'}`);
      return null;
    }
  };

  // Sessiz çekme: başarısızlıkta uyarı üretmez (beklenen-boş kaynaklar için).
  const quiet = async (fn: () => Promise<Candle[]>): Promise<Candle[] | null> => {
    try {
      const s = await fn();
      return s.length > 0 ? s : null;
    } catch {
      return null;
    }
  };

  // 1) Makro referans serilerini bir kez çek. `optional` referanslar (anahtarsız
  //    güncel kaynağı olmayanlar, ör. TR faizi) sessizce boş geçilir.
  const refSeries: Record<string, Candle[] | null> = {};
  await Promise.all(
    REFERENCES.map(async (r) => {
      refSeries[r.symbol] = r.optional
        ? await quiet(() => fetchReference(r, timeframe))
        : await safe(`Ref ${r.symbol}`, () => fetchReference(r, timeframe));
    })
  );

  // 2) Sütunları sırayla işle (cache + uçuş tekilleştirme tekrarları önler).
  const columns: ColumnResult[] = [];
  for (const idx of ALL_INDICES) {
    const col = await buildColumn(idx, selMap.get(idx.key), timeframe, refSeries, safe);
    columns.push(col);
  }

  return {
    timeframe,
    generatedAt: Date.now(),
    references: REFERENCES,
    columns,
    warnings,
  };
}

async function buildColumn(
  idx: IndexDef,
  selectedSymbol: string | undefined,
  timeframe: Timeframe,
  refSeries: Record<string, Candle[] | null>,
  safe: (label: string, fn: () => Promise<Candle[]>) => Promise<Candle[] | null>
): Promise<ColumnResult> {
  const instrument =
    selectedSymbol && selectedSymbol !== idx.key
      ? idx.constituents.find((c) => c.symbol === selectedSymbol)
      : undefined;
  const isIndex = !instrument;
  const selected = instrument ? instrument.symbol : idx.key;
  const displayName = instrument
    ? instrument.displayName ?? instrument.symbol
    : idx.displayName;

  // Sütun serisi
  const colSeries = instrument
    ? await safe(`Sütun ${selected}`, () => fetchLeaf(instrumentSpec(instrument), timeframe))
    : await safe(`Sütun ${selected}`, () => fetchIndexSeries(idx, timeframe));

  // 11 makro satırın hücreleri
  const cells: Record<string, CellResult> = {};
  for (const r of REFERENCES) {
    if (selected === r.symbol) {
      cells[r.symbol] = NA_CELL; // aynı sembol pay & payda (§11)
      continue;
    }
    const ref = refSeries[r.symbol];
    cells[r.symbol] = colSeries && ref ? computeCell(colSeries, ref, timeframe) : NA_CELL;
  }

  // Kendi-endeksi satırı (§3.2): enstrüman / parent endeks. Endeks seçiliyse —.
  let ownIndexCell: CellResult = NA_CELL;
  if (instrument && colSeries) {
    const parent = getIndex(instrument.parentIndex);
    if (parent) {
      const parentSeries = await safe(`Endeks ${parent.key}`, () =>
        fetchIndexSeries(parent, timeframe)
      );
      if (parentSeries) ownIndexCell = computeCell(colSeries, parentSeries, timeframe);
    }
  }

  // Skor bağlamı
  const score = await buildScore(
    idx,
    instrument,
    isIndex,
    selected,
    colSeries,
    cells,
    ownIndexCell,
    timeframe,
    safe
  );

  return {
    columnKey: idx.key,
    assetClass: idx.assetClass,
    selected,
    displayName,
    isIndex,
    parentIndexKey: idx.key,
    cells,
    ownIndexCell,
    score: score.result,
    scoreBroad: score.broad,
  };
}

async function buildScore(
  idx: IndexDef,
  instrument: Instrument | undefined,
  isIndex: boolean,
  selected: string,
  colSeries: Candle[] | null,
  cells: Record<string, CellResult>,
  ownIndexCell: CellResult,
  timeframe: Timeframe,
  safe: (label: string, fn: () => Promise<Candle[]>) => Promise<Candle[] | null>
) {
  const assetClass = idx.assetClass;
  const ctx: ScoreContext = {
    symbol: selected,
    assetClass,
    isIndex,
    timeframe,
    cells,
    ownIndexCell,
    // İYİLEŞTİRME 2 — rejim kapısı: sütunun kendi fiyat serisinin uzun SMA durumu.
    regime: colSeries ? regimeFromSeries(colSeries, timeframe) : undefined,
  };

  if (assetClass === 'stock') {
    const useBankRef = instrument?.scoreFlags?.useBankRef ?? false;
    ctx.useBankRef = useBankRef;
    if (useBankRef && colSeries) {
      const xbank = await safe('Endeks XBANK', () =>
        fetchIndexSeries(getIndex('XBANK')!, timeframe)
      );
      ctx.bankCell = xbank ? computeCell(colSeries, xbank, timeframe) : NA_CELL;
    }
  } else if (assetClass === 'commodity') {
    ctx.commodityKind = commodityKind(idx, instrument);
  } else if (assetClass === 'forex') {
    const fx = instrument?.fx ?? idx.fx;
    ctx.forexTrend = await forexSpreadTrend(fx, timeframe);
  }

  return { result: computeScore(ctx), broad: computeBroadScore(ctx) };
}

function commodityKind(idx: IndexDef, instrument?: Instrument): 'gold' | 'silver' | 'generic' {
  const sym = instrument ? instrument.symbol : idx.key;
  if (sym === 'XAUUSD' || sym === 'PRECIOUS') return 'gold';
  if (sym === 'XAGUSD') return 'silver';
  return 'generic';
}

// Forex getiri serileri sessizce çekilir: bazı ülke 10Y kaynakları (ölü OECD
// serileri) eksik olabilir; bu uyarı panelini doldurmamalı, skor sessizce NA olur.
async function quietFetch(fn: () => Promise<Candle[]>): Promise<Candle[] | null> {
  try {
    const s = await fn();
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

async function forexSpreadTrend(
  fx: { base: string; quote: string } | undefined,
  timeframe: Timeframe
): Promise<{ trendUp: boolean; na: boolean; deltaAbs?: number }> {
  if (!fx) return { trendUp: false, na: true };
  const baseY = FX_YIELDS[fx.base];
  const quoteY = FX_YIELDS[fx.quote];
  if (!baseY || !quoteY) return { trendUp: false, na: true };

  const [base, quote] = await Promise.all([
    quietFetch(() => fetchLeaf(baseY, timeframe)),
    quietFetch(() => fetchLeaf(quoteY, timeframe)),
  ]);
  if (!base || !quote) return { trendUp: false, na: true };

  const r = computeSpreadTrend(base, quote, timeframe);
  return { trendUp: r.trendUp, na: r.na, deltaAbs: r.deltaAbs };
}
