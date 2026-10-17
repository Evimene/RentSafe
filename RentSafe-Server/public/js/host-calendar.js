import { h } from './mini.js';
import { getState, setState } from './store.js';
import { api } from './api.js';
import { Calendar, isoDate } from './calendar.js';

const DAY_MS = 86400000;
const fmtMoney = (k) => `₦${(Number(k) / 100).toLocaleString('en-NG')}`;

function datesInclusive(start, end) {
  const out = [];
  let cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    out.push(isoDate(cur));
    cur = new Date(cur.getTime() + DAY_MS);
  }
  return out;
}

function bookedSet(bookings = []) {
  const s = new Set();
  for (const b of bookings) {
    let cur = new Date(b.checkIn + 'T00:00:00Z');
    const end = new Date(b.checkOut + 'T00:00:00Z');
    while (cur < end) {
      s.add(isoDate(cur));
      cur = new Date(cur.getTime() + DAY_MS);
    }
  }
  return s;
}

/* ============================================================
   Loaders (exported so host.js can trigger them)
   ============================================================ */

export async function openHostCalendar(listingId, listingTitle) {
  const { host } = getState();
  const now = new Date();
  setState({
    host: {
      ...host,
      calendar: {
        open: true, loading: true, listingId, listingTitle,
        year: now.getUTCFullYear(), month: now.getUTCMonth(),
        data: null, selectedRange: null, priceOpen: false, error: null,
      },
    },
  });
  await loadHostCalendarMonth(listingId, now.getUTCFullYear(), now.getUTCMonth());
}

export async function loadHostCalendarMonth(listingId, year, month) {
  const { host, accessToken } = getState();
  const from = isoDate(new Date(Date.UTC(year, month, 1)));
  const to = isoDate(new Date(Date.UTC(year, month + 1, 0)));
  try {
    const data = await api.hostGetAvailability(accessToken, listingId, from, to);
    setState({
      host: {
        ...host,
        calendar: { ...host.calendar, year, month, data, loading: false, error: null },
      },
    });
  } catch (err) {
    setState({
      host: {
        ...host,
        calendar: { ...host.calendar, loading: false, error: err.message },
      },
    });
  }
}

/* ============================================================
   Modal
   ============================================================ */

export function HostCalendarModal() {
  const { host } = getState();
  const cal = host.calendar;
  if (!cal?.open) return null;

  const close = () => setState({ host: { ...host, calendar: { ...cal, open: false } } });

  const daysMap = new Map();
  if (cal.data) {
    const bs = bookedSet(cal.data.bookings);
    for (const d of cal.data.days) {
      daysMap.set(d.date, {
        available: d.isAvailable,
        booked: bs.has(d.date),
        priceKobo: d.priceOverrideKobo ?? cal.data.basePriceKobo,
        hasOverride: d.priceOverrideKobo != null,
      });
    }
    // Include booked days that have no listing_availability row
    for (const d of bs) {
      if (!daysMap.has(d)) {
        daysMap.set(d, {
          available: false,
          booked: true,
          priceKobo: cal.data.basePriceKobo,
          hasOverride: false,
        });
      }
    }
  }

  const handleMonthChange = (y, m) => {
    setState({ host: { ...host, calendar: { ...cal, year: y, month: m, selectedRange: null } } });
    loadHostCalendarMonth(cal.listingId, y, m);
  };

  const handleDayClick = async (iso) => {
    const d = daysMap.get(iso);
    if (d?.booked) return;
    const nextAvail = !(d && d.available === false);
    try {
      await api.hostBulkAvailability(getState().accessToken, cal.listingId, {
        updates: [{ date: iso, isAvailable: nextAvail }],
      });
      loadHostCalendarMonth(cal.listingId, cal.year, cal.month);
    } catch (err) {
      setState({ host: { ...host, calendar: { ...cal, error: err.message } } });
    }
  };

  const handleRangeSelect = (start, end) => {
    setState({ host: { ...host, calendar: { ...cal, selectedRange: { start, end } } } });
  };

  return h('div', {
    class: 'modal-backdrop',
    onclick: (e) => e.target === e.currentTarget && close(),
  },
    h('div', { class: 'modal modal-wide' },
      h('header', { class: 'page-head', style: { padding: '0 0 12px', margin: 0, borderBottom: '1px solid var(--line)' } },
        h('div', {},
          h('h2', { style: { margin: 0, fontSize: '18px' } }, 'Manage availability'),
          h('div', { class: 'muted small' }, cal.listingTitle || '')
        ),
        h('button', { class: 'btn ghost', onclick: close }, 'Close')
      ),

      cal.error ? h('div', { class: 'alert error', style: { marginTop: '12px' } }, cal.error) : null,

      h('div', { class: 'cal-legend', style: { marginTop: '12px' } },
        h('span', { class: 'cal-legend-item' }, h('span', { class: 'dot dot-avail' }), 'Available'),
        h('span', { class: 'cal-legend-item' }, h('span', { class: 'dot dot-blocked' }), 'Blocked'),
        h('span', { class: 'cal-legend-item' }, h('span', { class: 'dot dot-booked' }), 'Booked'),
        h('span', { class: 'cal-legend-item' }, h('span', { class: 'dot dot-override' }), 'Custom price')
      ),

      cal.loading
        ? h('div', { class: 'loading-row' }, 'Loading…')
        : Calendar({
            mode: 'host',
            year: cal.year,
            month: cal.month,
            days: daysMap,
            basePriceKobo: cal.data?.basePriceKobo || 0,
            selectedRange: cal.selectedRange,
            onMonthChange: handleMonthChange,
            onDayClick: handleDayClick,
            onRangeSelect: handleRangeSelect,
          }),

      cal.selectedRange
        ? RangeActions({
            range: cal.selectedRange,
            listingId: cal.listingId,
            basePriceKobo: cal.data?.basePriceKobo || 0,
            onClear: () => setState({
              host: { ...host, calendar: { ...cal, selectedRange: null, priceOpen: false } },
            }),
            onApplied: () => {
              setState({ host: { ...host, calendar: { ...cal, selectedRange: null, priceOpen: false } } });
              loadHostCalendarMonth(cal.listingId, cal.year, cal.month);
            },
          })
        : h('div', { class: 'cal-hint muted small' },
            'Click a date to toggle. Drag to select a range.')
    )
  );
}

