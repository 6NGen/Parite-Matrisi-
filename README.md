# Göreceli Güç & Makro Likidite Matrisi — Canlı Veri Sürümü

Forex, Kripto, Emtia ve Hisse enstrümanlarını **makro/referans verilere göre** ölçen,
her enstrüman için 0–100 **güç skoru** ve **AL/SAT sinyali** üreten ısı haritası matrisi.

> Temel felsefe: Fiyatın kendisi yanıltıcıdır (enflasyon illüzyonu, dolar bazı etkisi).
> Bir enstrümanın gerçek gücü, **doğru referanslara karşı rölatif trendiyle** ölçülür.

Bu sürümdeki tüm sayısal değerler **canlı kaynaklardan** (Yahoo Finance, FRED, CoinGecko)
çekilir — prototipteki uydurma placeholder değerler kaldırılmıştır.

## Mimari

```
app/
  page.tsx              Matris sayfası (Matrix bileşenini render eder)
  layout.tsx, globals.css
  api/matrix/route.ts   Sunucu uç noktası — tüm veri çekme & hesap burada (anahtarlar istemciye düşmez)
components/
  Matrix.tsx            İstemci matrisi: sticky başlıklar, açılır filtreler, 3 görünüm modu, zaman dilimi
lib/
  types.ts              Paylaşılan tipler (§7)
  catalog.ts            Endeks/enstrüman/referans kataloğu + sembol eşleme (§2, §8)
  cache.ts              Bellek-içi TTL cache (§9)
  align.ts              Takvim hizalama & forward-fill resample (§6)
  calc.ts               Rasyo → SMA kesişimi → CellResult (§3)
  score.ts              Sınıfa göre ağırlıklı skorlama (§5)
  series.ts             Leaf çekme + uçuş tekilleştirme + synthetic endeks (avg / mcapSum)
  matrix.ts             Orkestrasyon: seçim → seriler → hücreler + skor
  sources/
    yahoo.ts, fred.ts, coingecko.ts, http.ts
```

### Veri akışı
1. `buildMatrix(selections, timeframe)` benzersiz sembolleri belirler.
2. 11 makro referans + her sütun serisi **bir kez** çekilir (cache + uçuş tekilleştirme).
3. Seriler ortak takvime **forward-fill** ile hizalanır (M2SL/WALCL haftalık → günlük resample).
4. Her hücre: `enstrüman / referans` rasyosu → `SMA(kısa)` vs `SMA(uzun)` kesişimi → yön + |Δ%|.
5. Skor: sınıfa göre anlamlı referansların ağırlıklı alt kümesi; eksik kriterler normalize edilir.

### Hesap kuralları
- **Trend:** Günlük SMA20/SMA50, Haftalık SMA10/SMA30. `short > long` → enstrüman güçleniyor (yeşil).
- **Yön (asimetri çözümü):** Enstrüman her zaman pay. `enstrüman/referans ↑` → +puan (§5.1).
- **Skor baremi:** ≥80 GÜÇLÜ AL · 60–79 KADEMELİ AL · 40–59 NÖTR · 20–39 KADEMELİ SAT · <20 GÜÇLÜ SAT.
- **Forex:** rasyo değil **faiz makası** (baz 10Y − kotasyon 10Y) trendi — ayrı kod yolu.

### Sinyal kalitesi iyileştirmeleri
1. **Dereceli + oynaklığa-göreli skor:** Kriter katkısı ikili (geç/kal) değil; **kanaat [0–1]**
   ile ağırlıklanır. Kanaat, SMA boşluğunu (birikmiş sürüklenme) rasyonun **kendi getiri
   oynaklığına** böler (z-skor benzeri sinyal/gürültü, `convictionFromRatio`). Böylece
   yüksek-oynaklıklı varlık (BIST/kripto) büyük ama sıradan hareketlerde **doymaz**; sahte
   100'ler önlenir. (Sabit-eşikli `convictionFromDelta` yedek olarak kalır.)
2. **Uzun vadeli rejim kapısı:** Enstrümanın kendi fiyatı yavaş SMA'sının (günlük 200,
   haftalık 40) altındaysa (yapısal düşüş) skor `×0.6` ile kısılır (`regimeFromSeries`).
   UI'da `▽` işareti ve SKOR tooltip'inde gösterilir. Yapısal düşüşte kısa vadeli
   zıplamanın "GÜÇLÜ AL" üretmesini engeller.
3. **Hisse makro referansı TR10Y:** BIST hisseleri için makro baskı kriteri (20 puan)
   US10Y yerine **TR10Y** (Türk varlığına daha doğrudan); TR10Y verisi yoksa US10Y'ye düşer.

SKOR hücresinin üzerine gelince kriter kırılımı, her kriterin kanaat yüzdesi, ham skor ve
rejim durumu tooltip olarak görünür.

