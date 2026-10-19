import { h } from './mini.js';
import { getState, setState } from './store.js';
import { api } from './api.js';

const fmtMoney = (kobo) => kobo == null ? '—' : `₦${(Number(kobo) / 100).toLocaleString('en-NG')}`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('en-NG', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—';

const STATUS_LABEL = {
  assigned: 'Assigned',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

function StatusPill({ status }) {
  return h('span', { class: `pill ${status}` }, STATUS_LABEL[status] || status);
}

/* ============================================================
   DASHBOARD SHELL
   ============================================================ */

export function InspectorShell({ children }) {
  const { user, inspector } = getState();
  const view = inspector.view;

  const nav = (key, label, badge) =>
    h('button', {
      class: `nav-item ${view === key ? 'active' : ''}`,
      onclick: () => {
        setState({ inspector: { ...inspector, view: key, detail: null } });
        if (key === 'queue')    loadQueue();
        if (key === 'history')  loadHistory();
        if (key === 'earnings') loadEarnings();
        if (key === 'profile')  loadProfile();
      },
    }, h('span', {}, label),
       badge ? h('span', { class: 'badge' }, badge) : null);

  return h('div', { class: 'admin-shell' },
    h('aside', { class: 'admin-side' },
      h('div', { class: 'admin-brand' }, 'RentSafe', h('span', { class: 'admin-tag' }, 'Inspector')),
      h('nav', {},
        nav('queue', 'Queue', inspector.queue?.length || 0),
        nav('history', 'History'),
        nav('earnings', 'Earnings'),
        nav('profile', 'Profile')
      ),
      h('div', { class: 'admin-me' },
        h('div', { class: 'avatar' }, `${(user?.firstName || '?')[0]}${(user?.lastName || '?')[0]}`),
        h('div', {},
          h('div', { class: 'name' }, `${user?.firstName || ''} ${user?.lastName || ''}`.trim()),
          h('div', { class: 'role' }, 'Inspector'))
      ),
      h('button', {
        class: 'link', style: { marginTop: '12px' },
        onclick: async () => {
          try { await api.logout({ refreshToken: getState().refreshToken }); } catch {}
          localStorage.removeItem('refreshToken');
          setState({ accessToken: null, refreshToken: null, user: null, route: 'login' });
        },
      }, 'Sign out')
    ),
    h('main', { class: 'admin-main' },
      inspector.error ? h('div', { class: 'alert error' }, inspector.error) : null,
      inspector.flash ? h('div', { class: 'alert success' }, inspector.flash) : null,
      children
    )
  );
}

/* ============================================================
   QUEUE
   ============================================================ */

export function InspectorQueue() {
  const { inspector } = getState();
  const items = inspector.queue || [];

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'My queue'),
      h('button', { class: 'btn ghost', onclick: loadQueue }, 'Refresh')
    ),
    items.length === 0
      ? h('div', { class: 'empty' },
          h('div', { class: 'empty-icon' }, '✓'),
          h('h3', {}, 'Nothing in your queue'),
          h('p', { class: 'muted' }, 'You\'ll be notified when a new inspection is assigned.'))
      : h('div', { class: 'inspection-list' },
          items.map((item) => h('article', {
            class: 'inspection-card',
            onclick: () => openDetail(item.id),
          },
            h('div', { class: 'ic-cover' },
              item.listing.coverUrl
                ? h('img', { src: item.listing.coverUrl, alt: '' })
                : h('div', { class: 'lac-placeholder' }, '—')
            ),
            h('div', { class: 'ic-body' },
              h('div', { class: 'ic-head' },
                h('h3', {}, item.listing.title),
                StatusPill({ status: item.status })
              ),
              h('div', { class: 'muted small' },
                `${item.listing.neighborhood || ''}${item.listing.neighborhood ? ', ' : ''}${item.listing.city}`),
              h('div', { class: 'muted small' }, item.listing.addressLine1),
              h('div', { class: 'ic-meta' },
                h('span', {}, 'Ref: ', h('code', {}, item.reference)),
                item.scheduledAt
                  ? h('span', {}, 'Scheduled: ', fmtDate(item.scheduledAt))
                  : null,
                item.distanceToPropertyM != null
                  ? h('span', {}, `${Math.round(item.distanceToPropertyM)}m from property`)
                  : null
              ),
              item.flags?.length
                ? h('div', { class: 'alert error small' },
                    `Flags: ${item.flags.join(', ')}`)
                : null
            )
          ))
        )
  );
}

