import type { SelectCotdDay } from '../../../db/schema';

export function CotdList({ days, compact = false }: { days: SelectCotdDay[]; compact?: boolean }) {
  return <section className="panel">
    <h2>{compact ? 'Recent COTDs' : 'Recent Cup of the Day results'}</h2>
    {days.length
      ? <ul className="list">{days.map(day => <li key={day.cupId}>
        <a href={`/cotd/${day.cupId}`}>{day.name}</a>
        <span className="muted"> · {day.cotdDate} · {(day.cardinal ?? 0).toLocaleString('en-US')} players</span>
      </li>)}</ul>
      : <p className="muted">No processed COTD results are available yet.</p>}
  </section>;
}
