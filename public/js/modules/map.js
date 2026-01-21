import { router } from './router.js';
import { ui } from './ui.js';

const SCENARIO_COLORS = [
  "#E63946", "#1E88E5", "#2E7D32", "#F57C00", "#8E24AA",
  "#00897B", "#D81B60", "#5D4037", "#3949AB", "#00ACC1",
  "#43A047", "#FB8C00", "#6D4C41", "#546E7A", "#7CB342"
];

function getScenarioColor(id) {
  const n = Number(id) || 0;
  return SCENARIO_COLORS[Math.abs(n) % SCENARIO_COLORS.length];
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function muteColor(hex, mix = 0.65) {
  mix = clamp01(mix);
  const h = String(hex || '').replace('#', '').trim();
  if (h.length !== 6) return hex;

  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  const rr = Math.round(r + (255 - r) * mix);
  const gg = Math.round(g + (255 - g) * mix);
  const bb = Math.round(b + (255 - b) * mix);

  const toHex = (v) => v.toString(16).padStart(2, '0');
  return `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;
}

export class MapManager {
  constructor() {
    this.map = null;
    this.polygonCollection = null;
    this.objectManager = null;

    this.markersVisible = true;
  }

  setMarkersVisible(isVisible) {
    this.markersVisible = !!isVisible;

    if (this.objectManager) {
      this.objectManager.setFilter(() => this.markersVisible);
    }
  }

  init(containerId = 'map') {
    if (typeof ymaps === 'undefined') return;

    ymaps.ready(() => {
      this.map = new ymaps.Map(containerId, {
        center: [55.751244, 37.618423],
        zoom: 10,
        controls: ['zoomControl', 'fullscreenControl']
      });

      this.polygonCollection = new ymaps.GeoObjectCollection({}, { zIndex: 1 });
      this.map.geoObjects.add(this.polygonCollection);

      this.objectManager = new ymaps.ObjectManager({
        clusterize: false,
        geoObjectOpenBalloonOnClick: false
      });
      this.map.geoObjects.add(this.objectManager);

      this.objectManager.setFilter(() => this.markersVisible);

      this.objectManager.objects.events.add('click', (e) => {
        const objectId = e.get('objectId');
        const obj = this.objectManager.objects.getById(objectId);
        if (obj?.properties?.dtpData) ui.openDetails(obj.properties.dtpData);
      });
    });
  }

  setCenter(coords, zoom = 12) {
    if (this.map) this.map.setCenter(coords, zoom, { duration: 300 });
  }

  renderScenarios(activeScenarios) {
    if (!this.map) return;

    this.polygonCollection.removeAll();
    this.objectManager.removeAll();

    if (!activeScenarios || activeScenarios.length === 0) return;

    const features = [];
    let idCounter = 0;

    activeScenarios.forEach((scenario) => {
      const baseColor = getScenarioColor(scenario.cluster);
      const clusters = scenario.clusters_data;
      if (!Array.isArray(clusters)) return;

      clusters.forEach((cluster) => {
        const isNoise = Number(cluster?.is_noise || 0) === 1;

        if (!isNoise && Array.isArray(cluster?.polygon) && cluster.polygon.length >= 3) {
          const poly = new ymaps.Polygon([cluster.polygon], {}, {
            fillColor: baseColor,
            strokeColor: baseColor,
            strokeWidth: 2,
            opacity: 0.3,
            strokeStyle: 'solid',
            interactivityModel: 'default#transparent'
          });
          this.polygonCollection.add(poly);
        }

        if (this.markersVisible && Array.isArray(cluster?.points)) {
          const pointColor = isNoise ? muteColor(baseColor, 0.70) : baseColor;
          const iconOpacity = isNoise ? 0.45 : 1.0;

          cluster.points.forEach((pt) => {
            const coords = Array.isArray(pt?.coords) ? pt.coords : null;
            if (!coords || coords.length < 2) return;

            const lat = toNum(coords[0], NaN);
            const lon = toNum(coords[1], NaN);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

            const props = pt?.props ?? {};
            const dtpData = { ...props, lat, lon };

            features.push({
              type: 'Feature',
              id: idCounter++,
              geometry: { type: 'Point', coordinates: [lat, lon] },
              properties: {
                dtpData,
                hintContent: props.address ?? props.addr ?? props.category ?? props.cat ?? ''
              },
              options: {
                preset: 'islands#circleDotIcon',
                iconColor: pointColor,
                opacity: iconOpacity,
                iconOpacity: iconOpacity
              }
            });
          });
        }
      });
    });

    this.objectManager.add({ type: 'FeatureCollection', features });

    this.objectManager.setFilter(() => this.markersVisible);
  }

  buildRoute(from, to) {
    if (this.map) router.build(this.map, from, to, this.polygonCollection);
  }
}

export const mapManager = new MapManager();
