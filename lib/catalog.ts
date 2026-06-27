// Endeks / enstrüman / referans kataloğu ve sembol eşleme tablosu (§2, §8).
// Tüm sembol dönüşümleri burada yapılır; kullanıcı sade sembol görür.

import type { IndexDef, Instrument, ReferenceRow, AssetClass } from './types';

const stock = (
  symbol: string,
  parentIndex: string,
  displayName?: string,
  scoreFlags?: Instrument['scoreFlags']
): Instrument => ({
  symbol,
  displayName,
  assetClass: 'stock',
  parentIndex,
  apiSource: 'yahoo',
  apiSymbol: `${symbol}.IS`,
  scoreFlags,
});

const yahoo = (
  symbol: string,
  apiSymbol: string,
  assetClass: AssetClass,
  parentIndex: string,
  extra: Partial<Instrument> = {}
): Instrument => ({
  symbol,
  assetClass,
  parentIndex,
  apiSource: 'yahoo',
  apiSymbol,
  ...extra,
});

const coin = (
  symbol: string,
  id: string,
  parentIndex: string
): Instrument => ({
  symbol,
  assetClass: 'crypto',
  parentIndex,
  apiSource: 'coingecko',
  apiSymbol: id, // CoinGecko coin id
});

// ----------------------------------------------------------------------------
// SOL TARAF — 11 makro/referans satırı (§2.3)
// ----------------------------------------------------------------------------

export const REFERENCES: ReferenceRow[] = [
  { symbol: 'USDTRY', displayName: 'USD/TRY', kind: 'price', apiSource: 'yahoo', apiSymbol: 'USDTRY=X' },
  { symbol: 'US10Y', displayName: 'ABD 10Y', kind: 'rate', apiSource: 'yahoo', apiSymbol: '^TNX', scale: 0.1 },
  { symbol: 'TR10Y', displayName: 'TR 10Y', kind: 'rate', apiSource: 'fred', apiSymbol: 'IRLTLT01TRM156N' },
  { symbol: 'DXY', displayName: 'Dolar Endeksi', kind: 'price', apiSource: 'yahoo', apiSymbol: 'DX-Y.NYB' },
  { symbol: 'M2SL', displayName: 'ABD M2', kind: 'money', apiSource: 'fred', apiSymbol: 'M2SL' },
  { symbol: 'WALCL', displayName: 'Fed Bilançosu', kind: 'money', apiSource: 'fred', apiSymbol: 'WALCL' },
  { symbol: 'XAUUSD', displayName: 'Altın', kind: 'price', apiSource: 'yahoo', apiSymbol: 'GC=F' },
  { symbol: 'XAGUSD', displayName: 'Gümüş', kind: 'price', apiSource: 'yahoo', apiSymbol: 'SI=F' },
  { symbol: 'COPPER', displayName: 'Bakır', kind: 'price', apiSource: 'yahoo', apiSymbol: 'HG=F' },
  { symbol: 'BRENT', displayName: 'Brent', kind: 'price', apiSource: 'yahoo', apiSymbol: 'BZ=F' },
  { symbol: 'NDX', displayName: 'Nasdaq 100', kind: 'price', apiSource: 'yahoo', apiSymbol: '^NDX' },
];

// ----------------------------------------------------------------------------
// FOREX faiz makası için ülke/para 10Y getiri kaynakları (§5.2 forex).
// ----------------------------------------------------------------------------

export const FX_YIELDS: Record<string, { apiSource: 'fred' | 'yahoo'; apiSymbol: string; scale?: number }> = {
  USD: { apiSource: 'yahoo', apiSymbol: '^TNX', scale: 0.1 },
  TRY: { apiSource: 'fred', apiSymbol: 'IRLTLT01TRM156N' },
  EUR: { apiSource: 'fred', apiSymbol: 'IRLTLT01EZM156N' },
  GBP: { apiSource: 'fred', apiSymbol: 'IRLTLT01GBM156N' },
  JPY: { apiSource: 'fred', apiSymbol: 'IRLTLT01JPM156N' },
  CHF: { apiSource: 'fred', apiSymbol: 'IRLTLT01CHM156N' },
};

// ----------------------------------------------------------------------------
// SÜTUNLAR — endeksler (§2.2)
// ----------------------------------------------------------------------------

// --- FOREX ---
const DXY: IndexDef = {
  key: 'DXY',
  displayName: 'DXY (Majörler)',
  assetClass: 'forex',
  apiSource: 'yahoo',
  apiSymbol: 'DX-Y.NYB',
  fx: { base: 'USD', quote: 'EUR' }, // endeks seviyesinde USD gücü temsili
  constituents: [
    yahoo('EURUSD', 'EURUSD=X', 'forex', 'DXY', { fx: { base: 'EUR', quote: 'USD' } }),
    yahoo('GBPUSD', 'GBPUSD=X', 'forex', 'DXY', { fx: { base: 'GBP', quote: 'USD' } }),
    yahoo('USDJPY', 'USDJPY=X', 'forex', 'DXY', { fx: { base: 'USD', quote: 'JPY' } }),
    yahoo('USDCHF', 'USDCHF=X', 'forex', 'DXY', { fx: { base: 'USD', quote: 'CHF' } }),
  ],
};

