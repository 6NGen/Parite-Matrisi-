# Göreceli Güç & Makro Likidite Matrisi — Proje Özeti

> Bu belge projenin **ne olduğunu, nasıl çalıştığını ve neden böyle tasarlandığını** baştan
> sona anlatır. İncelemeye (review) uygun, kendi kendine yeten bir dokümandır.

---

## 1. Proje nedir?

Tek ekranda dört varlık sınıfındaki (**Forex, Kripto, Emtia, Hisse**) enstrümanları, bakılması
gereken **makro/referans verilere göre** ölçen bir **ısı haritası matrisi**. Her enstrüman için
0–100 arası bir **güç skoru** ve buradan bir **AL/SAT sinyali** üretir.

**Temel felsefe:** Fiyatın kendisi yanıltıcıdır (enflasyon illüzyonu, dolar bazı etkisi vb.).
Bir enstrümanın gerçek gücü, **doğru referanslara karşı rölatif trendiyle** ölçülür. Örneğin
bir hisse TL bazında %50 artmış olabilir; ama dolar da %50 arttıysa o hisse aslında yerinde
saymıştır. Bu yüzden enstrümanı USDTRY'ye, faize, altına, kendi sektör endeksine **böleriz** ve
bu **oranın (parite) trendine** bakarız.

Bu sürümün ayırt edici özelliği: **Tüm sayılar canlı kaynaklardan gelir** (Yahoo Finance, FRED,
CoinGecko). Önceki prototipteki uydurma/placeholder değerler tamamen kaldırılmıştır.

---

## 2. Teknoloji yığını

