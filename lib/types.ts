// Tüm uygulama genelinde paylaşılan tip tanımları (§7).

export type AssetClass = 'forex' | 'crypto' | 'commodity' | 'stock';
export type Timeframe = 'daily' | 'weekly';
export type ApiSource = 'yahoo' | 'fred' | 'coingecko' | 'synthetic';

/** Bir referans/enstrüman serisinin yorumlanma biçimi. */
export type SeriesKind = 'price' | 'rate' | 'money';

export interface Candle {
  t: number; // gün başlangıcı (UTC, ms)
  close: number;
}

export interface PriceSeries {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[]; // hizalanmış, resample edilmiş, artan zaman
}

/** Sütunlardaki bir endeksin içindeki tekil enstrüman. */
export interface Instrument {
  symbol: string; // sade kullanıcı sembolü, ör. "AKFYE"
  displayName?: string;
  assetClass: AssetClass;
  parentIndex: string; // ör. "XELKT"
  apiSource: ApiSource;
  apiSymbol: string; // kaynak sembolü, ör. "AKFYE.IS"
  scale?: number; // ham değeri çarpan (ör. ^TNX için 0.1)
  /** Forex enstrümanları için faiz makası tarafları (currency kodları). */
  fx?: { base: string; quote: string };
  /** Skorlama özel bayrakları (ör. faizsiz finansman hissesi → /XBANK). */
  scoreFlags?: { useBankRef?: boolean };
}

/** Sütun başlığı = endeks. Açıldığında constituents listelenir. */
export interface IndexDef {
  key: string; // "XELKT"
  displayName: string;
  assetClass: AssetClass;
  apiSource: ApiSource;
  apiSymbol: string; // endeksin kendi serisi (synthetic ise türetilir)
  scale?: number;
  constituents: Instrument[];
  fx?: { base: string; quote: string };
  /** Synthetic endeks ise nasıl türetileceği. */
  synthetic?: SyntheticDef;
}

export interface SyntheticDef {
  // 'avg' → constituent fiyatlarının eşit-ağırlıklı normalize ortalaması
  // 'mcapSum' → constituent piyasa değerlerinin toplamı (kripto TOTAL ailesi)
  method: 'avg' | 'mcapSum';
  // mcapSum için hariç tutulacak constituent sembolleri (TOTAL2/TOTAL3)
  exclude?: string[];
}

/** Sol taraftaki sabit makro/referans satırı. */
export interface ReferenceRow {
  symbol: string; // "USDTRY", "US10Y" ...
  displayName: string;
  kind: SeriesKind;
  apiSource: ApiSource;
  apiSymbol: string;
  scale?: number;
}

export interface CellResult {
  ratioNow: number;
  deltaPct: number; // (shortSMA/longSMA - 1) * 100
  trendUp: boolean;
  na: boolean;
}

export type Signal =
  | 'GÜÇLÜ AL'
  | 'KADEMELİ AL'
  | 'NÖTR'
  | 'KADEMELİ SAT'
  | 'GÜÇLÜ SAT';

export interface ScoreBreakdownItem {
  ref: string;
  weight: number;
  passed: boolean;
  na?: boolean;
}

export interface ScoreResult {
  symbol: string;
  score: number; // 0–100
  signal: Signal;
  breakdown: ScoreBreakdownItem[];
}

/** Bir sütunun tüm satırlara karşı hücreleri + skoru. */
export interface ColumnResult {
  columnKey: string; // endeks key veya seçilen enstrüman sembolü
  assetClass: AssetClass;
  selected: string; // gösterilen sembol (endeks ya da seçilen enstrüman)
  displayName: string;
  isIndex: boolean; // endeksin kendisi mi seçili
  parentIndexKey: string;
  cells: Record<string, CellResult>; // referans symbol -> hücre
  ownIndexCell: CellResult; // enstrüman / parent endeks (§3.2)
  score: ScoreResult;
}

export interface MatrixResponse {
  timeframe: Timeframe;
  generatedAt: number;
  references: ReferenceRow[];
  columns: ColumnResult[];
  warnings: string[];
}

/** İstemciden gelen istek: her endeks için seçilen sütun. */
export interface MatrixSelection {
  indexKey: string;
  // seçilen enstrüman sembolü; boş/endeks key ise endeksin kendisi
  instrument?: string;
}
