import { api } from './modules/api.js';
import { mapManager } from './modules/map.js';
import { ui } from './modules/ui.js';
import { router } from './modules/router.js';

const state = {
  scenarios: [],
  activeScenarioIds: new Set(),
  markersVisible: true,
  me: null
};

const $ = (id) => document.getElementById(id);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

async function startApp() {
  let page = document.body?.dataset?.page;

  if (!page || page === 'app') {
    const path = window.location.pathname;
    if (path.includes('login')) page = 'login';
    else if (path.includes('register')) page = 'register';
    else page = 'app';
  }

  if (page === 'login') return initLoginPage();
  if (page === 'register') return initRegisterPage();

  return initAppPage();
}

async function initAppPage() {
  if (!api.getToken()) {
    window.location.href = "login.html";
    return;
  }

  mapManager.init("map");

  initRouteTab();

  const logoutBtn = $('logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      api.removeToken();
      window.location.href = "login.html";
    });
  }

  const toggleMarkersBtn = $('toggleMarkers');
  if (toggleMarkersBtn) {
    const renderBtn = () => {
      toggleMarkersBtn.textContent = state.markersVisible ? 'Метки: вкл' : 'Метки: выкл';
      toggleMarkersBtn.classList.toggle('btn-outline-secondary', state.markersVisible);
      toggleMarkersBtn.classList.toggle('btn-secondary', !state.markersVisible);
    };

    renderBtn();

    toggleMarkersBtn.addEventListener('click', () => {
      state.markersVisible = !state.markersVisible;
      mapManager.setMarkersVisible(state.markersVisible);
      renderBtn();
    });
  }

  const searchInput = $('scenarioSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value.toLowerCase().trim();
      const container = $('legend-container');
      if (!container) return;

      Array.from(container.children).forEach(el => {
        const text = el.textContent.toLowerCase();
        el.style.display = text.includes(val) ? '' : 'none';
      });
    });
  }

  try {
    const r = await api.getMe();
    state.me = r?.user || null;
  } catch (_) {
    state.me = null;
  }

  const runBtn = $('runAnalyzeBtn');
  if (runBtn) {
    if (state.me?.role === 'admin') {
      runBtn.style.display = 'inline-block';
    }

    runBtn.addEventListener('click', async () => {
      if (state.me?.role !== 'admin') return;

      const ok = confirm('Запустить анализ? Это может занять время.');
      if (!ok) return;

      const originalBtnText = runBtn.innerHTML;

      try {
        runBtn.disabled = true;
        runBtn.innerHTML = `
          <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
          Анализ...
        `;

        ui.setLoading(true, 'Выполняется ML-анализ данных...');

        const res = await api.runAnalyze({ years: 2 });

        const msg = res?.ok
          ? 'Анализ успешно завершён!'
          : `Анализ завершился с ошибкой\n(exit_code=${res?.exit_code})`;

        alert(msg);

        ui.setLoading(true, 'Загрузка новых кластеров на карту...');

        await loadScenarios();

      } catch (e) {
        alert('Ошибка запуска: ' + (e?.message || e));
      } finally {
        ui.setLoading(false);
        runBtn.disabled = false;
        runBtn.innerHTML = originalBtnText;
      }
    });
  }

  await loadScenarios();

  if (searchInput && searchInput.value) {
    searchInput.dispatchEvent(new Event('input'));
  }
}

function initRouteTab() {
  const fromInput = $('routeFrom');
  const toInput = $('routeTo');
  const buildBtn = $('buildRouteBtn');
  const clearBtn = $('clearRouteBtn');
  const errEl = $('routeError');

  if (!fromInput || !toInput || !buildBtn || !clearBtn) return;

  const setError = (msg) => {
    if (!errEl) return;
    if (!msg) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    } else {
      errEl.style.display = 'block';
      errEl.textContent = msg;
    }
  };

  if (typeof ymaps !== 'undefined') {
    ymaps.ready(() => {
      try {
        if (!window.__routeSuggestInited) {
          const MOSCOW_BOUNDS = [
            [55.10, 36.70],
            [56.10, 38.35]
          ];

          const moscowProvider = {
            suggest: (request, options = {}) => {
              const results = options.results ?? 7;
              return ymaps.suggest(request, {
                boundedBy: MOSCOW_BOUNDS,
                strictBounds: true,
                results
              });
            }
          };

          new ymaps.SuggestView('routeFrom', {
            provider: moscowProvider,
            results: 7,
            container: document.body
          });

          new ymaps.SuggestView('routeTo', {
            provider: moscowProvider,
            results: 7,
            container: document.body
          });

          window.__routeSuggestInited = true;
        }
      } catch (e) {
        console.warn('SuggestView init failed:', e);
      }
    });
  }

  const buildRoute = () => {
    const a = (fromInput.value || '').trim();
    const b = (toInput.value || '').trim();

    if (!a || !b) {
      setError('Введите обе точки: «Откуда» и «Куда».');
      return;
    }

    if (!mapManager.map) {
      setError('Карта ещё загружается. Попробуйте ещё раз через секунду.');
      return;
    }

    setError('');
    mapManager.buildRoute(a, b);
  };

  buildBtn.addEventListener('click', buildRoute);

  [fromInput, toInput].forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        buildRoute();
      }
    });
  });

  clearBtn.addEventListener('click', () => {
    setError('');

    if (mapManager.map) {
      router.clear(mapManager.map);
    }
  });
}

async function initLoginPage() {
  try {
    if (api.getToken()) {
      await api.getMe();
      window.location.href = "index.html";
      return;
    }
  } catch (_) {}

  const form = $('loginForm');
  const err = $('err');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (err) err.textContent = '';

    const email = $('email')?.value?.trim() || '';
    const password = $('password')?.value || '';

    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
      const res = await api.login(email, password);
      api.setToken(res.access_token);
      window.location.href = "index.html";
    } catch (e) {
      if (err) err.textContent = e?.message || 'Ошибка входа';
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function initRegisterPage() {
  try {
    if (api.getToken()) {
      await api.getMe();
      window.location.href = "index.html";
      return;
    }
  } catch (_) {}

  const form = $('registerForm');
  const err = $('err');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (err) err.textContent = '';

    const email = $('email')?.value?.trim() || '';
    const password = $('password')?.value || '';

    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
      const res = await api.register(email, password);
      api.setToken(res.access_token);
      window.location.href = "index.html";
    } catch (e) {
      if (err) err.textContent = e?.message || 'Ошибка регистрации';
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function loadScenarios() {
  try {
    ui.setLoading(true);

    const response = await api.getClusters({});
    state.scenarios = response?.profiles || [];

    ui.renderLegend(state.scenarios, onScenarioToggle);
    updateMap();
  } catch (e) {
    console.error("Error loading scenarios:", e);
  } finally {
    ui.setLoading(false);
  }
}

function onScenarioToggle(scenarioId, isChecked) {
  if (isChecked) state.activeScenarioIds.add(Number(scenarioId));
  else state.activeScenarioIds.delete(Number(scenarioId));
  updateMap();
}

function updateMap() {
  const activeData = state.scenarios.filter(s => state.activeScenarioIds.has(Number(s.cluster)));
  mapManager.renderScenarios(activeData);

  mapManager.setMarkersVisible(state.markersVisible);
}