- **Next.js 14 (App Router)** + **TypeScript** + **React 18**
- Tüm veri çekme ve hesaplama **sunucu tarafında** (route handler'lar). API anahtarları
  istemciye düşmez.
- **Vercel**'de yayınlanıyor. Veritabanı yok; sunucu tarafı **bellek-içi TTL cache** kullanılıyor
  (Supabase opsiyonel bırakıldı, kullanılmadı).
- Saf TypeScript hesaplama çekirdeği (harici hesap kütüphanesi yok).

---

## 3. Dosya yapısı

```
app/
  layout.tsx, globals.css        Kök layout + 6NGen blueprint estetiği (CSS)
  page.tsx                       Matris sayfası (force-dynamic)
  api/matrix/route.ts            Ana hesap uç noktası (POST/GET)
  api/news/route.ts              Haber akışı uç noktası (skora dahil DEĞİL)
components/
  Matrix.tsx                     İstemci matrisi: sticky başlıklar, filtreler,
                                 3 görünüm modu, zaman dilimi, skor modu, kırılım paneli
  News.tsx                       Gündem/katalizör paneli
lib/
  types.ts                       Paylaşılan tipler
  catalog.ts                     Endeks/enstrüman/referans kataloğu + sembol eşleme
  cache.ts                       Bellek-içi TTL cache
  align.ts                       Takvim hizalama & forward-fill resample
  calc.ts                        Rasyo → SMA kesişimi → CellResult; kanaat; rejim
  score.ts                       Odaklı + Geniş skorlama
  series.ts                      Leaf çekme + uçuş tekilleştirme + synthetic endeks
  matrix.ts                      Orkestrasyon: seçim → seriler → hücreler + skor
  sources/
    http.ts                      Ortak fetch (timeout + üstel backoff retry)
    yahoo.ts                     Yahoo Finance chart API
    fred.ts                      FRED (anahtarsız CSV veya anahtarlı JSON)
    coingecko.ts                 CoinGecko (fiyat + piyasa değeri)
    yahooNews.ts                 Yahoo haber başlıkları
```

---

## 4. Matris yapısı

### Sütunlar = Endeksler (4 ana başlık)
Her sütun başlığı bir **açılır filtredir**: varsayılan olarak endeksin kendisini gösterir,
açıldığında o endeksin **bileşen enstrümanlarını** listeler. Bir enstrüman seçilince o sütun
komple seçilen enstrümana döner ve hücreler yeniden hesaplanır.

| Ana Başlık | Endeksler (sütun) |
|---|---|
| **Forex** | DXY (majörler), TL Sepeti |
| **Kripto** | TOTAL, TOTAL2 (BTC hariç), TOTAL3 (BTC+ETH hariç) |
| **Emtia** | Kıymetli (XAU/XAG/XPT), Enerji (Brent/WTI/Natgas), Sanayi (Bakır/Alüminyum/Paladyum) |
| **Hisse** | XU100 + sektör endeksleri (XBANK, XELKT, XUTEK, XFINK, XUSIN, XGIDA, XKMYA, XMESY) |

### Satırlar = Makro/Referans bileşenler (sabit)
Bir enstrüman, bu satırların her birine **bölünerek** ölçülür.

| Sembol | Açıklama | Kaynak |
|---|---|---|
| USDTRY | Dolar/TL — reel değer / enflasyon filtresi | Yahoo `USDTRY=X` |
| US10Y | ABD 10Y tahvil faizi | Yahoo `^TNX` |
| US10YR | ABD reel faiz (10Y TIPS) — yalnızca gösterge | FRED `DFII10` |
| TR Faiz | Türkiye faizi — **güncel anahtarsız kaynak yok**, hücre "—" | (yok) |
| DXY | Dolar endeksi | Yahoo `DX-Y.NYB` |
| M2SL | ABD M2 para arzı — global likidite | FRED `M2SL` |
| WALCL | Fed bilançosu — likidite | FRED `WALCL` |
| XAUUSD / XAGUSD | Altın / Gümüş | Yahoo `GC=F` / `SI=F` |
| COPPER | Bakır — sanayi/resesyon sinyali | Yahoo `HG=F` |
| BRENT | Brent petrol | Yahoo `BZ=F` |
| NDX | Nasdaq 100 — risk iştahı | Yahoo `^NDX` |

Ayrıca matrisin en üstünde özel bir **"Kendi Endeksi"** satırı: seçilen enstrümanı **kendi parent
endeksine** böler (örn. AKFYE/XELKT). Sektörel para akışını gösterir.

Matrisin en altında sabit (sticky) **SKOR** ve **SİNYAL** satırları kaydırmadan görünür kalır.

---

## 5. Hücre hesaplama (calc.ts)

Her hücre = **sütundaki enstrüman / satırdaki referans** oranı. Enstrüman her zaman pay,
referans her zaman paydadır (yön asimetrisini ortadan kaldırır).

1. **Hizalama (align.ts):** İki seri ortak takvime **ileri-doldurma (forward-fill)** ile
   hizalanır. Frekans tuzağı çözülür: M2SL/WALCL haftalık/aylık yayınlanır; günlük fiyatla aynı
   orana sokulmadan önce günlük frekansa resample edilir.
2. **Trend (SMA kesişimi):** Rasyo serisinin kısa ve uzun SMA'sı karşılaştırılır.
   - Günlük: SMA20 vs SMA50 · Haftalık: SMA10 vs SMA30
   - `kısa > uzun` → enstrüman güçleniyor → **yeşil**; aksi → **kırmızı**.
   - `deltaPct = (kısaSMA / uzunSMA − 1) × 100` → ısı yoğunluğu.
3. **Kanaat (conviction) — oynaklığa göreli:** SMA boşluğu (birikmiş sürüklenme), rasyonun
   **kendi getiri oynaklığına** bölünür (z-skor benzeri sinyal/gürültü, `tanh` ile [0,1]'e
   sıkıştırılır). Böylece yüksek-oynaklıklı varlıklarda (BIST/kripto) "büyük ama sıradan"
   hareketler kanaati **doyurmaz**; sahte 100'ler önlenir. (Bu, prototipteki sabit % eşiğin
   yerini aldı — önemli bir kalibrasyon düzeltmesi.)
4. **Forex farkı:** Forex'te rasyo değil **faiz makası** (baz ülke 10Y − kotasyon ülke 10Y)
   trendine bakılır — ayrı kod yolu.

### Rejim kapısı (uzun vadeli filtre)
Enstrümanın **kendi fiyatı** yavaş SMA'sının (günlük 200 / haftalık 40) altındaysa (yapısal
düşüş), nihai skor **×0.6** ile kısılır. Böylece düşüş trendindeki kısa vadeli zıplama "GÜÇLÜ AL"
basamaz. UI'da `▽` işaretiyle gösterilir.

---

## 6. Skorlama (score.ts)

