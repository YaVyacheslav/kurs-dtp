// ====== мини-обертка над fetch ======
function getToken() {
  return localStorage.getItem("access_token") || "";
}

async function apiGet(path) {
  const res = await fetch(path, {
    headers: { "Authorization": "Bearer " + getToken() }
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

// ====== auth helpers ======
async function requireAuthOrRedirect() {
  const t = getToken();
  if (!t) {
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

// ====== suggestions (живой поиск) ======
async function loadSuggestions(type, q) {
  const data = await apiGet(`/api/search.php?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}&limit=10`);
  return data.items || [];
}

function bindSuggest(inputEl, boxEl, type, onPick) {
  let lastQ = "";

  inputEl.addEventListener("input", async () => {
    const q = inputEl.value.trim();
    lastQ = q;
    boxEl.innerHTML = "";
    boxEl.classList.add("d-none");

    if (q.length < 2) return;

    try {
      const items = await loadSuggestions(type, q);
      if (inputEl.value.trim() !== lastQ) return;

      if (!items.length) return;
      boxEl.classList.remove("d-none");

      items.forEach((s) => {
        const div = document.createElement("div");
        div.className = "suggest-item";
        div.textContent = s;
        div.onclick = () => {
          inputEl.value = s;
          boxEl.classList.add("d-none");
          onPick(s);
        };
        boxEl.appendChild(div);
      });
    } catch {
      // молча
    }
  });

  document.addEventListener("click", (e) => {
    if (!boxEl.contains(e.target) && e.target !== inputEl) {
      boxEl.classList.add("d-none");
    }
  });
}

// ====== map + data ======
let map;
let layerGroup;

function initMap() {
  console.log("initMap called");

  if (typeof L === "undefined") {
    alert("Leaflet НЕ загружен (L is undefined)");
    return;
  }

  map = L.map("map").setView([55.751244, 37.618423], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  layerGroup = L.layerGroup().addTo(map);
}


function renderPoints(items) {
  layerGroup.clearLayers();

  items.forEach((p) => {
    if (!p.lat || !p.lon) return;
    const m = L.circleMarker([p.lat, p.lon], { radius: 4 });
    const html = `
      <div style="min-width:240px">
        <div><b>${p.category || "ДТП"}</b></div>
        <div>${new Date(p.occurred_at).toLocaleString()}</div>
        <div>${p.region || ""}</div>
        <div>Постр.: ${p.injured_count} / Погиб.: ${p.dead_count}</div>
      </div>
    `;
    m.bindPopup(html);
    m.addTo(layerGroup);
  });
}

async function loadEvents(filters) {
  const usp = new URLSearchParams();
  usp.set("limit", String(filters.limit || 800));
  usp.set("offset", "0");
  if (filters.region) usp.set("region", filters.region);
  if (filters.category) usp.set("category", filters.category);

  const data = await apiGet(`/api/events.php?${usp.toString()}`);
  return data;
}

// ====== page bootstrap ======
document.addEventListener("DOMContentLoaded", async () => {
  // если это страница логина/регистрации — там своя логика
  if (document.body.dataset.page === "login") {
    const form = document.getElementById("loginForm");
    const err = document.getElementById("err");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;

      try {
        const out = await apiPost("/api/auth.php?action=login", { email, password });
        localStorage.setItem("access_token", out.access_token);
        window.location.href = "/index.html";
      } catch (ex) {
        err.textContent = "Ошибка входа";
      }
    });
    return;
  }

  if (document.body.dataset.page === "register") {
    const form = document.getElementById("registerForm");
    const err = document.getElementById("err");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;

      try {
        const out = await apiPost("/api/auth.php?action=register", { email, password });
        localStorage.setItem("access_token", out.access_token);
        window.location.href = "/index.html";
      } catch (ex) {
        err.textContent = "Ошибка регистрации (возможно, email уже занят)";
      }
    });
    return;
  }

  // dashboard
  await requireAuthOrRedirect();
  initMap();

  const regionInput = document.getElementById("region");
  const categoryInput = document.getElementById("category");
  const regionBox = document.getElementById("regionSuggest");
  const categoryBox = document.getElementById("categorySuggest");
  const btnApply = document.getElementById("applyFilters");
  const btnLogout = document.getElementById("logout");

  let filters = { region: "", category: "", limit: 800 };

  bindSuggest(regionInput, regionBox, "regions", (v) => { filters.region = v; });
  bindSuggest(categoryInput, categoryBox, "categories", (v) => { filters.category = v; });

  btnApply.addEventListener("click", async () => {
    filters.region = regionInput.value.trim();
    filters.category = categoryInput.value.trim();

    const status = document.getElementById("status");
    status.textContent = "Загрузка...";
    try {
      const data = await loadEvents(filters);
      renderPoints(data.items || []);
      status.textContent = `Показано: ${(data.items || []).length} / Всего: ${data.total || 0}`;
    } catch {
      status.textContent = "Ошибка загрузки данных";
    }
  });

  btnLogout.addEventListener("click", () => {
    localStorage.removeItem("access_token");
    window.location.href = "/login.html";
  });

  // автозагрузка
  btnApply.click();
});
