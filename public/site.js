(() => {
  const main = document.querySelector('#main-content');
  if (!main) return;

  window.addEventListener('load', () => {
    window.clearTimeout(window.__initialLoaderFallback);
    window.setTimeout(() => {
      document.documentElement.classList.remove('document-loading');
    }, 250);
  }, { once: true });

  let activeRequest;

  function loadingMarkup(pathname) {
    const playerPage = pathname.startsWith('/players/');
    const cotdPage = pathname.startsWith('/cotd/');
    const bars = playerPage
      ? '<div class="skeleton-grid"><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span></div><span class="skeleton skeleton-chart"></span>'
      : cotdPage
        ? '<span class="skeleton skeleton-heading"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-table"></span>'
        : '<span class="skeleton skeleton-heading"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-table"></span><span class="skeleton skeleton-line"></span>';
    return `<div class="loading-page" role="status" aria-label="Loading page">
      <span class="sr-only">Loading page…</span>${bars}
    </div>`;
  }

  async function navigate(url, push = true) {
    activeRequest?.abort();
    const controller = new AbortController();
    activeRequest = controller;
    document.body.dataset.loading = 'true';
    main.setAttribute('aria-busy', 'true');
    main.innerHTML = loadingMarkup(url.pathname);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/html', 'X-Requested-With': 'TM-Glicko-Navigation' },
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) throw new Error('Expected an HTML page response.');

      const documentText = await response.text();
      const nextDocument = new DOMParser().parseFromString(documentText, 'text/html');
      const nextContent = nextDocument.querySelector('#page-content');
      if (!nextContent) throw new Error('The requested page did not contain its main content.');

      main.innerHTML = nextContent.innerHTML;
      main.classList.remove('page-enter');
      void main.offsetWidth;
      main.classList.add('page-enter');
      main.removeAttribute('aria-busy');
      document.title = nextDocument.title;

      const destination = new URL(response.url);
      if (push) history.pushState({}, '', destination);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      window.location.assign(url.href);
    } finally {
      if (activeRequest === controller) {
        activeRequest = undefined;
        delete document.body.dataset.loading;
        main.removeAttribute('aria-busy');
      }
    }
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith('/assets/') || url.pathname === '/health') return;
    event.preventDefault();
    navigate(url);
  });

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() !== 'get') return;
    const url = new URL(form.action, window.location.href);
    if (url.origin !== window.location.origin) return;
    for (const [key, value] of new FormData(form).entries()) {
      url.searchParams.set(key, String(value));
    }
    event.preventDefault();
    navigate(url);
  });

  window.addEventListener('popstate', () => navigate(new URL(window.location.href), false));
})();