/* ============================================================
   HISTORY
   ============================================================ */

export function InspectorHistory() {
  const { inspector } = getState();
  const items = inspector.history || [];

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'History'),
      h('button', { class: 'btn ghost', onclick: loadHistory }, 'Refresh')
    ),
    items.length === 0
      ? h('div', { class: 'empty' }, h('h3', {}, 'No completed inspections yet'))
      : h('div', { class: 'table-wrap' },
          h('table', { class: 'data-table' },
            h('thead', {},
              h('tr', {},
                h('th', {}, 'Listing'),
                h('th', {}, 'Submitted'),
                h('th', {}, 'Score'),
                h('th', {}, 'Status')
              )
            ),
            h('tbody', {},
              items.map((r) =>
                h('tr', {
                  class: 'clickable',
                  onclick: () => openDetail(r.id),
                },
                  h('td', {}, r.listing.title),
                  h('td', { class: 'muted small' }, fmtDate(r.submittedAt)),
                  h('td', {},
                    r.score != null
                      ? h('strong', { class: r.score >= 70 ? 'text-ok' : 'text-bad' }, `${r.score}`)
                      : '—'
                  ),
                  h('td', {}, StatusPill({ status: r.status }))
                )
              )
            )
          )
        )
  );
}

/* ============================================================
   EARNINGS
   ============================================================ */

export function InspectorEarnings() {
  const { inspector } = getState();
  const p = inspector.profile;
  const items = inspector.earnings || [];

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'Earnings'),
      h('button', { class: 'btn ghost', onclick: loadEarnings }, 'Refresh')
    ),
    p ? h('div', { class: 'stats' },
      h('div', { class: 'stat ok' },
        h('div', { class: 'stat-value' }, fmtMoney(p.earnings.paidKobo)),
        h('div', { class: 'stat-label' }, 'Total paid')),
      h('div', { class: 'stat warn' },
        h('div', { class: 'stat-value' }, fmtMoney(p.earnings.pendingKobo)),
        h('div', { class: 'stat-label' }, 'Pending')),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-value' }, p.stats.approved),
        h('div', { class: 'stat-label' }, 'Approved')),
      h('div', { class: 'stat' },
        h('div', { class: 'stat-value' }, fmtMoney(p.ratePerInspectionKobo)),
        h('div', { class: 'stat-label' }, 'Per inspection'))
    ) : null,
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data-table' },
        h('thead', {},
          h('tr', {},
            h('th', {}, 'Date'),
            h('th', {}, 'Inspection'),
            h('th', {}, 'Listing'),
            h('th', {}, 'Amount'),
            h('th', {}, 'Status')
          )
        ),
        h('tbody', {},
          items.map((r) =>
            h('tr', {},
              h('td', { class: 'muted small' }, fmtDate(r.createdAt)),
              h('td', {}, h('code', {}, r.inspectionReference)),
              h('td', {}, r.listingTitle),
              h('td', {}, h('strong', {}, fmtMoney(r.amountKobo))),
              h('td', {}, h('span', { class: `pill ${r.status}` }, r.status))
            )
          )
        )
      )
    )
  );
}

/* ============================================================
   PROFILE
   ============================================================ */

