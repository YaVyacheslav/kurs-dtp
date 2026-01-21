export async function loadLayout({ page }) {
  async function load(id, url) {
    const el = document.getElementById(id);
    if (!el) return;
    const html = await fetch(url).then(r => r.text());
    el.innerHTML = html;
  }

  await load('app-header', '/partials/header.html');
  await load('app-footer', '/partials/footer.html');

  document.querySelectorAll('[data-nav]').forEach(a => {
    const isActive = a.dataset.nav === page;

    a.classList.toggle('btn-primary', isActive);
    a.classList.toggle('btn-outline-primary', !isActive);
  });

  if (page === 'stats') {
    document.querySelectorAll('[data-only="map"]').forEach(el => {
      el.style.display = 'none';
    });
  }
}