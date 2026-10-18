import { h } from '../mini.js';
import { getState, setState } from '../store.js';
import { api } from '../api.js';
import { MapView, syncMap, getMapState, flyTo, focusMarker, invalidateSize } from './map-view.js';
import { GeocoderInput } from './geocoder.js';
import { readMapStateFromURL, writeMapStateToURL } from './url-state.js';

const fmtN = (kobo) => kobo == null ? '—' : `₦${(Number(kobo) / 100).toLocaleString('en-NG')}`;

const LAGOS = { lat: 6.5244, lng: 3.3792 };

/* ============================================================
   INITIAL MOUNT
   ============================================================ */

export function initBrowseMap() {
  const { browse } = getState();
  const url = readMapStateFromURL();

  const state = {
    ...browse,
    view: url.view,
    filters: { ...browse.filters, ...url.filters },
    map: {
      center: url.center || LAGOS,
      zoom: url.zoom || 12,
      markers: [],
      loading: false,
      error: null,
      searchedBounds: null,   // bbox of last successful fetch
      pendingSearch: false,
      total: 0,
      truncated: false,
    },
    geocoder: { open: false, results: [], loading: false, error: null },
    activeId: null,
    hoverId: null,
  };
  setState({ browse: state });

  // If URL says map, or no filters set, default to map when we have a city
  if (url.view === 'map' || url.filters.city) {
    loadMarkers();
  }
}

/* ============================================================
   FETCH MARKERS
   ============================================================ */

export async function loadMarkers(force = false) {
  const { browse, accessToken } = getState();
  const state = browse;
  if (!state.map) return;

  const container = document.querySelector('[data-map-host]');
  const mapState = container ? getMapState(container) : null;

  let bounds;
  if (mapState) {
    bounds = mapState.bounds;
  } else if (state.map.searchedBounds) {
    bounds = state.map.searchedBounds;
  } else {
    // First load: derive from center + zoom using a small heuristic
    const deg = 360 / Math.pow(2, state.map.zoom);
    bounds = {
      getWest: () => state.map.center.lng - deg,
      getSouth: () => state.map.center.lat - deg / 2,
      getEast: () => state.map.center.lng + deg,
      getNorth: () => state.map.center.lat + deg / 2,
      toBBoxString: () => `${state.map.center.lng - deg},${state.map.center.lat - deg / 2},${state.map.center.lng + deg},${state.map.center.lat + deg / 2}`,
    };
  }

  const bbox = bounds.toBBoxString
    ? bounds.toBBoxString()
    : `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

  const f = state.filters;
  const query = {
    bbox,
    zoom: mapState?.zoom || state.map.zoom,
    guests: f.guests,
    minPrice: f.minPrice,
    maxPrice: f.maxPrice,
    type: f.type,
    amenities: f.amenities,
    instant: f.instant,
    checkIn: f.checkIn,
    checkOut: f.checkOut,
  };

  setState({
    browse: {
      ...state,
      map: { ...state.map, loading: true, error: null, pendingSearch: false },
    },
  });

  try {
    const res = await api.mapMarkers(accessToken, query);
    setState({
      browse: {
        ...state,
        map: {
          ...state.map,
          loading: false,
          markers: res.markers,
          total: res.total,
          truncated: res.truncated,
          searchedBounds: bbox,
        },
      },
    });
    writeMapStateToURL({
      view: state.view,
      center: getState().browse.map.center,
      zoom: mapState?.zoom || state.map.zoom,
      filters: f,
    });
  } catch (err) {
    setState({
      browse: {
        ...state,
        map: { ...state.map, loading: false, error: err.message },
      },
    });
  }
}

/* ============================================================
   MOUNT HOOK — call after render
   ============================================================ */

export function mountBrowseMap() {
  const container = document.querySelector('[data-map-host]');
  if (!container) return;

  const { browse } = getState();
  const state = browse;

  syncMap(container, {
    listings: state.map.markers,
    center: state.map.center,
    zoom: state.map.zoom,
    activeId: state.activeId,
    onMarkerClick: (id) => {
      setState({ browse: { ...getState().browse, activeId: id } });
      // Scroll card into view
      const card = document.querySelector(`[data-card-id="${id}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    onHoverCard: (id, on) => {
      setState({ browse: { ...getState().browse, hoverId: on ? id : null } });
    },
    onMapReady: (map) => {
      // Track map movement
      map.on('moveend', () => {
        const s = getState().browse;
        const container = document.querySelector('[data-map-host]');
        const ms = getMapState(container);
        if (!ms) return;

        const newBBox = ms.bounds.toBBoxString();
        const changed = !s.map.searchedBounds || newBBox !== s.map.searchedBounds;

        setState({
          browse: {
            ...s,
            map: {
              ...s.map,
              center: { lat: ms.center.lat, lng: ms.center.lng },
              zoom: ms.zoom,
              pendingSearch: changed,
            },
          },
        });
        writeMapStateToURL({ view: s.view, center: ms.center, zoom: ms.zoom, filters: s.filters });
      });
    },
  }).catch((err) => console.error('[map] sync failed', err));

  invalidateSize(container);
}