export function InspectorProfile() {
  const { inspector } = getState();
  const p = inspector.profile;

  if (!p) return h('div', { class: 'admin-page' }, 'Loading…');

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'My profile')
    ),
    h('div', { class: 'detail-layout' },
      h('section', { class: 'card flat' },
        h('h2', {}, 'Account'),
        h('div', { class: 'info-row' },
          h('div', { class: 'info-label' }, 'Name'),
          h('div', { class: 'info-value' }, `${p.firstName} ${p.lastName}`)),
        h('div', { class: 'info-row' },
          h('div', { class: 'info-label' }, 'Phone'),
          h('div', { class: 'info-value' }, p.phone)),
        h('div', { class: 'info-row' },
          h('div', { class: 'info-label' }, 'KYC'),
          h('div', { class: 'info-value' },
            h('span', { class: `pill ${p.kycStatus}` }, p.kycStatus))),
        h('div', { class: 'info-row' },
          h('div', { class: 'info-label' }, 'Rate'),
          h('div', { class: 'info-value' }, `${fmtMoney(p.ratePerInspectionKobo)} / inspection`))
      ),
      h('section', { class: 'card flat' },
        h('h2', {}, 'Service areas'),
        h('form', {
          onsubmit: async (e) => {
            e.preventDefault();
            const form = Object.fromEntries(new FormData(e.target).entries());
            try {
              await api.inspectorUpdateProfile(getState().accessToken, {
                serviceAreas: form.serviceAreas.split(',').map((s) => s.trim()).filter(Boolean),
                neighborhoods: form.neighborhoods.split(',').map((s) => s.trim()).filter(Boolean),
                bio: form.bio,
              });
              setState({ inspector: { ...inspector, flash: 'Saved.' } });
              loadProfile();
            } catch (err) {
              setState({ inspector: { ...inspector, error: err.message } });
            }
          },
        },
          h('label', { class: 'field' },
            h('span', { class: 'label' }, 'Cities (comma-separated)'),
            h('input', {
              name: 'serviceAreas',
              value: (p.serviceAreas || []).join(', '),
              'data-focus-key': 'insp-areas',
            })),
          h('label', { class: 'field' },
            h('span', { class: 'label' }, 'Neighborhoods (comma-separated)'),
            h('input', {
              name: 'neighborhoods',
              value: (p.neighborhoods || []).join(', '),
              'data-focus-key': 'insp-neighborhoods',
            })),
          h('label', { class: 'field' },
            h('span', { class: 'label' }, 'Bio'),
            h('textarea', { name: 'bio', rows: 3 }, p.bio || '')),
          h('button', { type: 'submit', class: 'btn primary' }, 'Save')
        )
      ),
      h('section', { class: 'card flat' },
        h('h2', {}, 'Performance'),
        h('div', { class: 'info-row' },
          h('div', { class: 'info-label' }, 'Total inspections'),
          h('div', { class: 'info-value' }, p.stats.total)),
        h('div', { class: 'info-row' },
          h('div', { class: 'info-label' }, 'Approved'),
          h('div', { class: 'info-value' }, p.stats.approved)),
        h('div', { class: 'info-row' },
          h('div', { class: 'info-label' }, 'Rejected'),
          h('div', { class: 'info-value' }, p.stats.rejected)),
        h('div', { class: 'info-row' },
          h('div', { class: 'info-label' }, 'Avg duration'),
          h('div', { class: 'info-value' },
            p.stats.avgDurationMinutes != null ? `${p.stats.avgDurationMinutes} min` : '—'))
      )
    )
  );
}

/* ============================================================
   INSPECTION DETAIL (mobile-first for field use)
   ============================================================ */

