export function parsePaginationPage(url: URL): number | null {
  const rawPage = url.searchParams.get('page') ?? '1';
  if (!/^\d+$/.test(rawPage)) return null;
  const page = Number(rawPage);
  return Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000 ? page : null;
}

export function Pagination({
  page,
  total,
  pageSize,
  target,
  href,
  fetchHref,
}: {
  page: number;
  total: number;
  pageSize: number;
  target: string;
  href(page: number): string;
  fetchHref?(page: number): string;
}) {
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;

  return <nav className="pagination" aria-label="Pagination" data-pagination-target={target}
    data-pagination-fetch-current={fetchHref?.(page)}>
    {page > 1
      ? <a rel="prev" href={href(page - 1)} data-pagination-target={target}
        data-pagination-fetch-url={fetchHref?.(page - 1)}>← Previous</a>
      : <span />}
    <span className="muted">Page {page} of {pageCount}</span>
    {page < pageCount
      ? <a rel="next" href={href(page + 1)} data-pagination-target={target}
        data-pagination-fetch-url={fetchHref?.(page + 1)}>Next →</a>
      : <span />}
  </nav>;
}
