const SCENARIO_COLORS = [
  "#E63946", "#1E88E5", "#2E7D32", "#F57C00", "#8E24AA",
  "#00897B", "#D81B60", "#5D4037", "#3949AB", "#00ACC1",
  "#43A047", "#FB8C00", "#6D4C41", "#546E7A", "#7CB342"
];

const ICONS = { snow: '❄️', ice: '🧊', rain: '🌧️', night: '🌙', day: '☀️' };

function getScenarioColor(id) {
  const n = Number(id) || 0;
  return SCENARIO_COLORS[Math.abs(n) % SCENARIO_COLORS.length];
}

function deriveIconKey(title = '') {
  const t = String(title).toLowerCase();
  if (t.includes('ноч')) return 'night';
  if (t.includes('снег') || t.includes('метел')) return 'snow';
  if (t.includes('голол') || t.includes('лед') || t.includes('налед')) return 'ice';
  if (t.includes('дожд')) return 'rain';
  return 'day';
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizeList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try {
      const j = JSON.parse(s);
      return Array.isArray(j) ? j : [String(j)];
    } catch {
      return [s];
    }
  }
  return [String(v)];
}

function computeScenarioCount(scen) {
  if (scen == null) return 0;
  if (scen.count != null) return toNum(scen.count, 0);
  if (Array.isArray(scen.points)) return scen.points.length;
  if (Array.isArray(scen.clusters_data)) {
    let c = 0;
    scen.clusters_data.forEach(cl => {
      if (Array.isArray(cl?.points)) c += cl.points.length;
    });
    return c;
  }
  return 0;
}

function computeScenarioInjuredSum(scen) {
  if (scen == null) return 0;
  if (scen.injured_sum != null) return toNum(scen.injured_sum, 0);

  let sum = 0;
  const addFromEvent = (ev) => {
    if (!ev) return;
    sum += toNum(ev.injured_count ?? ev.inj ?? ev.injured ?? 0, 0);
  };

  if (Array.isArray(scen.points)) scen.points.forEach(addFromEvent);
  if (Array.isArray(scen.clusters_data)) {
    scen.clusters_data.forEach(cl => {
      if (Array.isArray(cl?.points)) cl.points.forEach(pt => addFromEvent(pt?.props ?? pt));
    });
  }
  return sum;
}

export class UIManager {
  constructor() {
    this.loadingOverlay = null;
  }

