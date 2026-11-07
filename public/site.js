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

  async function copyPageLink(button) {
    const label = button.querySelector('[data-copy-page-label]');
    const status = button.parentElement?.querySelector('[data-copy-page-status]');
    if (!(label instanceof HTMLElement) || !(status instanceof HTMLElement)) return;

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(window.location.href);
      label.textContent = 'Copied!';
      status.textContent = 'Profile link copied to clipboard.';
      button.dataset.copyState = 'copied';
    } catch {
      label.textContent = 'Copy failed';
      status.textContent = 'Could not copy the link. Copy it from your browser address bar.';
      button.dataset.copyState = 'error';
    }

    window.setTimeout(() => {
      label.textContent = 'Share profile';
      button.dataset.copyState = '';
    }, 2500);
  }

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

  async function navigate(url, push = true, reloadOnFailure = true, paginationTarget, requestUrl = url) {
    activeRequest?.abort();
    const controller = new AbortController();
    activeRequest = controller;
    const currentTarget = paginationTarget
      ? main.querySelector(`[data-pagination-content="${paginationTarget}"]`)
      : null;
    if (paginationTarget && !currentTarget) {
      if (reloadOnFailure) window.location.assign(url.href);
      return;
    }

    if (currentTarget) {
      currentTarget.setAttribute('aria-busy', 'true');
    } else {
      document.body.dataset.loading = 'true';
      main.setAttribute('aria-busy', 'true');
      main.innerHTML = loadingMarkup(url.pathname);
    }

    try {
      const response = await fetch(requestUrl, {
        headers: { Accept: 'text/html', 'X-Requested-With': 'TM-Glicko-Navigation' },
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) throw new Error('Expected an HTML page response.');

      const documentText = await response.text();
      const nextDocument = new DOMParser().parseFromString(documentText, 'text/html');
      const nextContent = nextDocument.querySelector('#page-content');
      if (!nextContent) throw new Error('The requested page did not contain its main content.');

      if (currentTarget) {
        const nextTarget = nextContent.querySelector(`[data-pagination-content="${paginationTarget}"]`);
        if (!nextTarget) throw new Error('The requested page did not contain the paginated results.');
        currentTarget.replaceWith(nextTarget);
      } else {
        main.innerHTML = nextContent.innerHTML;
        main.classList.remove('page-enter');
        void main.offsetWidth;
        main.classList.add('page-enter');
      }
      main.removeAttribute('aria-busy');
      if (!currentTarget) document.title = nextDocument.title;

      if (push && currentTarget) {
        const currentFetchUrl = currentTarget
          .querySelector('.pagination')
          ?.dataset.paginationFetchCurrent;
        history.replaceState({
          paginationTarget,
          paginationFetchUrl: currentFetchUrl || window.location.href,
        }, '', window.location.href);
      }
      if (push) {
        history.pushState({
          paginationTarget,
          paginationFetchUrl: requestUrl.href,
        }, '', url);
      }
      if (!currentTarget) window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (reloadOnFailure) {
        window.location.assign(url.href);
      } else {
        main.innerHTML = '<div role="alert"><h1>Unable to load this page</h1><p>Please refresh to try again.</p></div>';
      }
    } finally {
      if (activeRequest === controller) {
        activeRequest = undefined;
        if (!currentTarget) delete document.body.dataset.loading;
        currentTarget?.removeAttribute('aria-busy');
        main.removeAttribute('aria-busy');
      }
    }
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const copyButton = event.target.closest('button[data-copy-page-link]');
    if (copyButton instanceof HTMLButtonElement) {
      event.preventDefault();
      void copyPageLink(copyButton);
      return;
    }
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith('/assets/') || url.pathname === '/health') return;
    event.preventDefault();
    const requestUrl = link.dataset.paginationFetchUrl
      ? new URL(link.dataset.paginationFetchUrl, window.location.href)
      : url;
    navigate(url, true, true, link.dataset.paginationTarget, requestUrl);
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

  window.addEventListener('popstate', event => {
    const requestUrl = event.state?.paginationFetchUrl
      ? new URL(event.state.paginationFetchUrl, window.location.href)
      : new URL(window.location.href);
    navigate(
      new URL(window.location.href),
      false,
      true,
      event.state?.paginationTarget,
      requestUrl,
    );
  });

  if (main.dataset.initialLoad === 'true') {
    navigate(new URL(window.location.href), false, false);
  }
})();