Matrisin tamamı **görsel panoramadır**; ama skor iki moddan biriyle hesaplanır (UI'da toggle):

### Odaklı Skor (varsayılan)
Sınıf için **anlamlı** referansların ağırlıklı alt kümesi:

| Sınıf | Kriterler (ağırlık) |
|---|---|
| **Hisse** | `/USDTRY` (40) · `/Sektör Endeksi` (40) · `/US10Y` (20) |
| **Kripto** | `/WALCL` veya `/M2SL` (50) · `/NDX` (50) |
| **Emtia – Altın** | `/US10Y` (50) · `/COPPER` (50) |
| **Emtia – Gümüş** | `/XAUUSD` (50) · `/COPPER` (50) |
| **Emtia – diğer** | `/US10Y` (50) · `/DXY` (50) |
| **Forex** | Faiz makası trendi (100) |

- Katkı = **ağırlık × kanaat** (ikili geç/kal değil, dereceli).
- Eksik (na) kriterler skora katılmaz; skor mevcut geçerli ağırlığa göre normalize edilir.
- Faizsiz finansman hisseleri (ör. KTLEV) 3. kriterde `/US10Y` yerine `/XBANK` kullanır.
- TR faizi kaynağı olmadığı için hisse makro kriteri **US10Y'ye düşer**.

### Geniş Skor
Matristeki **tüm** referans satırları (+ kendi endeksi) **eşit ağırlıkla**, kanaat ortalaması.
"Enstrüman tüm makro panele karşı ne kadar geniş ve güçlü yükselişte" sorusunu yanıtlar.

### Skor → Sinyal baremi
| Skor | Sinyal |
|---|---|
| ≥ 80 | **GÜÇLÜ AL** |
| 60–79 | KADEMELİ AL |
| 40–59 | NÖTR / BEKLE |
| 20–39 | KADEMELİ SAT |
| < 20 | **GÜÇLÜ SAT** |

SKOR hücresine **dokununca/tıklayınca** kriter kırılımı açılır: her kriterin ağırlığı, kanaat %'si,
yön ve rejim durumu.

---

## 7. Veri kaynakları ve synthetic endeksler

- **Yahoo Finance** (anahtarsız): BIST hisse/endeks (`.IS`), emtia vadelileri, DXY, ABD 10Y
  (`^TNX`), Nasdaq100, forex pariteleri, haber başlıkları.
- **FRED** (anahtarsız CSV; opsiyonel anahtarlı JSON): M2SL, WALCL, DFII10 (reel faiz).
- **CoinGecko** (free public): kripto coin fiyatları + piyasa değerleri.

**Synthetic (türetilmiş) endeksler:**
- **Kripto TOTAL/TOTAL2/TOTAL3** = bileşen coin'lerin **piyasa değeri toplamı** (TOTAL2 = BTC
  hariç, TOTAL3 = BTC+ETH hariç).
- **TL Sepeti & emtia grupları** = bileşenlerin normalize eşit-ağırlıklı ortalaması.
- **BIST sektör endeksleri** = Yahoo `XELKT.IS` vb. çoğu zaman boş/çok kısa seri döndürdüğü için,
  **bileşen hisselerinin ortalamasından** türetilir (gerçek seri yeterince uzunsa o kullanılır,
  değilse vekile düşülür). Böylece sektör kriteri her zaman hesaplanabilir.

**Önbellek/performans:** Benzersiz semboller bir kez çekilir, rasyolar bellekte hesaplanır.
Eşzamanlı çift istekler **uçuş tekilleştirme** ile önlenir. Kripto bileşenleri CoinGecko hız
limitini (429) azaltmak için **sırayla** çekilir.

---

## 8. Gündem / Katalizör akışı

Matrisin altında **ayrı** bir panel: seçili enstrümanlar için Yahoo haber başlıkları. Açıkça
**"skora dahil değildir"** etiketli — niteliksel haber, kantitatif sinyali kirletmeden yalnızca
**bağlam** verir. Bu, aracın "anlatıya değil rölatif trende bak" disiplinini korur.

---

## 9. Görünüm modları ve kontroller

- **Görünüm modu:** Parite Değeri · Değişim % · Isı Haritası (▲/▼).
- **Zaman dilimi:** Kısa Vade (Günlük) · Orta Vade (Haftalık) — SMA pencerelerini değiştirir.
- **Skor modu:** Odaklı · Geniş (üstte ve SKOR satırında geçiş).
- Sticky: sol başlık sütunu, üst kategori bandı + endeks başlıkları, alt SKOR/SİNYAL.
- Mobilde yatay kaydırma açık; SKOR/SİNYAL kaydırmadan görünür.

