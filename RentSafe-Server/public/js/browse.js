import { h } from './mini.js';
import { getState, setState } from './store.js';
import { api } from './api.js';
import { GuestBookingPanel, loadGuestMonth } from './guest-booking.js';

const fmtN = (kobo) =>
  kobo == null ? '—' : `₦${(Number(kobo) / 100).toLocaleString('en-NG')}`;

const tonightISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};
const tomorrowISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
};

/* ============================================================
   SEARCH
   ============================================================ */

export function BrowseScreen() {
  const { browse } = getState();
  const r = browse.results;
  const f = browse.filters;

  const doSearch = (e) => {
    if (e) e.preventDefault();
    const form = e ? Object.fromEntries(new FormData(e.target).entries()) : f;
    setState({ browse: { ...browse, filters: form, page: 1, loading: true } });
    runSearch();
  };

  return h('main', { class: 'screen-wide' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'Find a place to stay'),
      h('button', { class: 'btn ghost', onclick: () => doSearch() }, '↻ Refresh'),
      h('button', {
        class: 'btn ghost',
        onclick: () => {
          setState({ browse: { ...getState().browse, view: 'map' } });
          writeMapStateToURL({
            view: 'map',
            center: getState().browse.map.center,
            zoom: getState().browse.map.zoom,
            filters: getState().browse.filters,
          });
          setTimeout(() => { mountBrowseMap(); loadMarkers(true); }, 50);
        },
      }, '🗺 Map view')
    ),
    h('form', { class: 'search-bar', onsubmit: doSearch },
      h('input', { name: 'city', placeholder: 'City', value: f.city || '' }),
      h('input', { name: 'checkIn', type: 'date', value: f.checkIn || tonightISO() }),
      h('input', { name: 'checkOut', type: 'date', value: f.checkOut || tomorrowISO() }),
      h('input', { name: 'guests', type: 'number', min: '1', placeholder: 'Guests', value: f.guests || '1' }),
      h('button', { type: 'submit', class: 'btn primary' }, 'Search')
    ),
    browse.error ? h('div', { class: 'alert error' }, browse.error) : null,
    browse.loading
      ? h('div', { class: 'loading-row' }, 'Loading…')
      : r.length === 0
        ? h('div', { class: 'empty' },
          h('div', { class: 'empty-icon' }, '🔍'),
          h('h3', {}, 'No listings match'),
          h('p', { class: 'muted' }, 'Try a different city or dates.'))
        : h('div', { class: 'search-grid' },
          r.map((item) => h('article', {
            class: 'listing-card',
            onclick: () => openListing(item.id),
          },
            h('div', { class: 'card-cover' },
              item.coverUrl
                ? h('img', { src: item.coverUrl, alt: '' })
                : h('div', { class: 'card-placeholder' }, 'No photo'),
              item.instantBook ? h('span', { class: 'instant-badge' }, '⚡ Instant') : null
            ),
            h('div', { class: 'card-body' },
              h('div', { class: 'card-head' },
                h('span', { class: 'muted small' }, `${item.neighborhood || ''}${item.neighborhood ? ', ' : ''}${item.city}`),
                h('span', { class: 'rating' },
                  item.averageRating ? `★ ${item.averageRating.toFixed(1)}` : 'New')
              ),
              h('h3', {}, item.title),
              h('div', { class: 'muted small' },
                `${item.bedrooms} bd · ${item.beds} bed · ${item.bathrooms} bath · ${item.maxGuests} guests`),
              h('div', { class: 'card-foot' },
                h('span', { class: 'price' }, fmtN(item.basePriceKobo), h('small', {}, ' / night')),
                item.verificationScore >= 70
                  ? h('span', { class: 'verified-badge' }, '✓ Verified')
                  : null
              )
            )
          ))
        ),
    browse.results.length > 0
      ? h('div', { class: 'pager' },
        h('button', {
          class: 'btn ghost', disabled: browse.page <= 1,
          onclick: () => { setState({ browse: { ...browse, page: browse.page - 1 } }); runSearch(); },
        }, 'Prev'),
        h('span', { class: 'muted' }, `Page ${browse.page}`),
        h('button', {
          class: 'btn ghost', disabled: browse.results.length < browse.pageSize,
          onclick: () => { setState({ browse: { ...browse, page: browse.page + 1 } }); runSearch(); },
        }, 'Next')
      )
      : null
  );
}

async function runSearch() {
  const { browse, accessToken } = getState();
  const q = {
    ...browse.filters,
    page: browse.page,
    pageSize: browse.pageSize,
  };
  try {
    const res = await api.searchListings(accessToken, q);
    setState({
      browse: {
        ...browse,
        loading: false,
        results: res.results,
        total: res.pagination.total,
        pages: res.pagination.pages,
      },
    });
  } catch (err) {
    setState({ browse: { ...browse, loading: false, error: err.message } });
  }
}

/* ============================================================
   LISTING DETAIL
   ============================================================ */