/* ============================================================
   RENDER
   ============================================================ */

export function BrowseMapView() {
  const { browse } = getState();
  const state = browse;
  const markers = state.map?.markers || [];

  return h('div', { class: 'browse-map' },
    // LEFT: cards + search
    h('div', { class: 'browse-list' },
      TopBar(),
      state.map?.loading && markers.length === 0
        ? h('div', { class: 'loading-row' }, 'Loading listings…')
        : h('div', { class: 'card-scroll' },
            markers.length === 0
              ? h('div', { class: 'empty' },
                  h('div', { class: 'empty-icon' }, '🗺'),
                  h('h3', {}, 'Nothing in this area'),
                  h('p', { class: 'muted' }, 'Try zooming out or moving the map.'))
              : markers.map((m) => ListingCardMini(m, state))
          )
    ),
    // RIGHT: map
    h('div', { class: 'browse-map-panel' },
      MapView({
        listings: markers,
        center: state.map.center,
        zoom: state.map.zoom,
        activeId: state.activeId,
      }),
      state.map?.pendingSearch
        ? h('button', {
            class: 'search-area-btn',
            onclick: () => loadMarkers(true),
          }, '🔍 Search this area')
        : null,
      state.map?.truncated
        ? h('div', { class: 'map-truncated' }, 'Showing first 500 results. Zoom in for more.')
        : null,
      h('div', { class: 'map-count' },
        `${state.map?.total || 0} listing${state.map?.total === 1 ? '' : 's'}`
      )
    )
  );
}

/* ============================================================
   SUBCOMPONENTS
   ============================================================ */

function TopBar() {
  const { browse } = getState();
  const f = browse.filters;

  return h('div', { class: 'browse-top' },
    GeocoderInput({
      value: f.city || '',
      onPick: (r) => {
        const { browse } = getState();
        const next = {
          ...browse,
          filters: { ...browse.filters, city: r.shortName || r.displayName.split(',')[0] },
          map: {
            ...browse.map,
            center: { lat: r.lat, lng: r.lng },
            zoom: r.bbox ? zoomFromBbox(r.bbox) : 13,
          },
        };
        setState({ browse: next });

        const container = document.querySelector('[data-map-host]');
        if (container) {
          flyTo(container, { lat: r.lat, lng: r.lng, zoom: next.map.zoom });
        }
        setTimeout(() => loadMarkers(true), 900);
      },
      onClear: () => {
        const { browse } = getState();
        setState({ browse: { ...browse, filters: { ...browse.filters, city: '' } } });
      },
    }),
    h('div', { class: 'map-filters' },
      h('input', {
        type: 'date', value: f.checkIn || '',
        'data-focus-key': 'map-checkin',
        onchange: (e) => {
          const { browse } = getState();
          setState({ browse: { ...browse, filters: { ...browse.filters, checkIn: e.target.value } } });
          loadMarkers();
        },
      }),
      h('input', {
        type: 'date', value: f.checkOut || '',
        'data-focus-key': 'map-checkout',
        onchange: (e) => {
          const { browse } = getState();
          setState({ browse: { ...browse, filters: { ...browse.filters, checkOut: e.target.value } } });
          loadMarkers();
        },
      }),
      h('input', {
        type: 'number', placeholder: 'Guests', min: '1',
        value: f.guests || '1', class: 'small-input',
        'data-focus-key': 'map-guests',
        onchange: (e) => {
          const { browse } = getState();
          setState({ browse: { ...browse, filters: { ...browse.filters, guests: e.target.value } } });
          loadMarkers();
        },
      }),
      h('button', {
        class: 'btn ghost tiny',
        onclick: () => {
          setState({ browse: { ...getState().browse, view: 'list' } });
          writeMapStateToURL({ view: 'list', center: getState().browse.map.center, zoom: getState().browse.map.zoom, filters: getState().browse.filters });
        },
      }, '☰ List view'),
      h('button', {
        class: 'btn ghost tiny',
        onclick: saveSearchDialog,
      }, '🔔 Save search')
    )
  );
}

