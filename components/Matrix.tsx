'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORIES } from '@/lib/catalog';
import type {
  CellResult,
  ColumnResult,
  MatrixResponse,
  MatrixSelection,
  Signal,
  Timeframe,
} from '@/lib/types';

type ViewMode = 'value' | 'change' | 'heat';

const VIEW_LABELS: Record<ViewMode, string> = {
  value: 'Parite Değeri',
  change: 'Değişim %',
  heat: 'Isı Haritası',
};

// CATEGORIES sırası API'deki columns sırasıyla birebir aynıdır (ALL_INDICES).
const FLAT_INDICES = CATEGORIES.flatMap((c) =>
  c.indices.map((idx) => ({ category: c, idx }))
);

const numFmt = new Intl.NumberFormat('tr-TR', { maximumSignificantDigits: 4 });

function formatRatio(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return numFmt.format(v);
}

function formatDelta(v: number): string {
  if (!Number.isFinite(v)) return '';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

function cellStyle(cell: CellResult): React.CSSProperties {
  if (cell.na) return {};
  const intensity = Math.min(0.85, 0.16 + Math.abs(cell.deltaPct) / 5);
  return cell.trendUp
    ? { background: `rgba(34,197,94,${intensity})` }
    : { background: `rgba(239,68,68,${intensity})` };
}

function signalClass(sig: Signal): string {
  switch (sig) {
    case 'GÜÇLÜ AL':
      return 'sig buy-strong';
    case 'KADEMELİ AL':
      return 'sig buy';
    case 'KADEMELİ SAT':
      return 'sig sell';
    case 'GÜÇLÜ SAT':
      return 'sig sell-strong';
    default:
      return 'sig neutral';
  }
}

function CellView({ cell, mode }: { cell: CellResult; mode: ViewMode }) {
  if (cell.na) {
    return <span className="cell na">—</span>;
  }
  if (mode === 'heat') {
    return (
      <span className="cell">
        <span className="arrow">{cell.trendUp ? '▲' : '▼'}</span>
      </span>
    );
  }
  if (mode === 'change') {
    return (
      <span className="cell num">
        {formatDelta(cell.deltaPct)}
      </span>
    );
  }
  return (
    <span className="cell num">
      {formatRatio(cell.ratioNow)}
      <span className="delta"> {formatDelta(cell.deltaPct)}</span>
    </span>
  );
}

export default function Matrix() {
  const [timeframe, setTimeframe] = useState<Timeframe>('daily');
  const [view, setView] = useState<ViewMode>('value');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sel: MatrixSelection[] = Object.entries(selections)
        .filter(([, instrument]) => instrument)
        .map(([indexKey, instrument]) => ({ indexKey, instrument }));
      const res = await fetch('/api/matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeframe, selections: sel }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as MatrixResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Veri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [timeframe, selections]);

  useEffect(() => {
    void load();
  }, [load]);

  const columnsByKey = useMemo(() => {
    const m = new Map<string, ColumnResult>();
    data?.columns.forEach((c) => m.set(c.columnKey, c));
    return m;
  }, [data]);

  const references = data?.references ?? [];

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1 className="app-title">Göreceli Güç &amp; Makro Likidite Matrisi</h1>
          <p className="app-sub">
            Her enstrüman, makro/referans satırlara bölünerek ölçülür. Yeşil = enstrüman
            o referansa karşı güçleniyor (rasyo SMA kesişimi yükselişte). SKOR yalnızca
            o sınıf için anlamlı referansların ağırlıklı alt kümesinden üretilir.
          </p>
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Zaman dilimi">
            <button
              className={timeframe === 'daily' ? 'active' : ''}
              onClick={() => setTimeframe('daily')}
            >
              Kısa Vade (Günlük)
            </button>
            <button
              className={timeframe === 'weekly' ? 'active' : ''}
              onClick={() => setTimeframe('weekly')}
            >
              Orta Vade (Haftalık)
            </button>
          </div>
          <div className="seg" role="group" aria-label="Görünüm modu">
            {(Object.keys(VIEW_LABELS) as ViewMode[]).map((m) => (
              <button key={m} className={view === m ? 'active' : ''} onClick={() => setView(m)}>
                {VIEW_LABELS[m]}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Yükleniyor…' : 'Yenile'}
          </button>
        </div>
      </header>

      <div className="status">
        {loading && <span className="spinner" />}
        {data && !loading && (
          <span>
            Güncellendi: {new Date(data.generatedAt).toLocaleString('tr-TR')} ·{' '}
            {data.columns.length} sütun · {references.length} referans satır
          </span>
        )}
        {error && <span style={{ color: '#b91c1c' }}>Hata: {error}</span>}
      </div>

      <div className="matrix-wrap" style={{ marginTop: 10 }}>
        <table className="matrix">
          <thead>
            <tr className="cat-band">
              <th className="corner" rowSpan={2}>
                Referans \ Enstrüman
              </th>
              {CATEGORIES.map((c) => (
                <th key={c.title} className={`cat-${c.assetClass}`} colSpan={c.indices.length}>
                  {c.title}
                </th>
              ))}
            </tr>
            <tr className="idx-head">
              {FLAT_INDICES.map(({ idx }) => (
                <th key={idx.key}>
                  <select
                    className="idx-select"
                    value={selections[idx.key] ?? idx.key}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSelections((prev) => ({
                        ...prev,
                        [idx.key]: v === idx.key ? '' : v,
                      }));
                    }}
                  >
                    <option value={idx.key}>{idx.displayName}</option>
                    {idx.constituents.map((c) => (
                      <option key={c.symbol} value={c.symbol}>
                        {c.symbol}
                        {c.displayName ? ` · ${c.displayName}` : ''}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* Kendi Endeksi satırı (§3.2) */}
            <tr className="own-row">
              <th className="row-head">
                Kendi Endeksi
                <span className="rh-sub">enstrüman / parent endeks</span>
              </th>
              {FLAT_INDICES.map(({ idx }) => {
                const col = columnsByKey.get(idx.key);
                const cell = col?.ownIndexCell ?? naCell();
                return (
                  <td key={idx.key} style={cellStyle(cell)}>
                    <CellView cell={cell} mode={view} />
                  </td>
                );
              })}
            </tr>

            {/* 11 makro referans satırı */}
            {references.map((r) => (
              <tr key={r.symbol}>
                <th className="row-head">
                  {r.symbol}
                  <span className="rh-sub">{r.displayName}</span>
                </th>
                {FLAT_INDICES.map(({ idx }) => {
                  const col = columnsByKey.get(idx.key);
                  const cell = col?.cells[r.symbol] ?? naCell();
                  return (
                    <td key={idx.key} style={cellStyle(cell)}>
                      <CellView cell={cell} mode={view} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="score-row">
              <th className="row-head">SKOR</th>
              {FLAT_INDICES.map(({ idx }) => {
                const col = columnsByKey.get(idx.key);
                return (
                  <td key={idx.key}>
                    <span className="num score-val">{col ? col.score.score : '—'}</span>
                  </td>
                );
              })}
            </tr>
            <tr className="signal-row">
              <th className="row-head">SİNYAL</th>
              {FLAT_INDICES.map(({ idx }) => {
                const col = columnsByKey.get(idx.key);
                return (
                  <td key={idx.key}>
                    {col ? <span className={signalClass(col.score.signal)}>{col.score.signal}</span> : '—'}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="legend">
        <span>
          <span className="swatch" style={{ background: 'rgba(34,197,94,0.7)' }} />
          Enstrüman güçleniyor (rasyo ↑)
        </span>
        <span>
          <span className="swatch" style={{ background: 'rgba(239,68,68,0.7)' }} />
          Enstrüman zayıflıyor (rasyo ↓)
        </span>
        <span>Renk yoğunluğu |Δ%| ile orantılı.</span>
        <span>SMA: {timeframe === 'daily' ? 'SMA20/SMA50 (günlük)' : 'SMA10/SMA30 (haftalık)'}</span>
      </div>

      {data && data.warnings.length > 0 && (
        <div className="warnings">
          <strong>Veri uyarıları ({data.warnings.length}):</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {data.warnings.slice(0, 30).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function naCell(): CellResult {
  return { ratioNow: NaN, deltaPct: 0, trendUp: false, na: true };
}
