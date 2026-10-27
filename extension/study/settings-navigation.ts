export function setupSettingsNavigation() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-settings-page]')];
  const pages = [...document.querySelectorAll<HTMLElement>('.settings-page')];
  function show() {
    const requested = location.hash.slice(1);
    const id = pages.some(page => page.id === requested) ? requested : 'subtitles';
    for (const page of pages) page.hidden = page.id !== id;
    for (const link of links) {
      if (link.dataset.settingsPage === id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.dispatchEvent(new CustomEvent('study-settings-page', { detail: id }));
  }
  for (const link of links) link.addEventListener('click', event => {
    event.preventDefault();
    if (location.hash !== link.hash) history.pushState(null, '', link.hash);
    show();
    window.scrollTo(0, 0);
  });
  window.addEventListener('hashchange', show);
  document.querySelector<HTMLAnchorElement>('.skip-link')?.addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('settingsContent')?.focus();
  });
  window.addEventListener('pagehide', () => window.removeEventListener('hashchange', show), { once: true });
  show();
}
