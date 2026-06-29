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
  // Birincil kaynak başarısız olursa sırayla denenecek alternatif kaynaklar.
  // İlk veri döndüren kazanır.
  alternates?: { apiSource: ApiSource; apiSymbol: string; scale?: number }[];
  // Veri kaynağının bulunmaması beklenen referans (ör. anahtarsız güncel TR faizi
  // yok). Başarısızlıkta uyarı üretilmez; hücre sessizce "—" olur.
  optional?: boolean;
}

export interface CellResult {
  ratioNow: number;
  deltaPct: number; // (shortSMA/longSMA - 1) * 100
  trendUp: boolean;
  na: boolean;
  conviction?: number; // 0–1, oynaklığa-göreli kanaat (z-skor benzeri); skorlamada kullanılır
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
  conviction?: number; // 0–1, delta% büyüklüğünden türetilen kanaat (dereceli skor)
}

/** Uzun vadeli rejim kapısı: enstrümanın kendi fiyatının yavaş SMA'sına göre durumu. */
export interface RegimeInfo {
  up: boolean; // fiyat uzun SMA üstünde mi (yapısal yükseliş)
  deltaPct: number; // (fiyat / SMA_uzun - 1) * 100
  na: boolean;
  applied: boolean; // skora ceza uygulandı mı (yalnızca yapısal düşüşte)
}

/** Aşırı uzama (overextension): fiyatın uzun SMA'sından sapması, varlığın KENDİ
 *  geçmişine göre ne kadar olağandışı (z-skor). Yüksekse parabolik/tepe riski. */
export interface OverextInfo {
  z: number; // stretch z-skoru (varlığın kendi geçmişine göre)
  stretchPct: number; // (fiyat / uzunSMA - 1) * 100
  na: boolean;
  applied: boolean; // aşırı uzama cezası uygulandı mı
}

export interface ScoreResult {
  symbol: string;
  score: number; // 0–100 (rejim + aşırı uzama dampeneri uygulanmış nihai skor)
  rawScore?: number; // dampener öncesi skor (şeffaflık)
  signal: Signal;
  breakdown: ScoreBreakdownItem[];
  regime?: RegimeInfo;
  overext?: OverextInfo;
  na?: boolean; // hiç geçerli kriter yok (veri yok) → UI "—" gösterir, sinyal basmaz
}

export interface NewsItem {
  title: string;
  publisher?: string;
  link: string;
  publishedAt?: number; // ms
  relatedSymbol: string; // hangi sade sembol için çekildi
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
  score: ScoreResult; // ODAKLI skor (anlamlı referans alt kümesi)
  scoreBroad: ScoreResult; // GENİŞ skor (tüm satırlar eşit ağırlık)
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
