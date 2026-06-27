// Ortak HTTP yardımcıları: timeout + basit retry (üstel bekleme).

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export async function fetchWithRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = 15000, retries = 3, headers } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; PariteMatrisi/1.0; +https://6ngen.dev)',
          Accept: 'application/json,text/csv,*/*',
          ...headers,
        },
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Geçici hata: HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await sleep(2 ** attempt * 500);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('İstek başarısız');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
