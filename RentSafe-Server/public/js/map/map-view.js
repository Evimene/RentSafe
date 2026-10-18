import { h } from '../mini.js';
import { loadLeaflet } from './leaflet-loader.js';
import { MarkerLayer } from './markers.js';

/* ============================================================
   Singleton — one Leaflet map per DOM container.
   Re-renders must not recreate the map.
   ============================================================ */

const registry = new WeakMap();

export function MapView({ listings, center, zoom, activeId, onMarkerClick, onHoverCard }) {
  return h('div', { class: 'map-host', 'data-map-host': '' },
    h('div', { class: 'map-canvas', 'data-map-canvas': '' }),
    h('div', { class: 'map-attrib' },
      '© OpenStreetMap · © CARTO'
    )
  );
}

/* ============================================================
   Mount / update — called from the parent component after render
   ============================================================ */

export async function syncMap(container, props) {
  const canvasEl = container.querySelector('[data-map-canvas]');
  if (!canvasEl) return;

  const L = await loadLeaflet();

  let state = registry.get(container);
  if (!state) {
    const map = L.map(canvasEl, {
      center: [props.center.lat, props.center.lng],
      zoom: props.zoom,
      zoomControl: true,
      preferCanvas: false,
      attributionControl: false,
    });

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 19, subdomains: 'abcd' }
    ).addTo(map);

    const markers = new MarkerLayer(map);
    markers.onClick = (id) => props.onMarkerClick?.(id);
    markers.onHover = (id, on) => props.onHoverCard?.(id, on);

    state = { map, markers, lastProps: null };
    registry.set(container, state);
    props.onMapReady?.(map, markers);
  }

  const { map, markers } = state;

  // Sync markers
  if (props.listings !== state.lastProps?.listings) {
    markers.setListings(props.listings || []);
  }
  markers.setActive(props.activeId || null);

  // Sync center + zoom only when parent explicitly wants it
  if (props.center && state.lastProps?.center !== props.center) {
    const cur = map.getCenter();
    if (Math.abs(cur.lat - props.center.lat) > 1e-5 ||
        Math.abs(cur.lng - props.center.lng) > 1e-5) {
      map.setView([props.center.lat, props.center.lng], map.getZoom(), { animate: true });
    }
  }
  if (props.zoom && map.getZoom() !== props.zoom) {
    map.setZoom(props.zoom);
  }

  state.lastProps = props;
}

/* ============================================================
   Imperative helpers used by the parent component
   ============================================================ */

export function getMapState(container) {
  const s = registry.get(container);
  if (!s) return null;
  const { map } = s;
  const c = map.getCenter();
  return {
    map: s.map,
    markers: s.markers,
    center: { lat: c.lat, lng: c.lng },
    zoom: map.getZoom(),
    bounds: map.getBounds(),
  };
}

export function flyTo(container, { lat, lng, zoom }) {
  const s = registry.get(container);
  if (!s) return;
  s.map.flyTo([lat, lng], zoom ?? s.map.getZoom(), { duration: 0.8 });
}

export function fitBounds(container, bounds) {
  const s = registry.get(container);
  if (!s) return;
  s.map.fitBounds(bounds, { padding: [40, 40] });
}

export function focusMarker(container, id) {
  const s = registry.get(container);
  if (!s) return;
  s.markers.focusListing(id);
}

export function invalidateSize(container) {
  const s = registry.get(container);
  if (!s) return;
  setTimeout(() => s.map.invalidateSize(), 50);
}

export async function mountMiniMap(container, listings, center) {
  const L = await loadLeaflet();
  let map = registry.get(container);
  if (!map) {
    map = L.map(container.querySelector('[data-map-canvas]'), {
      center: [center.lat, center.lng],
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
    });
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 19, subdomains: 'abcd' }
    ).addTo(map);
    registry.set(container, { map, markers: null, lastProps: null });
  }

  const state = registry.get(container);
  // Clear old markers
  state.map.eachLayer((layer) => {
    if (layer instanceof L.Marker) state.map.removeLayer(layer);
  });

  for (const l of listings) {
    const marker = L.marker([l.lat, l.lng], {
      icon: L.divIcon({
        className: 'price-marker pm-small',
        html: `<span class="pm-label">₦${Math.round(Number(l.basePriceKobo) / 100 / 1000)}k</span>`,
        iconSize: null,
        iconAnchor: [20, 32],
      }),
    });
    marker.on('click', () => window.location.href = `/listing/${l.id}`);
    marker.addTo(state.map);
  }

  setTimeout(() => state.map.invalidateSize(), 50);
}