  setLoading(isLoading, message = 'Загрузка...') {
    if (!this.loadingOverlay) {
      this.loadingOverlay = document.createElement('div');
      this.loadingOverlay.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(255,255,255,0.85); z-index: 2000;
        display: flex; align-items: center; justify-content: center; flex-direction: column;
        backdrop-filter: blur(2px);
      `;
      const parent = document.querySelector('.sidebar') || document.body;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      parent.appendChild(this.loadingOverlay);
    }

    if (isLoading) {
      this.loadingOverlay.innerHTML = `
        <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem;"></div>
        <div class="fw-bold text-dark mb-1" style="font-size: 1.1rem;">${message}</div>
        <div class="small text-muted">Пожалуйста, не закрывайте страницу</div>
      `;
      this.loadingOverlay.style.display = 'flex';
    } else {
      this.loadingOverlay.style.display = 'none';
    }
  }

  renderLegend(scenarios = [], onToggle, activeScenarioIds = new Set()) {
    const container = document.getElementById('legend-container') || document.getElementById('legend');
    if (!container) return;
    container.innerHTML = '';

    if (!scenarios.length) {
      container.innerHTML = '<div class="text-center mt-4 text-muted">Нет данных</div>';
      return;
    }

    scenarios.forEach((scen) => {
      const clusterId = Number(scen.cluster);
      const color = getScenarioColor(clusterId);
      const title = scen.title ?? scen.name ?? `Сценарий ${clusterId}`;
      const count = computeScenarioCount(scen);
      const injuredSum = computeScenarioInjuredSum(scen);

      const iconKey = scen.icon ?? deriveIconKey(title);
      const iconChar = ICONS[iconKey] || '🚗';

      const isChecked = activeScenarioIds.has(clusterId);

      const card = document.createElement('div');
      card.className = 'card mb-2 border-0 shadow-sm';
      card.style.borderLeft = `4px solid ${color}`;
      card.style.backgroundColor = isChecked ? `${color}15` : '';

      const injuredBadge = (injuredSum > 0)
        ? `<span class="badge bg-light text-dark border ms-1">Пострад: ${injuredSum}</span>`
        : '';

      card.innerHTML = `
        <div class="card-body p-2 position-relative">
          <div class="d-flex align-items-center">
            <div class="me-2 pt-1">
              <input class="form-check-input cluster-checkbox" type="checkbox" value="${clusterId}" style="cursor:pointer; width: 1.2em; height: 1.2em;">
            </div>
            <div class="rounded-circle d-flex align-items-center justify-content-center me-2 flex-shrink-0"
                 style="width:36px; height:36px; background:${color}20; font-size:1.4rem;">${iconChar}</div>
            <div class="flex-grow-1" style="line-height:1.1;">
              <div class="fw-bold text-dark" style="font-size:0.9rem;">${title}</div>
            </div>
          </div>

          <div class="d-flex justify-content-between align-items-center mt-2 border-top pt-2">
            <div class="text-muted" style="font-size:0.75rem;">
              <span class="badge bg-light text-dark border">ДТП: ${count}</span>
              ${injuredBadge}
            </div>
          </div>
        </div>
      `;

      const chk = card.querySelector('.cluster-checkbox');
      chk.checked = isChecked;
      chk.addEventListener('change', (e) => {
        const checked = !!e.target.checked;
        card.style.backgroundColor = checked ? `${color}15` : '';
        if (onToggle) onToggle(clusterId, checked);
      });

      container.appendChild(card);
    });
  }

  openDetails(ev) {
    if (!ev) return;

    const get = (...keys) => {
      for (const k of keys) {
        const v = ev?.[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };

    const setText = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (txt === undefined || txt === null || txt === '') ? '—' : String(txt);
    };

    const fillBadges = (eid, arr, cls) => {
      const el = document.getElementById(eid);
      if (!el) return;
      const list = normalizeList(arr);
      el.innerHTML = '';
      if (list.length) {
        list.forEach(t => {
          const span = document.createElement('span');
          span.className = `badge ${cls} border me-1 mb-1`;
          span.textContent = t;
          el.appendChild(span);
        });
      } else {
        el.innerHTML = '<span class="text-muted small">Нет данных</span>';
      }
    };

    const id = get('id', 'event_id');
    const category = get('category', 'cat');
    const severity = get('severity', 'sev');

    const injured = get('injured_count', 'inj', 'injured');
    const dead = get('dead_count', 'dead');
    const part = get('participants_count', 'part', 'participants');

    const address = get('address', 'addr');
    const region = get('region');
    const light = get('light');
    const sourceId = get('source_id', 'sourceId');

    setText('detailId', id ? `ДТП #${id}` : 'ДТП');
    setText('detailCat', category || 'Неизвестно');
    setText('detailSeverity', severity || '—');

    setText('detailInj', toNum(injured, 0));
    setText('detailDead', toNum(dead, 0));
    setText('detailPart', toNum(part, 0));
    setText('detailSourceId', sourceId ?? '—');

    setText('detailAddr', address || 'Адрес не указан');
    setText('detailRegion', region || '—');

    const occurredAt = get('occurred_at', 'date', 'time');
    const dateEl = document.getElementById('detailTime');
    if (dateEl) {
      if (!occurredAt) {
        dateEl.textContent = '—';
      } else {
        try {
          const safeDate = String(occurredAt).replace(' ', 'T');
          dateEl.textContent = new Date(safeDate).toLocaleString('ru-RU', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });
        } catch {
          dateEl.textContent = String(occurredAt);
        }
      }
    }

    fillBadges('detailWeather', get('weather'), 'bg-info bg-opacity-10 text-info border-info');
    fillBadges('detailRoad', get('road_conditions', 'road'), 'bg-secondary bg-opacity-10 text-dark');
    fillBadges('detailNearby', get('nearby'), 'bg-warning bg-opacity-10 text-dark border-warning');
    setText('detailLight', light || '—');

    const el = document.getElementById('dtpDetails') || document.getElementById('dtpOffcanvas');
    if (el && typeof bootstrap !== 'undefined') {
      const bsOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(el);
      bsOffcanvas.show();
    }
  }

  showDtpDetails(data) {
    this.openDetails(data);
  }
}

export const ui = new UIManager();
