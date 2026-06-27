'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NewsItem } from '@/lib/types';

// Haber akışı paneli — AYRI bölüm, skora dahil DEĞİL (yalnızca bağlam/katalizör).
export default function News({ symbols }: { symbols: string[] }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const key = symbols.join(',');

  const load = useCallback(async () => {
    if (symbols.length === 0) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/news?symbols=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: NewsItem[] };
      setItems(json.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Haberler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [key, symbols.length]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="news">
      <div className="news-head">
        <button className="news-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} Gündem / Katalizör Akışı
        </button>
        <span className="news-note">
          Yalnızca bağlam — <strong>skora dahil değildir</strong>.
        </span>
        <button className="btn news-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? 'Yükleniyor…' : 'Yenile'}
        </button>
      </div>

      {open && (
        <div className="news-body">
          {symbols.length === 0 && (
            <p className="news-empty">
              Bir sütunda enstrüman seç (örn. XBANK → AKBNK); o enstrümanlara ait
              başlıklar burada listelenir.
            </p>
          )}
          {error && <p className="news-empty">Hata: {error}</p>}
          {symbols.length > 0 && !loading && items.length === 0 && !error && (
            <p className="news-empty">Seçili enstrümanlar için başlık bulunamadı.</p>
          )}
          <ul className="news-list">
            {items.map((it) => (
              <li key={it.link}>
                <a href={it.link} target="_blank" rel="noopener noreferrer">
                  {it.title}
                </a>
                <span className="news-meta">
                  <span className="news-tag">{it.relatedSymbol}</span>
                  {it.publisher ? ` · ${it.publisher}` : ''}
                  {it.publishedAt
                    ? ` · ${new Date(it.publishedAt).toLocaleDateString('tr-TR')}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
