// Yahoo Finance arama uç noktasından haber başlıkları (anahtarsız).
// NOT: Haber akışı yalnızca BAĞLAMDIR — skora dahil edilmez (kullanıcı isteği).

import type { NewsItem } from '../types';
import { fetchWithRetry } from './http';

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

interface YahooSearch {
  news?: Array<{
    title?: string;
    publisher?: string;
    link?: string;
    providerPublishTime?: number; // saniye
  }>;
}

export async function fetchYahooNews(
  query: string,
  relatedSymbol: string,
  count = 6
): Promise<NewsItem[]> {
  const qs = `q=${encodeURIComponent(query)}&newsCount=${count}&quotesCount=0&enableFuzzyQuery=false`;
  let lastErr: unknown;
  for (const host of HOSTS) {
    const url = `https://${host}/v1/finance/search?${qs}`;
    try {
      const res = await fetchWithRetry(url, { timeoutMs: 12000, retries: 1 });
      if (!res.ok) throw new Error(`Yahoo News HTTP ${res.status}`);
      const json = (await res.json()) as YahooSearch;
      const items: NewsItem[] = [];
      for (const n of json.news ?? []) {
        if (!n.title || !n.link) continue;
        items.push({
          title: n.title,
          publisher: n.publisher,
          link: n.link,
          publishedAt: n.providerPublishTime ? n.providerPublishTime * 1000 : undefined,
          relatedSymbol,
        });
      }
      return items;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Yahoo News başarısız (${query})`);
}
