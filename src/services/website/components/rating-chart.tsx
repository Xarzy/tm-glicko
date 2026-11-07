import { renderToStaticMarkup } from 'react-dom/server';
import type { WebsitePlayerHistoryPoint } from '../data';
import type { RankThresholdBand } from '../../rankService';
import { formatRating } from '../html';

export function formatRatingChange(change: number | null): string {
  if (change === null) return '—';
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}`;
}

export function renderRatingChart(
  history: WebsitePlayerHistoryPoint[],
  bands: RankThresholdBand[] = [],
): string {
  return renderToStaticMarkup(<RatingChart history={history} bands={bands} />);
}

export function RatingChart({ history, bands }: { history: WebsitePlayerHistoryPoint[]; bands: RankThresholdBand[] }) {
  if (history.length === 0) return <p className="muted">No eligible rating history is available yet.</p>;
  const width = 900;
  const height = 360;
  const margin = { top: 24, right: 18, bottom: 38, left: 74 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = history.map(point => point.rating);
  const minimum = Math.max(0, Math.floor((Math.min(...values) - 40) / 100) * 100);
  const maximum = Math.ceil((Math.max(...values) + 40) / 100) * 100;
  const ratingRange = Math.max(1, maximum - minimum);
  const xAt = (index: number) => margin.left + (index / Math.max(1, history.length - 1)) * plotWidth;
  const yAt = (rating: number) => margin.top + plotHeight - ((rating - minimum) / ratingRange) * plotHeight;

  return <div className="chart-wrap"><svg className="block h-auto w-full rounded-xl bg-[#111720]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Rating history from ${history[0].cotdDate} to ${history[history.length - 1].cotdDate}`}>
    {bands.map(band => {
      const bandMinimum = Math.max(minimum, band.minRating);
      const bandMaximum = Math.min(maximum, band.maxRating);
      if (bandMaximum <= bandMinimum) return null;
      const y = yAt(bandMaximum);
      const bandHeight = yAt(bandMinimum) - y;
      if (bandHeight < 1) return null;
      return <g key={band.rank.code}>
        <rect x={margin.left} y={y} width={plotWidth} height={bandHeight} fill={band.rank.svgColor} fillOpacity="0.18" stroke={band.rank.svgColor} strokeOpacity="0.45" />
        <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke={band.rank.svgColor} strokeOpacity="0.9" strokeWidth="1.5" />
        {bandHeight >= 17 && <text x={margin.left + 7} y={y + 13} fill={band.rank.svgColor} fontSize="11" fontWeight="700">{band.rank.shortName}</text>}
      </g>;
    })}
    {Array.from({ length: Math.floor((maximum - minimum) / 100) + 1 }, (_, index) => {
      const rating = minimum + index * 100;
      const y = yAt(rating);
      return <g key={rating}>
        <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke="#26303c" strokeDasharray="3 4" />
        <text x={margin.left - 10} y={y + 4} fill="#9aa4b2" fontSize="12" textAnchor="end">{formatRating(rating)}</text>
      </g>;
    })}
    <path d={history.map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(1)} ${yAt(point.rating).toFixed(1)}`
    ).join(' ')} fill="none" stroke="#45c9b5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    {history.map((point, index) => <circle key={`${point.cupId}-${index}`} cx={xAt(index).toFixed(1)} cy={yAt(point.rating).toFixed(1)} r="5" fill="transparent" pointerEvents="all">
      <title>{`${point.cotdDate} · ${point.name} · rating ${formatRating(point.rating)} · change ${formatRatingChange(point.ratingChange)}`}</title>
    </circle>)}
    <line x1={margin.left} y1={margin.top + plotHeight} x2={width - margin.right} y2={margin.top + plotHeight} stroke="#354151" />
    <text x={margin.left} y={height - 10} fill="#a4afbd" fontSize="12">{history[0].cotdDate}</text>
    <text x={width - margin.right} y={height - 10} fill="#a4afbd" fontSize="12" textAnchor="end">{history[history.length - 1].cotdDate}</text>
  </svg></div>;
}