function ListingCardMini(m, state) {
  const isActive = state.activeId === m.id || state.hoverId === m.id;
  return h('article', {
    class: `map-card ${isActive ? 'is-active' : ''}`,
    'data-card-id': m.id,
    onmouseenter: () => {
      setState({ browse: { ...getState().browse, hoverId: m.id } });
    },
    onmouseleave: () => {
      setState({ browse: { ...getState().browse, hoverId: null } });
    },
    onclick: () => {
      setState({ browse: { ...getState().browse, activeId: m.id } });
      const container = document.querySelector('[data-map-host]');
      if (container) focusMarker(container, m.id);
      setTimeout(() => openDetail(m.id), 400);
    },
  },
    m.cover
      ? h('img', { src: m.cover, alt: '', class: 'map-card-cover' })
      : h('div', { class: 'map-card-cover placeholder' }, '—'),
    h('div', { class: 'map-card-body' },
      h('div', { class: 'map-card-title' }, m.title),
      h('div', { class: 'map-card-price' },
        h('strong', {}, fmtN(m.priceKobo)), h('small', {}, ' / night')),
      m.instant ? h('span', { class: 'chip small' }, '⚡ Instant') : null
    )
  );
}

/* ============================================================
   SAVE SEARCH DIALOG
   ============================================================ */

function saveSearchDialog() {
  const { browse, user } = getState();
  if (!user) { alert('Please log in to save searches.'); return; }

  const name = prompt('Name this search (e.g. "Lekki 2-bedroom under ₦100k"):');
  if (!name) return;

  const params = {
    city: browse.filters.city,
    center: browse.map.center,
    zoom: browse.map.zoom,
    checkIn: browse.filters.checkIn,
    checkOut: browse.filters.checkOut,
    guests: browse.filters.guests,
    minPrice: browse.filters.minPrice,
    maxPrice: browse.filters.maxPrice,
    type: browse.filters.type,
    amenities: browse.filters.amenities,
    instant: browse.filters.instant,
  };

  api.saveSearch(getState().accessToken, { name, params, notify: true })
    .then(() => setState({ browse: { ...getState().browse, toast: 'Search saved.' } }))
    .catch((err) => setState({ browse: { ...getState().browse, error: err.message } }));
}

function zoomFromBbox(bbox) {
  // bbox = [south, north, west, east] from Nominatim
  const latSpan = Math.abs(bbox[1] - bbox[0]);
  const lngSpan = Math.abs(bbox[3] - bbox[2]);
  const span = Math.max(latSpan, lngSpan);
  if (span < 0.01) return 15;
  if (span < 0.03) return 14;
  if (span < 0.1) return 13;
  if (span < 0.3) return 12;
  if (span < 1) return 10;
  return 8;
}

function openDetail(id) {
  // Delegates to existing openListing() in browse.js
  import('../browse.js').then((m) => m.openListing(id));
}