const TRYBASKET: IndexDef = {
  key: 'TRYBASKET',
  displayName: 'TL Sepeti',
  assetClass: 'forex',
  apiSource: 'synthetic',
  apiSymbol: 'TRYBASKET',
  fx: { base: 'USD', quote: 'TRY' },
  synthetic: { method: 'avg' },
  constituents: [
    yahoo('USDTRY', 'USDTRY=X', 'forex', 'TRYBASKET', { fx: { base: 'USD', quote: 'TRY' } }),
    yahoo('EURTRY', 'EURTRY=X', 'forex', 'TRYBASKET', { fx: { base: 'EUR', quote: 'TRY' } }),
    yahoo('GBPTRY', 'GBPTRY=X', 'forex', 'TRYBASKET', { fx: { base: 'GBP', quote: 'TRY' } }),
  ],
};

// --- KRİPTO ---
const cryptoCoins = (parent: string): Instrument[] => [
  coin('BTC', 'bitcoin', parent),
  coin('ETH', 'ethereum', parent),
  coin('BNB', 'binancecoin', parent),
  coin('SOL', 'solana', parent),
  coin('XRP', 'ripple', parent),
  coin('ADA', 'cardano', parent),
  coin('AVAX', 'avalanche-2', parent),
];

const TOTAL: IndexDef = {
  key: 'TOTAL',
  displayName: 'TOTAL (Tüm Piyasa)',
  assetClass: 'crypto',
  apiSource: 'synthetic',
  apiSymbol: 'TOTAL',
  synthetic: { method: 'mcapSum' },
  constituents: cryptoCoins('TOTAL'),
};

const TOTAL2: IndexDef = {
  key: 'TOTAL2',
  displayName: 'TOTAL2 (BTC hariç)',
  assetClass: 'crypto',
  apiSource: 'synthetic',
  apiSymbol: 'TOTAL2',
  synthetic: { method: 'mcapSum', exclude: ['BTC'] },
  constituents: cryptoCoins('TOTAL2'),
};

const TOTAL3: IndexDef = {
  key: 'TOTAL3',
  displayName: 'TOTAL3 (BTC+ETH hariç)',
  assetClass: 'crypto',
  apiSource: 'synthetic',
  apiSymbol: 'TOTAL3',
  synthetic: { method: 'mcapSum', exclude: ['BTC', 'ETH'] },
  constituents: cryptoCoins('TOTAL3'),
};

// --- EMTİA ---
const PRECIOUS: IndexDef = {
  key: 'PRECIOUS',
  displayName: 'Kıymetli',
  assetClass: 'commodity',
  apiSource: 'synthetic',
  apiSymbol: 'PRECIOUS',
  synthetic: { method: 'avg' },
  constituents: [
    yahoo('XAUUSD', 'GC=F', 'commodity', 'PRECIOUS', { displayName: 'Altın' }),
    yahoo('XAGUSD', 'SI=F', 'commodity', 'PRECIOUS', { displayName: 'Gümüş' }),
    yahoo('XPTUSD', 'PL=F', 'commodity', 'PRECIOUS', { displayName: 'Platin' }),
  ],
};

const ENERGY: IndexDef = {
  key: 'ENERGY',
  displayName: 'Enerji',
  assetClass: 'commodity',
  apiSource: 'synthetic',
  apiSymbol: 'ENERGY',
  synthetic: { method: 'avg' },
  constituents: [
    yahoo('BRENT', 'BZ=F', 'commodity', 'ENERGY'),
    yahoo('WTI', 'CL=F', 'commodity', 'ENERGY'),
    yahoo('NATGAS', 'NG=F', 'commodity', 'ENERGY'),
  ],
};

const INDUSTRIAL: IndexDef = {
  key: 'INDUSTRIAL',
  displayName: 'Sanayi',
  assetClass: 'commodity',
  apiSource: 'synthetic',
  apiSymbol: 'INDUSTRIAL',
  synthetic: { method: 'avg' },
  constituents: [
    yahoo('COPPER', 'HG=F', 'commodity', 'INDUSTRIAL', { displayName: 'Bakır' }),
    yahoo('ALUMIN', 'ALI=F', 'commodity', 'INDUSTRIAL', { displayName: 'Alüminyum' }),
    yahoo('PALLAD', 'PA=F', 'commodity', 'INDUSTRIAL', { displayName: 'Paladyum' }),
  ],
};

// --- HİSSE (BIST) ---
const stockIndex = (
  key: string,
  displayName: string,
  constituents: Instrument[]
): IndexDef => ({
  key,
  displayName,
  assetClass: 'stock',
  apiSource: 'yahoo',
  apiSymbol: `${key}.IS`,
  constituents,
});

const XU100: IndexDef = stockIndex('XU100', 'XU100 (Tüm Pazar)', [
  stock('THYAO', 'XU100'),
  stock('ASELS', 'XU100'),
  stock('KCHOL', 'XU100'),
  stock('SISE', 'XU100'),
  stock('FROTO', 'XU100'),
]);

