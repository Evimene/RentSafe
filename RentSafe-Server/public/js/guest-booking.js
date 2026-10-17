import { h } from './mini.js';
import { getState, setState } from './store.js';
import { api } from './api.js';
import { Calendar, isoDate } from './calendar.js';

const DAY_MS = 86400000;
const fmtMoney = (k) => `₦${(Number(k) / 100).toLocaleString('en-NG')}`;

function datesNights(checkIn, checkOut) {
  const out = [];
  let cur = new Date(checkIn + 'T00:00:00Z');
  const end = new Date(checkOut + 'T00:00:00Z');
  while (cur < end) {
    out.push(isoDate(cur));
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return out;
}

export async function loadGuestMonth(listingId, year, month) {
  const { browse, accessToken } = getState();
  const from = isoDate(new Date(Date.UTC(year, month, 1)));
  const to = isoDate(new Date(Date.UTC(year, month + 1, 0)));
  setState({ browse: { ...browse, calendar: { ...(browse.calendar || {}), year, month, loading: true } } });
  try {
    const data = await api.publicAvailability(accessToken, listingId, from, to);
    setState({
      browse: {
        ...browse,
        calendar: { ...browse.calendar, year, month, data, loading: false, error: null },
      },
    });
  } catch (err) {
    setState({
      browse: {
        ...browse,
        calendar: { ...browse.calendar, loading: false, error: err.message },
      },
    });
  }
}

async function loadPrice(listingId, checkIn, checkOut) {
  const { browse, accessToken } = getState();
  setState({
    browse: {
      ...browse,
      calendar: { ...browse.calendar, pricing: null, pricingError: null, pricingLoading: true },
    },
  });
  try {
    const pricing = await api.priceListing(accessToken, listingId, checkIn, checkOut);
    setState({
      browse: {
        ...browse,
        calendar: { ...browse.calendar, pricing, pricingLoading: false, pricingError: null },
      },
    });
  } catch (err) {
    setState({
      browse: {
        ...browse,
        calendar: { ...browse.calendar, pricing: null, pricingLoading: false, pricingError: err.message },
      },
    });
  }
}

/* ============================================================
   Panel
   ============================================================ */

export function GuestBookingPanel() {
  const { browse } = getState();
  const d = browse.current;
  const cal = browse.calendar || {};
  if (!d) return null;

  const now = new Date();
  const year = cal.year ?? now.getUTCFullYear();
  const month = cal.month ?? now.getUTCMonth();

  const daysMap = new Map();
  if (cal.data) {
    for (const day of cal.data.days) {
      daysMap.set(day.date, {
        available: day.available,
        booked: day.booked,
        priceKobo: day.priceKobo,
        hasOverride: day.hasOverride,
        minNights: day.minNights,
      });
    }
  }

  const handleMonthChange = (y, m) => {
    setState({
      browse: { ...browse, calendar: { ...cal, year: y, month: m, selectedRange: null, pricing: null } },
    });
    loadGuestMonth(d.id, y, m);
  };

  const handleRangeSelect = (start, end) => {
    // Reject if any night in range is blocked or booked
    const nights = start === end ? [start] : datesNights(start, end);
    const bad = nights.filter((iso) => {
      const day = daysMap.get(iso);
      return day && (!day.available || day.booked);
    });
    if (bad.length) {
      setState({
        browse: {
          ...browse,
          calendar: { ...cal, year, month, error: `Not available: ${bad.slice(0, 3).join(', ')}` },
        },
      });
      return;
    }
    setState({
      browse: {
        ...browse,
        calendar: { ...cal, year, month, error: null, selectedRange: { start, end }, pricing: null },
      },
    });
    if (start !== end) loadPrice(d.id, start, end);
  };

  const reserve = () => {
    const range = cal.selectedRange;
    if (!range || range.start === range.end) return;
    // Hook into the existing booking → charge flow
    bookListing(d.id, range);
  };

  return h('div', { class: 'book-card' },
    h('div', { class: 'price-block' },
      h('span', { class: 'big-price' }, fmtMoney(d.basePriceKobo)),
      h('span', { class: 'muted' }, ' / night')
    ),

    cal.error ? h('div', { class: 'alert error small' }, cal.error) : null,

    h('div', { class: 'booking-calendar' },
      cal.loading
        ? h('div', { class: 'loading-row small' }, 'Loading availability…')
        : Calendar({
            mode: 'guest',
            year, month,
            days: daysMap,
            basePriceKobo: d.basePriceKobo,
            selectedRange: cal.selectedRange,
            onMonthChange: handleMonthChange,
            onDayClick: () => {},
            onRangeSelect: handleRangeSelect,
          })
    ),

    cal.selectedRange && cal.selectedRange.start !== cal.selectedRange.end
      ? PriceSummary(cal, cal.selectedRange)
      : null,

    cal.selectedRange && cal.selectedRange.start !== cal.selectedRange.end
        && cal.pricing && !cal.pricingError && !cal.pricingLoading
      ? h('button', { class: 'btn primary block', onclick: reserve }, 'Reserve')
      : null,

    !cal.selectedRange
      ? h('p', { class: 'muted small center' }, 'Select check-in and check-out dates')
      : cal.selectedRange.start === cal.selectedRange.end
        ? h('p', { class: 'muted small center' }, 'Now select your check-out date')
        : null
  );
}

function PriceSummary(cal, range) {
  if (cal.pricingLoading) return h('div', { class: 'loading-row small' }, 'Calculating…');
  if (cal.pricingError) return h('div', { class: 'alert error small' }, cal.pricingError);
  const p = cal.pricing;
  if (!p) return null;

  return h('div', { class: 'price-breakdown' },
    h('div', { class: 'price-range-label' },
      h('strong', {}, `${p.nights} night${p.nights > 1 ? 's' : ''}`),
      h('span', { class: 'muted small' }, ` · ${range.start} → ${range.end}`)
    ),
    h('div', {}, h('span', {}, 'Subtotal'), h('strong', {}, fmtMoney(p.subtotalKobo))),
    p.cleaningFeeKobo > 0
      ? h('div', {}, h('span', {}, 'Cleaning fee'), h('strong', {}, fmtMoney(p.cleaningFeeKobo)))
      : null,
    p.securityDepositKobo > 0
      ? h('div', {}, h('span', {}, 'Security deposit'), h('strong', {}, fmtMoney(p.securityDepositKobo)))
      : null,
    h('div', {}, h('span', {}, 'Platform fee'), h('strong', {}, fmtMoney(p.platformFeeKobo))),
    h('div', { class: 'total' },
      h('span', {}, 'Total'),
      h('strong', {}, fmtMoney(p.totalKobo))
    )
  );
}

async function bookListing(listingId, range) {
  const { browse, accessToken } = getState();
  try {
    const res = await api.createBooking(accessToken, {
      listingId,
      checkIn: range.start,
      checkOut: range.end,
      guests: Number(browse.filters?.guests || 1),
    });
    window.location.href = res.authorizationUrl;
  } catch (err) {
    setState({
      browse: { ...browse, calendar: { ...browse.calendar, error: err.message } },
    });
  }
}