export function InspectorInspectionDetail() {
  const { inspector } = getState();
  const d = inspector.detail;

  if (!d) return h('div', { class: 'admin-page' }, 'Loading…');

  const goBack = () => {
    setState({ inspector: { ...inspector, view: 'queue', detail: null } });
    loadQueue();
  };

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('button', { class: 'btn ghost', onclick: goBack }, '← Back'),
      h('div', { class: 'head-right' }, StatusPill({ status: d.status }))
    ),

    h('section', { class: 'card flat' },
      h('h1', { style: { margin: 0, fontSize: '20px' } }, d.listing.title),
      h('div', { class: 'muted' },
        `${d.listing.addressLine1}${d.listing.addressLine2 ? ', ' + d.listing.addressLine2 : ''}`),
      h('div', { class: 'muted' },
        `${d.listing.neighborhood || ''}${d.listing.neighborhood ? ', ' : ''}${d.listing.city}, ${d.listing.state}`),
      h('div', { class: 'info-row', style: { marginTop: '12px' } },
        h('div', { class: 'info-label' }, 'Reference'),
        h('div', { class: 'info-value' }, h('code', {}, d.reference))),
      h('div', { class: 'info-row' },
        h('div', { class: 'info-label' }, 'Scheduled'),
        h('div', { class: 'info-value' }, fmtDate(d.scheduledAt)))
    ),

    d.status === 'assigned'
      ? h('section', { class: 'card flat' },
          h('h2', {}, 'Accept this inspection'),
          h('p', { class: 'muted' }, 'Accepting confirms you will complete the visit within 48 hours.'),
          h('button', {
            class: 'btn primary',
            onclick: async () => {
              try {
                await api.inspectorAccept(getState().accessToken, d.id);
                setState({ inspector: { ...inspector, flash: 'Accepted. Navigate to the property when ready.' } });
                loadDetail(d.id);
              } catch (err) {
                setState({ inspector: { ...inspector, error: err.message } });
              }
            },
          }, 'Accept inspection'))
      : null,

    d.status === 'scheduled'
      ? h('section', { class: 'card flat' },
          h('h2', {}, 'Start inspection'),
          h('p', { class: 'muted' }, 'You must be within 500m of the property. GPS will be recorded.'),
          h('button', {
            class: 'btn primary',
            onclick: () => startFlow(d),
          }, '📍 Start inspection at this location'))
      : null,

    d.status === 'in_progress'
      ? InspectionForm(d)
      : null,

    d.status === 'submitted' || d.status === 'approved' || d.status === 'rejected'
      ? InspectionReport(d)
      : null,

    d.status === 'approved' && d.earnings
      ? h('div', { class: 'alert success' }, `Earned ${fmtMoney(d.earnings.amountKobo)}`)
      : null
  );
}

/* ============================================================
   START FLOW — GPS + selfie
   ============================================================ */