const XBANK: IndexDef = stockIndex('XBANK', 'XBANK (Banka)', [
  stock('AKBNK', 'XBANK'),
  stock('GARAN', 'XBANK'),
  stock('YKBNK', 'XBANK'),
  stock('ISCTR', 'XBANK'),
  stock('VAKBN', 'XBANK'),
]);

const XELKT: IndexDef = stockIndex('XELKT', 'XELKT (Elektrik)', [
  stock('AKFYE', 'XELKT'),
  stock('AKSEN', 'XELKT'),
  stock('ZOREN', 'XELKT'),
  stock('AYDEM', 'XELKT'),
  stock('ENJSA', 'XELKT'),
]);

const XUTEK: IndexDef = stockIndex('XUTEK', 'XUTEK (Teknoloji)', [
  stock('ONRYT', 'XUTEK'),
  stock('ASELS', 'XUTEK'),
  stock('LOGO', 'XUTEK'),
  stock('NETAS', 'XUTEK'),
  stock('KAREL', 'XUTEK'),
]);

const XFINK: IndexDef = stockIndex('XFINK', 'XFINK (Finansal Kiralama/Faktoring)', [
  stock('KTLEV', 'XFINK', undefined, { useBankRef: true }),
  stock('ISFIN', 'XFINK'),
  stock('GARFA', 'XFINK'),
  stock('LIDFA', 'XFINK'),
]);

const XUSIN: IndexDef = stockIndex('XUSIN', 'XUSIN (Sınai)', [
  stock('EREGL', 'XUSIN'),
  stock('TOASO', 'XUSIN'),
  stock('TUPRS', 'XUSIN'),
  stock('ARCLK', 'XUSIN'),
  stock('FROTO', 'XUSIN'),
]);

const XGIDA: IndexDef = stockIndex('XGIDA', 'XGIDA (Gıda)', [
  stock('ULKER', 'XGIDA'),
  stock('CCOLA', 'XGIDA'),
  stock('AEFES', 'XGIDA'),
  stock('TUKAS', 'XGIDA'),
]);

const XKMYA: IndexDef = stockIndex('XKMYA', 'XKMYA (Kimya)', [
  stock('PETKM', 'XKMYA'),
  stock('SASA', 'XKMYA'),
  stock('GUBRF', 'XKMYA'),
  stock('BAGFS', 'XKMYA'),
]);

const XMESY: IndexDef = stockIndex('XMESY', 'XMESY (Metal Eşya/Makine)', [
  stock('VESTL', 'XMESY'),
  stock('ARCLK', 'XMESY'),
  stock('KARSN', 'XMESY'),
  stock('OTKAR', 'XMESY'),
]);

// ----------------------------------------------------------------------------
// Ana başlıklar → endeks grupları
// ----------------------------------------------------------------------------

export interface CategoryGroup {
  assetClass: AssetClass;
  title: string;
  indices: IndexDef[];
}

export const CATEGORIES: CategoryGroup[] = [
  { assetClass: 'forex', title: 'Forex', indices: [DXY, TRYBASKET] },
  { assetClass: 'crypto', title: 'Kripto', indices: [TOTAL, TOTAL2, TOTAL3] },
  { assetClass: 'commodity', title: 'Emtia', indices: [PRECIOUS, ENERGY, INDUSTRIAL] },
  {
    assetClass: 'stock',
    title: 'Hisse',
    indices: [XU100, XBANK, XELKT, XUTEK, XFINK, XUSIN, XGIDA, XKMYA, XMESY],
  },
];

export const ALL_INDICES: IndexDef[] = CATEGORIES.flatMap((c) => c.indices);

export function getIndex(key: string): IndexDef | undefined {
  return ALL_INDICES.find((i) => i.key === key);
}

export function getInstrument(indexKey: string, symbol: string): Instrument | undefined {
  const idx = getIndex(indexKey);
  return idx?.constituents.find((c) => c.symbol === symbol);
}

export function getXbankSymbol(): string {
  return 'XBANK';
}

/** Sade sembolden enstrümanı bul (tüm endekslerin bileşenlerinde ara). */
export function findInstrumentBySymbol(symbol: string): Instrument | undefined {
  for (const idx of ALL_INDICES) {
    const found = idx.constituents.find((c) => c.symbol === symbol);
    if (found) return found;
  }
  return undefined;
}

/** Bir sembol için Yahoo haber arama sorgusunu üret. */
export function newsQueryFor(symbol: string): string {
  const idx = getIndex(symbol);
  if (idx) {
    // Endeks: BIST endeksi ise .IS sorgusu, değilse görünen adı.
    return idx.assetClass === 'stock' ? `${symbol}.IS` : idx.displayName;
  }
  const inst = findInstrumentBySymbol(symbol);
  if (!inst) return symbol;
  if (inst.assetClass === 'stock') return `${symbol}.IS`;
  if (inst.assetClass === 'crypto') return `${symbol}-USD`;
  return symbol;
}
