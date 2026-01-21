'use strict';

const API_BASE = '/api';

const DEFAULT_RANGE = '1y';
const MAX_EVENTS_FOR_CLIENT_STATS = 20000;

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  dateFrom: $('#fromDate'),
  dateTo: $('#toDate'),

  btnRefresh: $('#btnRefresh'),
  btnLogout: $('#logout'),

  kpiTotal: $('#kpiTotal'),
  kpiAvg: $('#kpiAvg'),
  kpiRange: $('#kpiRange'),
  kpiCasualties: $('#kpiCasualties'),

  kpiTopDistrict: $('#kpiTopDistrict'),
  kpiTopDistrictHint: $('#kpiTopDistrictHint'),

  chartDaily: $('#chartDaily'),

  districtsTableBody: $('#districtTableBody'),
};

const TOKEN_KEYS = ['access_token', 'token'];
function getToken() {
  for (const k of TOKEN_KEYS) {
    const v = localStorage.getItem(k);
    if (v) return v;
  }
  return '';
}
function clearTokens() {
  for (const k of TOKEN_KEYS) localStorage.removeItem(k);
}

async function apiGet(path, params = {}) {
  const url = new URL(API_BASE + path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).length) url.searchParams.set(k, String(v));
  });

  const token = getToken();
  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url.toString(), { headers });

  if (res.status === 401 || res.status === 403) {
    clearTokens();
    throw new Error('Unauthorized');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function toYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function humanYmd(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '—';
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

function ensureChartJs() {
  return typeof window.Chart !== 'undefined';
}

let charts = {
  daily: null,
};

function destroyChart(ch) {
  try { ch?.destroy?.(); } catch (_) {}
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeKey(v) {
  return String(v || '').trim().toLowerCase() || '—';
}

function districtKey(e) {
  const r = String(e?.region || '').trim();
  if (!r) return '—';
  const parts = r.split(/[,–-]/).map(s => s.trim()).filter(Boolean);
  return parts[0] || r || '—';
}

function inc(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function ymdToDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isEventInRange(e, fromYmd, toYmd) {
  const raw =
    e?.date ||
    e?.occurred_at ||
    e?.created_at ||
    '';

  const day = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day >= fromYmd && day <= toYmd;
}

async function fetchAllEvents(from, to) {
  const events = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const resp = await apiGet('/events.php', { limit, offset });

    const items = Array.isArray(resp.items) ? resp.items : [];
    const total = Number(resp.total || 0);

    events.push(...items);
    offset += items.length;

    if (!items.length) break;
    if (offset >= total) break;
    if (events.length >= MAX_EVENTS_FOR_CLIENT_STATS) break;
  }

  const filtered = events.filter(e => isEventInRange(e, from, to));
  return filtered;
}

function computeStats(events, from, to) {
  const perDay = new Map();
  const districts = new Map();

  let totalVictims = 0;
  let totalInjured = 0;
  let totalDead = 0;

  for (const e of events) {
    const raw = e?.date || e?.occurred_at || e?.created_at || '';
    const day = String(raw).slice(0, 10);
    if (day) inc(perDay, day, 1);

    const dist = districtKey(e);
    inc(districts, dist, 1);

    const injured = Number(e?.injured || 0);
    const dead = Number(e?.dead || 0);
    totalInjured += injured;
    totalDead += dead;
    totalVictims += (injured + dead);
  }

  const fromD = ymdToDate(from);
  const toD = ymdToDate(to);
  const days = (fromD && toD)
    ? Math.max(1, Math.round((toD - fromD) / 86400000) + 1)
    : 1;

  const avg = events.length / days;

  let topDistrict = '—', topDistrictCount = 0;
  for (const [k, v] of districts.entries()) {
    if (v > topDistrictCount) { topDistrict = k; topDistrictCount = v; }
  }

  return {
    total: events.length,
    avgPerDay: avg,
    from, to,
    totalVictims, totalInjured, totalDead,
    perDay, districts,
    topDistrict, topDistrictCount,
  };
}

function renderKpis(s) {
  els.kpiTotal.textContent = s.total ? String(s.total) : '—';
  els.kpiAvg.textContent = s.total ? s.avgPerDay.toFixed(2) : '—';
  els.kpiRange.textContent = `${humanYmd(s.from)} — ${humanYmd(s.to)}`;
  els.kpiCasualties.textContent = s.total ? String(s.totalVictims) : '—';
  els.kpiTopDistrict.textContent = s.total ? s.topDistrict : '—';
  els.kpiTopDistrictHint.textContent = s.total ? `${s.topDistrictCount} событий` : '—';
}

function mapToSortedArrays(map, topN = null) {
  const arr = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  const sliced = topN ? arr.slice(0, topN) : arr;
  return {
    labels: sliced.map(x => x[0]),
    values: sliced.map(x => x[1]),
  };
}

function renderDailyChart(perDay) {
  if (!ensureChartJs()) return;

  const keys = Array.from(perDay.keys()).sort();
  const labels = keys.map(k => humanYmd(k));
  const values = keys.map(k => perDay.get(k) || 0);

  destroyChart(charts.daily);
  charts.daily = new Chart(els.chartDaily, {
    type: 'line',
    data: { labels, datasets: [{ label: 'События', data: values }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderDistrictsTable(districts) {
  if (!els.districtsTableBody) return;
  const arr = Array.from(districts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  els.districtsTableBody.innerHTML = arr.map(([name, cnt]) =>
    `<tr><td class="ps-4">${escapeHtml(name)}</td><td class="text-end pe-4">${cnt}</td></tr>`
  ).join('');
}

async function refreshStats() {
  const from = els.dateFrom.value;
  const to = els.dateTo.value;

  if (!from || !to) {
    alert("Пожалуйста, выберите даты");
    return;
  }

  try {
    els.kpiTotal.textContent = '…';
    els.kpiAvg.textContent = '…';
    els.kpiCasualties.textContent = '…';
    els.kpiTopDistrict.textContent = '…';

    const data = await apiGet('/stats.php', { from, to });

    const days = Math.max(1, Math.round((new Date(data.to) - new Date(data.from)) / 86400000) + 1);
    const avg = (data.total || 0) / days;

    renderKpis({
      total: data.total || 0,
      avgPerDay: avg,
      from: data.from,
      to: data.to,
      totalVictims: data.victims || 0,
      totalInjured: data.injured || 0,
      totalDead: data.dead || 0,
      topDistrict: (data.districts?.[0]?.label) || '—',
      topDistrictCount: (data.districts?.[0]?.count) || 0,
    });

    const perDayToMap = (arr) => new Map((arr || []).map(x => [String(x.date), Number(x.count) || 0]));
    const arrToMap = (arr) => new Map((arr || []).map(x => [String(x.label), Number(x.count) || 0]));

    const perDay = perDayToMap(data.perDay);
    const districts = arrToMap(data.districts);

    if (ensureChartJs()) {
      renderDailyChart(perDay);
    }

    renderDistrictsTable(districts);

  } catch (e) {
    console.error(e);
    els.kpiTotal.textContent = '—';
    els.kpiAvg.textContent = '—';
    els.kpiCasualties.textContent = '—';
    els.kpiTopDistrict.textContent = '—';
    alert('Не удалось загрузить статистику: ' + (e?.message || e));
  }
}

function applyRange(rangeRaw) {
  const fromInput = els.dateFrom;
  const toInput = els.dateTo;
  if (!fromInput || !toInput) return;

  const today = new Date();
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = new Date(to);

  const r = String(rangeRaw).trim();

  if (r.endsWith('y')) {
    const years = parseInt(r.slice(0, -1), 10);
    if (!Number.isFinite(years) || years <= 0) return;
    from.setFullYear(from.getFullYear() - years);
  } else {
    return;
  }

  fromInput.value = toYmd(from);
  toInput.value = toYmd(to);

  document.querySelectorAll('#rangeButtons [data-range]').forEach(btn => {
    const active = btn.dataset.range === r;
    btn.classList.toggle('btn-secondary', active);
    btn.classList.toggle('btn-outline-secondary', !active);
  });

  refreshStats();
}

function getRangeButtons() {
  const root =
    document.getElementById('rangeButtons') ||
    document.querySelector('.btn-group[aria-label*="период"]') ||
    document;

  return Array.from(root.querySelectorAll('[data-range]'));
}

function initStatsPage() {
  const token = getToken();
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  const btns = getRangeButtons();
  btns.forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      applyRange(btn.dataset.range);
    });
  });

  els.btnRefresh?.addEventListener('click', (ev) => {
    ev.preventDefault();
    refreshStats();
  });

  els.btnLogout?.addEventListener('click', () => {
    clearTokens();
    window.location.href = '/login.html';
  });

  applyRange(DEFAULT_RANGE);
}

document.addEventListener('DOMContentLoaded', initStatsPage);