export class RouteManager {
  constructor() {
    this.currentRoute = null;
  }

  build(map, pointFrom, pointTo) {
    if (!map) return;

    this.clear(map);

    this.currentRoute = new ymaps.multiRouter.MultiRoute(
      {
        referencePoints: [pointFrom, pointTo],
        params: {
          routingMode: 'auto',
          results: 3
        }
      },
      {
        boundsAutoApply: true,
        routeActiveStrokeColor: '#2563eb',
        routeActiveStrokeWidth: 4,
        routeStrokeColor: '#b0b0b0',
        routeStrokeWidth: 3
      }
    );

    map.geoObjects.add(this.currentRoute);

    this.currentRoute.model.events.add('requestfail', (e) => {
      console.error('Route request failed:', e.get('error'));
      const errEl = document.getElementById('routeError');
      if (errEl) {
        errEl.style.display = 'block';
        errEl.textContent = 'Ошибка маршрутизации. Открой консоль (F12) и посмотри причину.';
      }
    });
  }

  clear(map) {
    if (this.currentRoute) {
      map.geoObjects.remove(this.currentRoute);
      this.currentRoute = null;
    }
  }

}

export const router = new RouteManager();