## Skorlama ağırlıkları (§5.2)
| Sınıf | Kriterler |
|---|---|
| Hisse | `/USDTRY` (40) · `/sektör endeksi` (40) · `/US10Y` (20, faizsiz finansman: `/XBANK`) |
| Kripto | `/WALCL` veya `/M2SL` (50) · `/NDX` (50) |
| Emtia – Altın | `/US10Y` (50) · `/COPPER` (50) |
| Emtia – Gümüş | `/XAUUSD` (50) · `/COPPER` (50) |
| Emtia – diğer | `/US10Y` (50) · `/DXY` (50) |
| Forex | Faiz makası trendi (100) |

> Hisse makro kriteri TR10Y kullanır (yoksa US10Y). Tüm kriterler dereceli kanaatle
> ağırlıklanır ve nihai skora uzun vadeli rejim kapısı uygulanır.

## Gündem / Katalizör akışı
Matrisin altında **ayrı** bir panel: seçili enstrümanlar için Yahoo haber başlıkları
(`/api/news`). **Skora dahil değildir** — yalnızca bağlam/katalizör. Bu, aracın
"anlatıya değil rölatif trende bak" disiplinini bozmadan haber bilgisini sağlar.

## Kurulum

```bash
npm install
cp .env.example .env.local   # tüm anahtarlar opsiyonel
npm run dev                  # http://localhost:3000
```

Anahtarsız çalışır: Yahoo (anahtarsız), FRED (anahtarsız `fredgraph.csv`), CoinGecko (free public).
İsteğe bağlı `.env.local` ayarları için `.env.example` dosyasına bakın.

> **Ağ notu:** Uygulama `query1/2.finance.yahoo.com`, `fred.stlouisfed.org` ve
> `api.coingecko.com` adreslerine sunucu tarafından erişebilmelidir. Kısıtlı ağ
> politikalarında bu hostlara izin verilmelidir.

## Komutlar
- `npm run dev` — geliştirme sunucusu
- `npm run build` / `npm start` — üretim derlemesi
- `npm run typecheck` — tip kontrolü

## Veri kaynakları (§8)
| Tip | Kaynak | Örnek |
|---|---|---|
| BIST hisse/endeks | Yahoo | `AKFYE.IS`, `XU100.IS` |
| ABD 10Y | Yahoo `^TNX` (÷10) | |
| ABD Reel Faiz (10Y TIPS) | FRED `DFII10` | ek gösterge satırı, skora dahil değil |
| TR/EUR/GBP/JPY/CHF 10Y | FRED (OECD uzun vadeli faiz) | aylık → resample |
| M2 / Fed bilançosu | FRED | `M2SL`, `WALCL` |
| Emtia | Yahoo futures | `GC=F`, `SI=F`, `HG=F`, `BZ=F` |
| Kripto coin | CoinGecko | `bitcoin`, `ethereum` … |
| Kripto TOTAL/2/3 | CoinGecko piyasa değeri toplamı | bileşenlerin mcap toplamı |

> Kripto TOTAL ailesi, bileşen coin'lerin **piyasa değeri toplamından** türetilir
> (TOTAL2 = BTC hariç, TOTAL3 = BTC+ETH hariç). TL sepeti ve emtia grup endeksleri
> bileşenlerin normalize ortalamasıdır.

## Bilinen veri sorunları
- **TR10Y (FRED `IRLTLT01TRM156N`) artık 404 dönüyor** (OECD MEI serisi kaldırılmış).
  Uygulama bunu zarifçe ele alır: TR10Y hücresi `—`, hisse makro kriteri otomatik US10Y'ye
  düşer. Anahtarsız güvenilir bir Türkiye 10Y günlük kaynağı bulunana kadar bu geçici.
- **Kripto TOTAL/2/3** CoinGecko free API hız limitine (HTTP 429) takılabilir; coin'ler artık
  sırayla çekilir (burst azaltma) ve cache'lenir, ama yoğun anlarda bazı hücreler geçici `—`
  olabilir — "Yenile" ile düzelir.
- `^TNX` zaten yüzde geldiği için eski `÷10` ölçeği kaldırıldı (US10Y ve forex faiz makası
  artık doğru birimde).

## Notlar / Bilinen sınırlar
- BIST sektör endeksi bileşen listeleri (`catalog.ts`) temsilî bir alt kümedir; gerçek
  bileşenlerle güncellenebilir.
- CoinGecko free API geçmiş veride gün bazlı çözünürlük ve oran limitleri uygular.
- Cache bellek-içidir; çok örnekli dağıtımda Supabase/Redis cache eklenebilir (`cache.ts`
  arayüzü buna uygundur). İlgili `.env` değişkenleri `.env.example` içinde ayrılmıştır.