function startFlow(d) {
  if (!navigator.geolocation) {
    alert('Geolocation is not available in this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      try {
        const res = await api.inspectorStart(getState().accessToken, d.id, {
          lat, lng, accuracyM: accuracy,
        });
        setState({ inspector: { ...getState().inspector, flash: `Started. You are ${res.distanceToPropertyM}m from the property.` } });
        loadDetail(d.id);
      } catch (err) {
        alert(err.message || 'Failed to start');
      }
    },
    (err) => alert('Could not get your location: ' + err.message),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

/* ============================================================
   INSPECTION FORM (checklist + photos + selfie + submit)
   ============================================================ */

function InspectionForm(d) {
  const { inspector } = getState();
  const state = inspector.form || {
    answers: {},
    photos: [],
    selfieUrl: null,
    uploading: false,
  };

  const setForm = (patch) =>
    setState({ inspector: { ...inspector, form: { ...state, ...patch } } });

  const setAnswer = (key, answer) => {
    setForm({ answers: { ...state.answers, [key]: answer } });
  };

  const uploadPhoto = async (file, category, itemKey) => {
    const geo = await getGeo().catch(() => null);
    const fd = new FormData();
    fd.append('photo', file);
    if (category) fd.append('category', category);
    if (itemKey)   fd.append('itemKey', itemKey);
    if (geo) {
      fd.append('lat', geo.lat);
      fd.append('lng', geo.lng);
      fd.append('accuracyM', geo.accuracy);
    }
    setForm({ uploading: true });
    try {
      const res = await api.inspectorUploadPhoto(getState().accessToken, d.id, fd);
      setForm({
        uploading: false,
        photos: [...state.photos, res],
      });
    } catch (err) {
      setForm({ uploading: false });
      alert('Photo upload failed: ' + err.message);
    }
  };

  const uploadSelfie = async (file) => {
    const geo = await getGeo().catch(() => null);
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('category', 'selfie');
    if (geo) {
      fd.append('lat', geo.lat);
      fd.append('lng', geo.lng);
      fd.append('accuracyM', geo.accuracy);
    }
    setForm({ uploading: true });
    try {
      const res = await api.inspectorUploadPhoto(getState().accessToken, d.id, fd);
      setForm({
        uploading: false,
        selfieUrl: res.url,
        photos: [...state.photos, res],
      });
    } catch (err) {
      setForm({ uploading: false });
      alert('Selfie upload failed: ' + err.message);
    }
  };

  const submit = async () => {
    if (!state.selfieUrl) {
      alert('Please take a selfie at the property first.');
      return;
    }
    const geo = await getGeo().catch(() => null);
    if (!geo) { alert('Could not get your location. Try again.'); return; }

    try {
      const res = await api.inspectorSubmit(getState().accessToken, d.id, {
        answers: state.answers,
        lat: geo.lat, lng: geo.lng, accuracyM: geo.accuracy,
        selfieUrl: state.selfieUrl,
        deviceInfo: { ua: navigator.userAgent, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      setState({
        inspector: {
          ...getState().inspector,
          flash: `Submitted. Score: ${res.score}.`,
          view: 'queue',
          detail: null,
          form: null,
        },
      });
      loadQueue();
    } catch (err) {
      alert('Submit failed: ' + err.message);
    }
  };

  return h('section', { class: 'card flat' },
    h('h2', {}, 'Selfie at location (required)'),
    h('div', { class: 'selfie-zone' },
      state.selfieUrl
        ? h('div', { class: 'selfie-preview' },
            h('img', { src: state.selfieUrl, alt: 'Selfie' }))
        : h('label', { class: 'upload-zone' },
            h('input', {
              type: 'file', accept: 'image/*', capture: 'user',
              style: { display: 'none' },
              onchange: (e) => {
                const file = e.target.files?.[0];
                if (file) uploadSelfie(file);
              },
            }),
            h('div', { class: 'upload-icon' }, '🤳'),
            h('div', {}, 'Take selfie at property'),
            h('div', { class: 'muted small' }, 'Your GPS will be recorded')
          )
    ),

    h('h2', { style: { marginTop: '24px' } }, 'Checklist'),

    (d.template.definition.categories || []).map((cat) =>
      h('div', { class: 'checklist-cat' },
        h('h3', {}, cat.label),
        cat.items.map((item) => {
          const itemKey = item.key;
          const answer = state.answers[itemKey];
          return h('div', { class: 'checklist-item' },
            h('div', { class: 'ci-label' }, item.label,
              item.require_photo
                ? h('span', { class: 'muted small' }, ' · photo required')
                : null
            ),
            h('div', { class: 'ci-answers' },
              ['pass','partial','fail','na'].map((v) =>
                h('button', {
                  class: `ci-btn ${answer === v ? 'active' : ''} ci-${v}`,
                  onclick: () => setAnswer(itemKey, v),
                  type: 'button',
                }, v === 'pass' ? '✓ Pass' : v === 'partial' ? '~ Partial' : v === 'fail' ? '✕ Fail' : 'N/A')
              )
            ),
            item.require_photo
              ? h('label', { class: 'ci-photo-btn' },
                  h('input', {
                    type: 'file', accept: 'image/*', capture: 'environment',
                    style: { display: 'none' },
                    onchange: (e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadPhoto(file, cat.key, itemKey);
                    },
                  }),
                  state.photos.find((p) => p.item_key === itemKey)
                    ? h('span', { class: 'chip' }, '✓ Photo')
                    : h('span', { class: 'btn ghost tiny' }, '+ Photo')
                )
              : null
          );
        })
      )
    ),

    h('div', { class: 'photos-section' },
      h('h3', {}, `Photos (${state.photos.length})`),
      h('div', { class: 'photo-grid' },
        state.photos.map((p) =>
          h('div', { class: 'photo-tile' },
            h('img', { src: p.url, alt: '' }),
            h('span', { class: 'cover-badge' }, p.category || 'photo')
          )
        ),
        h('label', { class: 'upload-tile' },
          h('input', {
            type: 'file', accept: 'image/*', capture: 'environment',
            style: { display: 'none' },
            onchange: (e) => {
              const file = e.target.files?.[0];
              if (file) uploadPhoto(file, 'general', null);
            },
          }),
          state.uploading ? 'Uploading…' : '+ Add photo'
        )
      )
    ),

    h('div', { class: 'wizard-actions' },
      h('button', {
        class: 'btn ghost',
        onclick: () => {
          if (confirm('Discard this inspection? You will need to start over.')) {
            setState({ inspector: { ...inspector, form: null, view: 'queue', detail: null } });
          }
        },
      }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: submit,
        disabled: state.uploading || !state.selfieUrl,
      }, 'Submit inspection')
    )
  );
}

/* ============================================================
   REPORT (read-only)
   ============================================================ */

function InspectionReport(d) {
  return h('section', { class: 'card flat' },
    h('h2', {}, 'Report'),
    h('div', { class: 'info-row' },
      h('div', { class: 'info-label' }, 'Score'),
      h('div', { class: 'info-value' },
        h('strong', {
          class: d.score >= 70 ? 'text-ok' : 'text-bad',
          style: { fontSize: '20px' },
        }, `${d.score}/100`))),
    h('div', { class: 'info-row' },
      h('div', { class: 'info-label' }, 'Duration'),
      h('div', { class: 'info-value' },
        d.durationSeconds ? `${Math.round(d.durationSeconds / 60)} min` : '—')),
    h('div', { class: 'info-row' },
      h('div', { class: 'info-label' }, 'Distance'),
      h('div', { class: 'info-value' },
        d.distanceToPropertyM != null ? `${Math.round(d.distanceToPropertyM)}m` : '—')),
    d.flaggedReasons?.length
      ? h('div', { class: 'alert error small' },
          'Flags: ' + d.flaggedReasons.join(', '))
      : null,
    d.reviewNotes ? h('div', { class: 'muted small' }, `Admin notes: ${d.reviewNotes}`) : null,
    d.rejectionReason ? h('div', { class: 'alert error' }, d.rejectionReason) : null,

    h('h3', {}, 'Category scores'),
    Object.entries(d.categoryScores || {}).map(([k, v]) =>
      h('div', { class: 'info-row' },
        h('div', { class: 'info-label' }, k),
        h('div', { class: 'info-value' }, v != null ? `${v}/100` : '—'))
    ),

    h('h3', {}, `Photos (${d.photos.length})`),
    h('div', { class: 'photo-grid' },
      d.photos.map((p) =>
        h('div', { class: 'photo-tile' },
          h('img', { src: p.url, alt: '' }),
          p.distanceToPropertyM != null
            ? h('span', { class: 'cover-badge' },
                `${Math.round(p.distanceToPropertyM)}m`)
            : null
        )
      )
    )
  );
}

/* ============================================================
   GEOLOCATION HELPER
   ============================================================ */

function getGeo() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

/* ============================================================
   LOADERS
   ============================================================ */

export async function loadQueue() {
  const { inspector, accessToken } = getState();
  try {
    const res = await api.inspectorQueue(accessToken);
    setState({ inspector: { ...inspector, queue: res.items } });
  } catch (err) {
    setState({ inspector: { ...inspector, error: err.message } });
  }
}

export async function loadHistory() {
  const { inspector, accessToken } = getState();
  try {
    const res = await api.inspectorHistory(accessToken);
    setState({ inspector: { ...inspector, history: res.items } });
  } catch (err) {
    setState({ inspector: { ...inspector, error: err.message } });
  }
}

export async function loadEarnings() {
  const { inspector, accessToken } = getState();
  try {
    const [earn, prof] = await Promise.all([
      api.inspectorEarnings(accessToken),
      api.inspectorProfile(accessToken),
    ]);
    setState({ inspector: { ...inspector, earnings: earn.items, profile: prof } });
  } catch (err) {
    setState({ inspector: { ...inspector, error: err.message } });
  }
}

export async function loadProfile() {
  const { inspector, accessToken } = getState();
  try {
    const prof = await api.inspectorProfile(accessToken);
    setState({ inspector: { ...inspector, profile: prof } });
  } catch (err) {
    setState({ inspector: { ...inspector, error: err.message } });
  }
}

export async function openDetail(id) {
  const { inspector, accessToken } = getState();
  setState({ inspector: { ...inspector, view: 'detail', detail: null, form: null } });
  try {
    const d = await api.inspectorGetInspection(accessToken, id);
    setState({ inspector: { ...inspector, detail: d } });
  } catch (err) {
    setState({ inspector: { ...inspector, error: err.message } });
  }
}

async function loadDetail(id) {
  const { inspector, accessToken } = getState();
  try {
    const d = await api.inspectorGetInspection(accessToken, id);
    setState({ inspector: { ...inspector, detail: d } });
  } catch (err) {
    setState({ inspector: { ...inspector, error: err.message } });
  }
}