---

## 10. Geliştirme yolculuğu (özet)

Depo boş bir README ile başladı; uygulama sıfırdan kuruldu. Sonra canlı testte çıkan gerçek
sorunlar adım adım düzeltildi:

1. **İlk kurulum** — tam veri katmanı + hesap + UI.
2. **Sinyal kalitesi** — dereceli skor, rejim kapısı, gündem paneli.
3. **Reel faiz** satırı (gösterge).
4. **Oynaklığa-göreli kanaat** (sahte 100'leri önler), **mobil dokunmatik kırılım**, **US10Y
   ölçek hatası** (`^TNX` ÷10) düzeltmesi, kripto 429 azaltma.
5. **BIST sektör endeksleri** bileşenlerden türetildi (sektör kriteri boşluğu).
6. **Odaklı/Geniş** skor modu.
7. Cache sorunu (düz adres bayat HTML sunuyordu) → no-cache header + dinamik sayfa.
8. **TR faizi araştırması:** Stooq (Vercel'i blokluyor), FRED (404 veya 2008'de donmuş),
   TradingView (anahtarsız geçmiş API yok), Yahoo (TR 10Y yok) — kapsamlı teşhisle **anahtarsız
   güncel kaynak olmadığı** kanıtlandı; TR Faiz "—" + US10Y fallback olarak temizlendi.

---

## 11. Bilinen sınırlar / eksikler

- **TR faizi:** Anahtarsız, güncel, sunucudan erişilebilir bir Türkiye 10Y kaynağı **yok**.
  Satır "—" gösterir, hisse makro kriteri US10Y'ye düşer. Gerçek TR faizi için tek güvenilir yol
  **TCMB EVDS** (anahtarlı) — ileride `EVDS_API_KEY` + bir EVDS kaynağıyla eklenebilir.
- **Forex faiz makası:** Majör 10Y getirilerinde kullanılan bazı OECD serileri ölü olabilir;
  o forex sütunlarının skoru sessizce NÖTR/NA olur.
- **BIST sektör bileşen listeleri** temsilî bir alt kümedir; resmî tam üyelikle güncellenebilir.
- **CoinGecko free API** hız limiti (429) yoğun anlarda bazı kripto hücrelerini geçici "—"
  yapabilir ("Yenile" ile düzelir).
- Fiyatlar **gün sonu (günlük kapanış)** bazında — gün-içi (intraday) değil.
- **Yatırım tavsiyesi değildir**; analiz/araştırma aracıdır.

---

## 12. Çalıştırma / dağıtım

```bash
npm install
cp .env.example .env.local   # tüm anahtarlar opsiyonel
npm run dev                  # http://localhost:3000
npm run build && npm start   # üretim
npm run typecheck            # tip kontrolü
```

- Anahtarsız çalışır (Yahoo, FRED CSV, CoinGecko free).
- Sunucu `query1/2.finance.yahoo.com`, `fred.stlouisfed.org`, `api.coingecko.com` adreslerine
  erişebilmelidir.
- Vercel'de Git'e bağlanır; `main`'e her push otomatik deploy eder. Ana sayfa `no-cache` +
  `force-dynamic` olduğu için düz adres her zaman en güncel sürümü getirir.

---

## 13. İnceleme için olası sorular (review notları)

Bu projeyi gözden geçiren biri şunlara bakabilir:
- **Kanaat (conviction) kalibrasyonu:** `tanh(gap / (vol·√long))` ölçeklemesi makul mü? Sabitler
  (tam eşik, rejim ×0.6) deneysel; varlık sınıfına göre ayarlanabilir.
- **Skorlama ağırlıkları** sınıf bazlı sabit; veriye/araştırmaya göre rafine edilebilir.
- **Rejim kapısı** yalnızca yapısal düşüşte ceza uygular (asimetrik) — kasıtlı.
- **Geniş Skor** alakasız referansları da eşit ağırlık verir (gürültü riski) — bilinçli bir
  alternatif görünüm, varsayılan Odaklı.
- **Veri kaynağı kırılganlığı** (özellikle TR faizi ve bazı forex getirileri) en zayıf nokta;
  kalıcı çözüm anahtarlı resmî kaynaklar (TCMB EVDS) veya ücretli sağlayıcılar.
