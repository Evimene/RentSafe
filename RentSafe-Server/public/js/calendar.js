import { h } from './mini.js';

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const DOW_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_MS = 86400000;

const isoDate = (d) => d.toISOString().slice(0, 10);

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

function monthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const leading = (first.getUTCDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function shortMoney(kobo) {
  const n = Number(kobo) / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${Math.round(n / 1_000)}k`;
  return `₦${Math.round(n)}`;
}

export function Calendar({
  mode,              // 'host' | 'guest'
  year, month,
  days,              // Map<isoDate, { available, booked, priceKobo, hasOverride }>
  basePriceKobo,
  selectedRange,     // { start, end } | null
  today = isoDate(new Date()),
  onMonthChange,
  onDayClick,        // host: toggle
  onRangeSelect,     // both: (start, end)
}) {
  let drag = null;

  function getState(iso) {
    const d = days.get(iso);
    if (!d) return { cls: 'cal-available', price: basePriceKobo, hasOverride: false, booked: false };
    if (d.booked) return { cls: 'cal-booked', ...d };
    if (!d.available) return { cls: 'cal-blocked', ...d };
    return { cls: 'cal-available', ...d };
  }

  const inRange = (iso) => selectedRange && iso >= selectedRange.start && iso <= selectedRange.end;

  const header = h('div', { class: 'cal-header' },
    h('button', {
      class: 'cal-nav', type: 'button',
      onclick: () => {
        const { year: y, month: m } = addMonths(year, month, -1);
        onMonthChange?.(y, m);
      },
    }, '‹'),
    h('div', { class: 'cal-title' }, `${MONTH_NAMES[month]} ${year}`),
    h('button', {
      class: 'cal-nav', type: 'button',
      onclick: () => {
        const { year: y, month: m } = addMonths(year, month, 1);
        onMonthChange?.(y, m);
      },
    }, '›')
  );

  const dowRow = h('div', { class: 'cal-dow' },
    DOW_NAMES.map((d) => h('div', { class: 'cal-dow-cell' }, d))
  );

  const grid = h('div', { class: 'cal-grid' },
    monthCells(year, month).map((date) => {
      if (!date) return h('div', { class: 'cal-cell cal-empty' });
      const iso = isoDate(date);
      const s = getState(iso);
      const isPast = iso < today;
      const cls = [
        'cal-cell', 'cal-day', s.cls,
        isPast ? 'cal-past' : '',
        inRange(iso) ? 'cal-selected' : '',
      ].filter(Boolean).join(' ');

      const showPrice = !isPast && !s.booked;
      const label = s.hasOverride ? shortMoney(s.price) : null;

      return h('button', {
        type: 'button',
        class: cls,
        'data-date': iso,
        disabled: isPast || (mode === 'host' && s.booked),
        onpointerdown: (e) => onPointerDown(e, iso, s),
      },
        h('span', { class: 'cal-day-num' }, String(date.getUTCDate())),
        showPrice && label ? h('span', { class: 'cal-price cal-price-custom' }, label) : null,
        s.booked ? h('span', { class: 'cal-marker' }, '•') : null
      );
    })
  );

  /* ---------- Pointer handling ---------- */

  function onPointerDown(e, iso, state) {
    if (e.button !== 0) return;
    e.preventDefault();

    if (mode === 'guest') {
      handleGuestClick(iso);
      return;
    }

    // Host mode: start drag-tracked click
    if (state.booked) return;
    drag = {
      anchor: iso, end: iso, startX: e.clientX, startY: e.clientY, moved: false,
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (!drag.moved && dist < 8) return;
    drag.moved = true;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest?.('[data-date]');
    if (!cell || cell.disabled) return;
    const iso = cell.dataset.date;
    if (iso === drag.end) return;
    drag.end = iso;
    paintPreview(drag.anchor < iso ? drag.anchor : iso, drag.anchor < iso ? iso : drag.anchor);
  }

  function paintPreview(start, end) {
    grid.querySelectorAll('[data-date]').forEach((cell) => {
      const d = cell.dataset.date;
      cell.classList.toggle('cal-dragging', d >= start && d <= end);
    });
  }

  function clearPreview() {
    grid.querySelectorAll('.cal-dragging').forEach((el) => el.classList.remove('cal-dragging'));
  }

  function onPointerUp() {
    const d = drag;
    drag = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    clearPreview();
    if (!d) return;

    if (!d.moved) {
      onDayClick?.(d.anchor);
    } else {
      const [s, e] = d.anchor < d.end ? [d.anchor, d.end] : [d.end, d.anchor];
      onRangeSelect?.(s, e);
    }
  }

  function handleGuestClick(iso) {
    if (!selectedRange) return onRangeSelect?.(iso, iso);
    if (selectedRange.start === selectedRange.end) {
      const [s, e] = iso < selectedRange.start
        ? [iso, selectedRange.start]
        : [selectedRange.start, iso];
      return onRangeSelect?.(s, e);
    }
    // Third tap: keep range if tapping inside it
    if (iso >= selectedRange.start && iso <= selectedRange.end) return;
    onRangeSelect?.(iso, iso);
  }

  return h('div', { class: `cal cal-${mode}` }, header, dowRow, grid);
}

export { isoDate };