export async function openListing(id) {
  const { browse, accessToken } = getState();
  const now = new Date();
  setState({
    browse: {
      ...browse, view: 'detail', loading: false, current: data, currentId: id,
      calendar: {
        year: now.getUTCFullYear(), month: now.getUTCMonth(),
        data: null, selectedRange: null, pricing: null,
        loading: true, error: null, pricingLoading: false, pricingError: null,
      },
    },
  });
  loadGuestMonth(id, now.getUTCFullYear(), now.getUTCMonth());
  try {
    const data = await api.getListing(accessToken, id);
    setState({ browse: { ...browse, view: 'detail', loading: false, current: data, currentId: id } });

    api.nearbyListings(accessToken, id).then((res) => {
      const cur = getState().browse.current;
      if (cur?.id === id) {
        setState({ browse: { ...getState().browse, current: { ...cur, nearby: res.results } } });
        if (res.results.length) {
          setTimeout(() => {
            const container = document.querySelector('[data-nearby-map]');
            if (container) {
              import('./map/map-view.js').then((m) =>
                m.mountMiniMap(container, res.results, { lat: cur.location.lat, lng: cur.location.lng })
              );
            }
          }, 100);
        }
      }
    });
  } catch (err) {
    setState({ browse: { ...browse, view: 'detail', loading: false, error: err.message } });
  }
}

export function ListingDetail() {
  const { browse } = getState();
  const d = browse.current;

  if (browse.loading || !d) return h('main', { class: 'screen-wide' }, h('div', { class: 'loading-row' }, 'Loading…'));

  const back = () => setState({ browse: { ...browse, view: 'list', current: null } });

  return h('main', { class: 'screen-wide' },
    h('header', { class: 'page-head' },
      h('button', { class: 'btn ghost', onclick: back }, '← Back to results')
    ),
    h('div', { class: 'detail-layout' },
      h('section', { class: 'detail-main' },
        h('div', { class: 'gallery' },
          h('div', { class: 'gallery-main' },
            d.photos[0]
              ? h('img', { src: d.photos[0].url, alt: '' })
              : h('div', { class: 'card-placeholder' }, 'No photo')
          ),
          d.photos.length > 1
            ? h('div', { class: 'gallery-thumbs' },
              d.photos.slice(1, 6).map((p) =>
                h('img', { src: p.thumbnailUrl || p.url, alt: '' })
              )
            )
            : null
        ),
        h('h1', {}, d.title),
        h('div', { class: 'detail-meta' },
          h('span', { class: 'muted' },
            `${d.location.neighborhood || ''}${d.location.neighborhood ? ', ' : ''}${d.location.city}, ${d.location.state}`),
          d.verificationScore >= 70 ? h('span', { class: 'verified-badge' }, '✓ Verified by RentSafe') : null
        ),
        h('div', { class: 'verified-inline', id: 'verified-inline' }, ''),
        h('div', { class: 'detail-specs' },
          h('span', {}, `${d.listingType.replace(/_/g, ' ')}`),
          h('span', {}, `${d.bedrooms} bd · ${d.beds} bed · ${d.bathrooms} bath`),
          h('span', {}, `Max ${d.maxGuests} guests`),
          h('span', {}, `Check-in ${d.checkInTime} · Check-out ${d.checkOutTime}`)
        ),
        h('p', { class: 'detail-desc' }, d.description || 'No description yet.'),
        h('h3', {}, 'Amenities'),
        h('div', { class: 'amenity-list' },
          d.amenities.map((a) => h('span', { class: 'amenity-tag' }, a.name))
        ),
        d.houseRules ? h('section', {},
          h('h3', {}, 'House rules'),
          h('p', { class: 'muted' }, d.houseRules)
        ) : null,
        d.reviews.length > 0 ? h('section', {},
          h('h3', {}, `Reviews (${d.reviewCount})`),
          d.reviews.map((r) =>
            h('div', { class: 'review' },
              h('div', { class: 'review-head' },
                h('strong', {}, 'Guest'),
                h('span', { class: 'rating' }, `★ ${r.rating}`)),
              r.comment ? h('p', { class: 'muted' }, r.comment) : null
            )
          )
        ) : null,

        h('section', { class: 'nearby-section' },
          h('h3', {}, 'Other stays nearby'),
          h('div', { class: 'nearby-map', 'data-nearby-map': '' },
            h('div', { class: 'map-canvas', 'data-map-canvas': '' })
          ),
          h('div', { class: 'nearby-list' },
            (d.nearby || []).map((n) =>
              h('div', {
                class: 'nearby-item',
                onclick: () => openListing(n.id),
              },
                n.coverUrl ? h('img', { src: n.coverUrl, alt: '' }) : null,
                h('div', {},
                  h('div', { class: 'strong' }, n.title),
                  h('div', { class: 'muted small' }, `${(n.distanceMeters / 1000).toFixed(1)} km away`),
                  h('div', { class: 'strong' }, `₦${(n.basePriceKobo / 100).toLocaleString('en-NG')}`)
                )
              )
            )
          )
        )
      ),
      h('aside', { class: 'detail-side' }, GuestBookingPanel())
    )
  );
}

async function bookListing(listingId) {
  const { browse, accessToken } = getState();
  // Placeholder — hook up to the charge flow from the payments module
  try {
    const res = await api.createBooking(accessToken, {
      listingId,
      checkIn: browse.filters.checkIn,
      checkOut: browse.filters.checkOut,
      guests: Number(browse.filters.guests || 1),
    });
    window.location.href = res.authorizationUrl;
  } catch (err) {
    setState({ browse: { ...browse, error: err.message } });
  }
}