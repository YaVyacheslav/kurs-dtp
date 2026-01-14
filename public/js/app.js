// =====================
// CONFIG / GLOBALS
// =====================
const CLUSTER_COLORS = [
  "#e6194B","#3cb44b","#ffe119","#4363d8","#f58231",
  "#911eb4","#46f0f0","#f032e6","#bcf60c","#fabebe",
  "#008080","#e6beff","#9A6324","#fffac8","#800000"
];

let map;
let objectCollection = null;

let lastPoints = [];
let lastLabelsById = null;

// =====================
// AUTH + API
// =====================
function getToken() {
  return localStorage.getItem("access_token") || "";
}

async function apiGet(path) {
  const res = await fetch(path, {
    headers: { Authorization: "Bearer " + getToken() }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function requireAuthOrRedirect() {
  if (!getToken()) {
    window.location.href = "/login.html";
    return;
  }
  try {
    await apiGet("/api/auth.php?action=me");
  } catch {
    localStorage.removeItem("access_token");
    window.location.href = "/login.html";
  }
}

// =====================
// MAP
// =====================
function initMap() {
  ymaps.ready(() => {
    map = new ymaps.Map("map", {
      center: [55.751244, 37.618423],
      zoom: 10,
      controls: ['zoomControl', 'fullscreenControl']
    });

    objectCollection = new ymaps.GeoObjectCollection({}, {
      preset: 'islands#circleIcon'
    });

    map.geoObjects.add(objectCollection);

    // Автозапуск
    const btn = document.getElementById("applyFilters");
    if (btn) btn.click();
  });
}

function renderPoints(items) {
  if (!map || !objectCollection) return;

  objectCollection.removeAll();

  items.forEach(p => {
    if (!p.lat || !p.lon) return;

    let color = "#0d6efd";
    let clusterHtml = "";

    if (lastLabelsById && lastLabelsById[String(p.id)] !== undefined) {
      const c = Number(lastLabelsById[String(p.id)]);
      color = CLUSTER_COLORS[c % CLUSTER_COLORS.length];
      clusterHtml = `<div class="mt-1"><b>Зона риска #${c}</b></div>`;
    }

    const placemark = new ymaps.Placemark([p.lat, p.lon], {
      balloonContentHeader: p.category || "ДТП",
      balloonContentBody: `
        <div style="min-width:200px">
          <div>${new Date(p.occurred_at).toLocaleString()}</div>
          <div class="text-muted small">${p.region || ""}</div>
          ${clusterHtml}
          <div class="mt-2 border-top pt-1">
            Пострадавшие: <b>${p.injured_count}</b><br>
            Погибшие: <b>${p.dead_count}</b>
          </div>
        </div>
      `,
      hintContent: p.category
    }, {
      preset: 'islands#circleDotIcon',
      iconColor: color
    });

    objectCollection.add(placemark);
  });
}

// =====================
// DATA
// =====================
async function loadEvents(filters) {
  const usp = new URLSearchParams();
  usp.set("limit", filters.limit || 800);
  if (filters.region) usp.set("region", filters.region);
  if (filters.category) usp.set("category", filters.category);
  // Новые фильтры
  if (filters.weather) usp.set("weather", filters.weather);
  if (filters.road) usp.set("road", filters.road);

  return apiGet(`/api/events.php?${usp.toString()}`);
}

async function loadSuggestions(type, q) {
  const r = await apiGet(`/api/search.php?type=${type}&q=${encodeURIComponent(q)}`);
  return r.items || [];
}

function bindSuggest(input, box, type, onPick) {
  input.addEventListener("input", async () => {
    const q = input.value.trim();
    box.innerHTML = "";
    box.classList.add("d-none");

    if (q.length < 2) return;

    const items = await loadSuggestions(type, q);
    if (!items.length) return;

    box.classList.remove("d-none");
    items.forEach(v => {
      const d = document.createElement("div");
      d.className = "suggest-item";
      d.textContent = v;
      d.onclick = () => {
        input.value = v;
        box.classList.add("d-none");
        onPick(v);
      };
      box.appendChild(d);
    });
  });

  document.addEventListener("click", e => {
    if (!box.contains(e.target) && e.target !== input) {
      box.classList.add("d-none");
    }
  });
}

// =====================
// PAGE BOOTSTRAP
// =====================
document.addEventListener("DOMContentLoaded", async () => {
  const page = document.body.dataset.page;

  if (page === "login") {
    if (getToken()) { window.location.href = "/index.html"; return; }
    initLoginForm();
    return;
  }

  if (page === "register") {
    if (getToken()) { window.location.href = "/index.html"; return; }
    initRegisterForm();
    return;
  }

  await requireAuthOrRedirect();
  if (typeof ymaps === 'undefined') {
      document.getElementById("map").innerHTML = "<div class='p-5 text-center text-danger'>Ошибка загрузки карт</div>";
  } else {
      initMap();
  }

  const regionInput = document.getElementById("region");
  const categoryInput = document.getElementById("category");
  const weatherInput = document.getElementById("weatherInput");
  const roadInput = document.getElementById("roadInput");

  const regionBox = document.getElementById("regionSuggest");
  const categoryBox = document.getElementById("categorySuggest");

  const btnApply = document.getElementById("applyFilters");
  const btnCluster = document.getElementById("runCluster");
  const btnLogout = document.getElementById("logout");

  const status = document.getElementById("status");
  const mlStatus = document.getElementById("mlStatus");
  const legend = document.getElementById("legend");

  // Объект фильтров
  let filters = { region: "", category: "", weather: "", road: "", limit: 1000 };

  bindSuggest(regionInput, regionBox, "regions", v => filters.region = v);
  bindSuggest(categoryInput, categoryBox, "categories", v => filters.category = v);

  // Обработчик кнопки "Показать"
  btnApply.onclick = async () => {
    filters.region = regionInput.value.trim();
    filters.category = categoryInput.value.trim();
    filters.weather = weatherInput.value;
    filters.road = roadInput.value;

    status.textContent = "Загрузка...";
    lastLabelsById = null;
    legend.innerHTML = "";
    mlStatus.textContent = "";

    try {
      const data = await loadEvents(filters);
      lastPoints = data.items || [];
      renderPoints(lastPoints);
      status.textContent = `Найдено: ${data.total}`;
    } catch {
      status.textContent = "Ошибка";
    }
  };

  // Обработчик ML (Кластеризация)
  btnCluster.onclick = async () => {
    // Обновляем фильтры перед запуском
    filters.region = regionInput.value.trim();
    filters.category = categoryInput.value.trim();
    filters.weather = weatherInput.value;
    filters.road = roadInput.value;

    mlStatus.textContent = "Анализ рисков...";
    legend.innerHTML = "";
    btnCluster.disabled = true;

    try {
      const usp = new URLSearchParams({
        action: "cluster",
        limit: "2500"
      });

      if (filters.region) usp.set("region", filters.region);
      if (filters.category) usp.set("category", filters.category);
      if (filters.weather) usp.set("weather", filters.weather);
      if (filters.road) usp.set("road", filters.road);

      const out = await apiGet(`/api/clusters.php?${usp.toString()}`);

      lastLabelsById = out.labels_by_id || {};
      renderPoints(lastPoints);

      mlStatus.innerHTML = `<span class="text-success">Готово!</span> Выделено <b>${out.k}</b> зон риска`;

      legend.innerHTML = out.profiles.map(p => {
        const col = CLUSTER_COLORS[p.cluster % CLUSTER_COLORS.length];
        const centerBtn = (p.center && p.center[0])
          ? `<button class="btn btn-link btn-sm p-0 text-decoration-none" onclick="map.setCenter([${p.center[0]}, ${p.center[1]}], 12)">📍</button>`
          : '';

        return `
          <div class="border-start border-4 ps-2 py-2 bg-white shadow-sm rounded-end mb-2">
            <div class="d-flex justify-content-between align-items-center mb-1">
               <span class="badge" style="background:${col}">Зона ${p.cluster}</span>
               ${centerBtn}
            </div>
            <div class="fw-bold text-dark" style="font-size: 0.95rem; line-height: 1.2;">
              ${p.title}
            </div>
            <div class="text-muted small mb-1">
              ${p.subtitle || 'ДТП'}
            </div>
            <div class="d-flex justify-content-between text-muted" style="font-size:0.75rem">
               <span>Всего: <b>${p.count}</b></span>
               <span>Пострад.: <b>${p.injured_sum}</b></span>
            </div>
          </div>`;
      }).join("");

    } catch (e) {
      console.error(e);
      mlStatus.textContent = "Ошибка: " + e.message;
    } finally {
        btnCluster.disabled = false;
    }
  };

  btnLogout.onclick = () => {
    localStorage.removeItem("access_token");
    window.location.href = "/login.html";
  };
});

function initLoginForm() {
  const form = document.getElementById("loginForm");
  const errBox = document.getElementById("err");
  if(!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    try {
      const res = await apiPost("/api/auth.php?action=login", {
        email: document.getElementById("email").value,
        password: document.getElementById("password").value
      });
      localStorage.setItem("access_token", res.access_token);
      window.location.href = "/index.html";
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(msg).error; } catch {}
      errBox.textContent = msg || "Ошибка";
    }
  };
}

function initRegisterForm() {
  const form = document.getElementById("registerForm");
  const errBox = document.getElementById("err");
  if(!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    try {
      const res = await apiPost("/api/auth.php?action=register", {
        email: document.getElementById("email").value,
        password: document.getElementById("password").value
      });
      localStorage.setItem("access_token", res.access_token);
      window.location.href = "/index.html";
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(msg).error; } catch {}
      errBox.textContent = msg || "Ошибка";
    }
  };
}