/* ============================================================
   Range action bar
   ============================================================ */

function RangeActions({ range, listingId, basePriceKobo, onClear, onApplied }) {
  const { host } = getState();
  const cal = host.calendar;
  const dates = datesInclusive(range.start, range.end);
  const priceOpen = cal.priceOpen;

  const setPriceOpen = (v) => setState({ host: { ...host, calendar: { ...cal, priceOpen: v } } });

  const bulk = async (updates) => {
    try {
      await api.hostBulkAvailability(getState().accessToken, listingId, { updates });
      onApplied();
    } catch (err) {
      setState({ host: { ...host, calendar: { ...cal, error: err.message } } });
    }
  };

  const block = () => bulk(dates.map((d) => ({ date: d, isAvailable: false })));
  const unblock = () => bulk(dates.map((d) => ({ date: d, isAvailable: true })));

  const clearOverrides = async () => {
    try {
      await api.hostClearOverrides(getState().accessToken, listingId, { dates });
      onApplied();
    } catch (err) {
      setState({ host: { ...host, calendar: { ...cal, error: err.message } } });
    }
  };

  const applyPrice = (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.target).entries());
    const priceKobo = form.price ? Math.round(Number(form.price) * 100) : null;
    const minNights = form.minNights ? Number(form.minNights) : null;
    bulk(dates.map((d) => ({
      date: d,
      priceOverrideKobo: priceKobo,
      minNightsOverride: minNights,
    })));
  };

  return h('div', { class: 'range-actions' },
    h('div', { class: 'range-label' },
      h('strong', {}, `${dates.length} night${dates.length > 1 ? 's' : ''}`),
      h('span', { class: 'muted small' }, ` · ${range.start} → ${range.end}`)
    ),
    h('div', { class: 'range-buttons' },
      h('button', { class: 'btn danger tiny', onclick: block }, 'Block range'),
      h('button', { class: 'btn success tiny', onclick: unblock }, 'Unblock range'),
      h('button', {
        class: 'btn ghost tiny',
        onclick: () => setPriceOpen(!priceOpen),
      }, priceOpen ? 'Close price form' : 'Set price…'),
      h('button', { class: 'btn ghost tiny', onclick: clearOverrides }, 'Clear overrides'),
      h('button', { class: 'btn ghost tiny', onclick: onClear }, '✕')
    ),
    priceOpen
      ? h('form', { class: 'range-price-form', onsubmit: applyPrice },
          h('div', { class: 'grid-2' },
            h('label', { class: 'field' },
              h('span', { class: 'label' }, 'Price per night (₦)'),
              h('input', {
                name: 'price', type: 'number', min: '1', step: '500',
                placeholder: `Default: ${fmtMoney(basePriceKobo)}`,
                'data-focus-key': 'range-price',
              })
            ),
            h('label', { class: 'field' },
              h('span', { class: 'label' }, 'Min nights (optional)'),
              h('input', { name: 'minNights', type: 'number', min: '1' })
            )
          ),
          h('div', { class: 'range-form-actions' },
            h('button', { type: 'button', class: 'btn ghost tiny',
              onclick: () => setPriceOpen(false) }, 'Cancel'),
            h('button', { type: 'submit', class: 'btn primary tiny' }, 'Apply to range')
          )
        )
      : null
  );
}