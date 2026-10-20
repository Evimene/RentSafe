import { h } from './mini.js';
import { getState, setState } from './store.js';
import { api } from './api.js';
import { HostCalendarModal, openHostCalendar } from './host-calendar.js';


const fmtN = (kobo) =>
  kobo == null ? '—' : `₦${(Number(kobo) / 100).toLocaleString('en-NG')}`;

const toKobo = (n) => Math.round(Number(n) * 100);

const STATUS_LABEL = {
  draft: 'Draft',
  pending_review: 'Pending review',
  active: 'Live',
  suspended: 'Suspended',
  rejected: 'Rejected',
  archived: 'Archived',
};

/* ============================================================
   HOST DASHBOARD
   ============================================================ */

export function HostDashboard() {
  const { host } = getState();
  const items = host.listings || [];

  return h('main', { class: 'screen-wide' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'Your listings'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          setState({ host: { ...host, wizard: { ...host.wizard, open: true, step: 1, listingId: null, data: {} } } });
        },
      }, '+ New listing')
    ),
    items.length === 0
      ? h('div', { class: 'empty' },
        h('div', { class: 'empty-icon' }, '🏠'),
        h('h3', {}, 'No listings yet'),
        h('p', { class: 'muted' }, 'Create your first shortlet listing to start earning.'))
      : h('div', { class: 'listing-grid' },
        items.map((it) => h('article', { class: 'listing-admin-card' },
          h('div', { class: 'lac-cover' },
            it.coverUrl
              ? h('img', { src: it.coverUrl, alt: '' })
              : h('div', { class: 'lac-placeholder' }, 'No cover')
          ),
          h('div', { class: 'lac-body' },
            h('div', { class: 'lac-head' },
              h('h3', {}, it.title),
              h('span', { class: `pill ${it.status}` }, STATUS_LABEL[it.status] || it.status)
            ),
            h('div', { class: 'muted small' },
              `${it.neighborhood || ''}${it.neighborhood ? ' · ' : ''}${it.city || ''}`),
            h('div', { class: 'lac-meta' },
              h('span', {}, `${it.bedrooms} bd · ${it.maxGuests} guests`),
              h('span', {}, h('strong', {}, fmtN(it.basePriceKobo)), ' / night')
            ),
            it.rejectionReason
              ? h('div', { class: 'alert error small' }, `Rejected: ${it.rejectionReason}`)
              : null,
            h('div', { class: 'lac-actions' },
              h('button', {
                class: 'btn ghost tiny',
                onclick: () => openEdit(it.id),
              }, it.status === 'draft' || it.status === 'rejected' ? 'Continue editing' : 'View'),

              // Only show if the listing is NOT a draft or rejected
              it.status !== 'draft' && it.status !== 'rejected' ? h('button', {
                class: 'btn ghost tiny',
                onclick: () => openHostCalendar(it.id, it.title),
              }, '📅 Calendar') : null,

              it.status === 'active'
                ? h('button', {
                  class: 'btn ghost tiny',
                  onclick: () => requestInspection(it.id),
                }, it.verificationScore > 0
                  ? `✓ Verified (${it.verificationScore})`
                  : '📋 Request verification')
                : null,

              (it.status === 'draft' || it.status === 'rejected') && it.mediaCount >= 3
                ? h('button', {
                  class: 'btn primary tiny',
                  onclick: () => submitListing(it.id),
                }, 'Submit for review')
                : null
            )
          )
        ))
      ),
    host.wizard.open ? ListingWizard() : null,
    host.calendar?.open ? HostCalendarModal() : null
  );
}

async function loadHostListings() {
  const { host, accessToken } = getState();
  try {
    const res = await api.hostListings(accessToken);
    setState({ host: { ...host, listings: res.items } });
  } catch (err) {
    setState({ host: { ...host, error: err.message } });
  }
}

async function submitListing(listingId) {
  const { host, accessToken } = getState();
  try {
    await api.hostSubmitListing(accessToken, listingId);
    setState({ host: { ...host, flash: 'Submitted for review.' } });
    loadHostListings();
  } catch (err) {
    setState({ host: { ...host, error: err.message } });
  }
}

async function openEdit(listingId) {
  const { host, accessToken } = getState();
  try {
    const data = await api.hostGetListing(accessToken, listingId);
    setState({
      host: {
        ...host,
        wizard: {
          open: true, step: 1, listingId,
          data: {
            property: data.property,
            listing: {
              title: data.title,
              description: data.description,
              listingType: data.listingType,
              bedrooms: data.bedrooms,
              beds: data.beds,
              bathrooms: data.bathrooms,
              maxGuests: data.maxGuests,
              minNights: data.minNights,
              maxNights: data.maxNights,
              checkInTime: data.checkInTime,
              checkOutTime: data.checkOutTime,
              basePriceKobo: data.basePriceKobo,
              cleaningFeeKobo: data.cleaningFeeKobo,
              securityDepositKobo: data.securityDepositKobo,
              instantBook: data.instantBook,
              houseRules: data.houseRules,
              cancellationPolicy: data.cancellationPolicy,
              amenities: (data.amenities || []).map((a) => a.slug),
            },
          },
          photos: data.photos || [],
          amenities: data.amenities || [],
          availability: data.availability || [],
        },
      },
    });
  } catch (err) {
    setState({ host: { ...host, error: err.message } });
  }
}

/* ============================================================
   WIZARD
   ============================================================ */

const STEPS = [
  { key: 1, label: 'Property' },
  { key: 2, label: 'Details' },
  { key: 3, label: 'Photos' },
  { key: 4, label: 'Pricing' },
];

export function ListingWizard() {
  const { host } = getState();
  const w = host.wizard;
  const step = w.step;

  return h('div', { class: 'modal-backdrop wizard-backdrop' },
    h('div', { class: 'wizard' },
      h('header', { class: 'wizard-head' },
        h('h2', {}, w.listingId ? 'Edit listing' : 'Create a listing'),
        h('button', {
          class: 'link',
          onclick: () => setState({ host: { ...host, wizard: { ...w, open: false } } }),
        }, 'Close')
      ),
      h('nav', { class: 'wizard-steps' },
        STEPS.map((s) =>
          h('button', {
            class: `wizard-step ${step === s.key ? 'active' : ''} ${step > s.key ? 'done' : ''}`,
            onclick: () => {
              // Only allow going back to completed steps
              if (s.key <= step) {
                setState({ host: { ...host, wizard: { ...w, step: s.key } } });
              }
            },
          },
            h('span', { class: 'ws-num' }, step > s.key ? '✓' : s.key),
            h('span', { class: 'ws-label' }, s.label)
          )
        )
      ),
      h('div', { class: 'wizard-body' },
        step === 1 ? StepProperty() :
          step === 2 ? StepDetails() :
            step === 3 ? StepPhotos() :
              step === 4 ? StepPricing() : null
      )
    )
  );
}

/* -------------------- STEP 1: PROPERTY -------------------- */

function StepProperty() {
  const { host } = getState();
  const w = host.wizard;
  const p = w.data.property || {};

  const save = async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.target).entries());
    const property = {
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2 || null,
      city: form.city,
      neighborhood: form.neighborhood || null,
      state: form.state,
      country: 'Nigeria',
      propertyType: form.propertyType,
      ownershipType: form.ownershipType,
      ownershipDocUrl: w.data.property?.ownershipDocUrl || null,
      lat: form.lat ? Number(form.lat) : null,
      lng: form.lng ? Number(form.lng) : null,
    };

    if (w.listingId) {
      // We're editing — just update local state and continue
      setState({
        host: {
          ...host, wizard: {
            ...w, step: 2,
            data: { ...w.data, property },
          }
        },
      });
      return;
    }

    // First save: create the draft
    try {
      const res = await api.hostCreateListing(getState().accessToken, {
        property,
        listing: {
          title: 'New listing',
          basePriceKobo: 10000, // ₦100 placeholder, updated in step 4
        },
      });
      setState({
        host: {
          ...host, wizard: {
            ...w, listingId: res.listingId, step: 2,
            data: { ...w.data, property },
          }
        },
      });
    } catch (err) {
      setState({ host: { ...host, error: err.message } });
    }
  };

  return h('form', { class: 'wizard-form', onsubmit: save },
    h('h3', {}, 'Where is the property?'),
    h('p', { class: 'muted small' }, 'Exact address stays private until a guest books.'),
    h('div', { class: 'grid-2' },
      Field({ label: 'Address line 1', name: 'addressLine1', value: p.addressLine1 }),
      Field({ label: 'Address line 2 (optional)', name: 'addressLine2', value: p.addressLine2 })
    ),
    h('div', { class: 'grid-3' },
      Field({ label: 'City', name: 'city', value: p.city }),
      Field({ label: 'Neighborhood / Area', name: 'neighborhood', value: p.neighborhood }),
      Field({ label: 'State', name: 'state', value: p.state || 'Lagos' })
    ),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' },
        h('span', { class: 'label' }, 'Property type'),
        h('select', { name: 'propertyType' },
          ['apartment', 'duplex', 'bungalow', 'studio', 'penthouse', 'villa', 'cottage', 'other']
            .map((v) => h('option', { value: v, selected: p.propertyType === v ? '' : null }, v))
        )
      ),
      h('label', { class: 'field' },
        h('span', { class: 'label' }, 'Ownership'),
        h('select', { name: 'ownershipType' },
          ['owned', 'leased', 'managed'].map((v) =>
            h('option', { value: v, selected: p.ownershipType === v ? '' : null }, v))
        )
      )
    ),
    h('div', { class: 'grid-2' },
      Field({ label: 'Latitude (optional)', name: 'lat', value: p.lat, type: 'number' }),
      Field({ label: 'Longitude (optional)', name: 'lng', value: p.lng, type: 'number' })
    ),
    h('div', { class: 'wizard-actions' },
      h('button', {
        type: 'button', class: 'btn ghost',
        onclick: () => setState({ host: { ...host, wizard: { ...w, open: false } } })
      }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Continue →')
    )
  );
}

/* -------------------- STEP 2: DETAILS -------------------- */

function StepDetails() {
  const { host } = getState();
  const w = host.wizard;
  const l = w.data.listing || {};

  const AMENITIES = [
    'wifi', 'ac', 'generator', 'kitchen', 'washer', 'dryer', 'tv', 'streaming',
    'pool', 'gym', 'security', 'parking', 'balcony', 'workspace', 'hot_water',
    'elevator', 'housekeeping', 'breakfast', 'ocean_view', 'pets_allowed',
  ];

  const save = async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.target).entries());
    const amenities = Array.from(e.target.querySelectorAll('input[name="amenities"]:checked'))
      .map((el) => el.value);

    const listing = {
      ...l,
      title: form.title,
      description: form.description,
      listingType: form.listingType,
      bedrooms: Number(form.bedrooms),
      beds: Number(form.beds),
      bathrooms: Number(form.bathrooms),
      maxGuests: Number(form.maxGuests),
      minNights: Number(form.minNights),
      maxNights: Number(form.maxNights),
      houseRules: form.houseRules,
      amenities,
    };

    try {
      await api.hostUpdateListing(getState().accessToken, w.listingId, listing);
      setState({
        host: {
          ...host, wizard: {
            ...w, step: 3,
            data: { ...w.data, listing },
          }
        },
      });
    } catch (err) {
      setState({ host: { ...host, error: err.message } });
    }
  };

  return h('form', { class: 'wizard-form', onsubmit: save },
    h('h3', {}, 'Tell guests about the space'),
    Field({
      label: 'Listing title', name: 'title', value: l.title,
      placeholder: 'e.g. Modern 2-bedroom in Lekki Phase 1'
    }),
    h('label', { class: 'field' },
      h('span', { class: 'label' }, 'Description'),
      h('textarea', {
        name: 'description', rows: 4,
        placeholder: 'Describe the space, the vibe, what makes it special…'
      },
        l.description || '')
    ),
    h('div', { class: 'grid-3' },
      h('label', { class: 'field' },
        h('span', { class: 'label' }, 'Type'),
        h('select', { name: 'listingType' },
          [['entire_place', 'Entire place'], ['private_room', 'Private room'], ['shared_room', 'Shared room']]
            .map(([v, t]) => h('option', { value: v, selected: l.listingType === v ? '' : null }, t))
        )
      ),
      Field({ label: 'Max guests', name: 'maxGuests', type: 'number', value: l.maxGuests || 2 }),
      Field({ label: 'Bedrooms', name: 'bedrooms', type: 'number', value: l.bedrooms || 1 })
    ),
    h('div', { class: 'grid-3' },
      Field({ label: 'Beds', name: 'beds', type: 'number', value: l.beds || 1 }),
      Field({ label: 'Bathrooms', name: 'bathrooms', type: 'number', value: l.bathrooms || 1 }),
      Field({ label: 'Min nights', name: 'minNights', type: 'number', value: l.minNights || 1 })
    ),
    Field({ label: 'Max nights', name: 'maxNights', type: 'number', value: l.maxNights || 30 }),
    h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Amenities'),
      h('div', { class: 'amenity-grid' },
        AMENITIES.map((slug) =>
          h('label', { class: 'amenity-check' },
            h('input', {
              type: 'checkbox', name: 'amenities', value: slug,
              checked: (l.amenities || []).includes(slug) ? '' : null,
            }),
            h('span', {}, slug.replace(/_/g, ' '))
          )
        )
      )
    ),
    h('label', { class: 'field' },
      h('span', { class: 'label' }, 'House rules (optional)'),
      h('textarea', {
        name: 'houseRules', rows: 3,
        placeholder: 'No smoking. No parties. Check-out by 11am.'
      },
        l.houseRules || '')
    ),
    h('div', { class: 'wizard-actions' },
      h('button', {
        type: 'button', class: 'btn ghost',
        onclick: () => setState({ host: { ...host, wizard: { ...w, step: 1 } } })
      }, '← Back'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Continue →')
    )
  );
}

/* -------------------- STEP 3: PHOTOS -------------------- */

function StepPhotos() {
  const { host } = getState();
  const w = host.wizard;
  const photos = w.photos || [];

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append('photos', f));
    setState({ host: { ...host, wizard: { ...w, uploading: true, error: null } } });
    try {
      const res = await api.hostUploadPhotos(getState().accessToken, w.listingId, fd);
      setState({
        host: {
          ...host, wizard: {
            ...w,
            uploading: false,
            photos: [...photos, ...res.photos],
          }
        },
      });
    } catch (err) {
      setState({ host: { ...host, wizard: { ...w, uploading: false }, error: err.message } });
    }
  };

  const del = async (mediaId) => {
    try {
      await api.hostDeletePhoto(getState().accessToken, w.listingId, mediaId);
      setState({
        host: {
          ...host, wizard: {
            ...w, photos: photos.filter((p) => p.id !== mediaId),
          }
        },
      });
    } catch (err) {
      setState({ host: { ...host, error: err.message } });
    }
  };

  const setCover = async (mediaId) => {
    try {
      await api.hostSetCover(getState().accessToken, w.listingId, mediaId);
      setState({
        host: {
          ...host, wizard: {
            ...w, photos: photos.map((p) => ({ ...p, isCover: p.id === mediaId })),
          }
        },
      });
    } catch (err) {
      setState({ host: { ...host, error: err.message } });
    }
  };

  return h('div', { class: 'wizard-form' },
    h('h3', {}, 'Add photos'),
    h('p', { class: 'muted small' },
      'At least 3 photos required. First photo becomes the cover by default.'),
    h('label', { class: 'upload-zone' },
      h('input', {
        type: 'file', accept: 'image/*', multiple: '',
        onchange: upload,
        style: { display: 'none' },
      }),
      h('div', { class: 'upload-icon' }, '📷'),
      h('div', {}, w.uploading ? 'Uploading…' : 'Click to upload photos'),
      h('div', { class: 'muted small' }, 'JPEG, PNG, or WebP · max 8MB each')
    ),
    photos.length > 0
      ? h('div', { class: 'photo-grid' },
        photos.map((p) =>
          h('div', { class: `photo-tile ${p.isCover ? 'is-cover' : ''}` },
            h('img', { src: p.thumbnailUrl || p.url, alt: '' }),
            p.isCover ? h('span', { class: 'cover-badge' }, 'Cover') : null,
            h('div', { class: 'photo-tile-actions' },
              !p.isCover
                ? h('button', {
                  class: 'btn tiny ghost', type: 'button',
                  onclick: () => setCover(p.id),
                }, 'Set cover')
                : null,
              h('button', {
                class: 'btn tiny danger', type: 'button',
                onclick: () => del(p.id),
              }, 'Delete')
            )
          )
        )
      )
      : h('p', { class: 'muted small' }, 'No photos uploaded yet.'),
    h('div', { class: 'wizard-actions' },
      h('button', {
        type: 'button', class: 'btn ghost',
        onclick: () => setState({ host: { ...host, wizard: { ...w, step: 2 } } })
      }, '← Back'),
      h('button', {
        type: 'button', class: 'btn primary',
        disabled: photos.length < 3,
        onclick: () => setState({ host: { ...host, wizard: { ...w, step: 4 } } }),
      }, 'Continue →')
    )
  );
}

/* -------------------- STEP 4: PRICING -------------------- */

function StepPricing() {
  const { host } = getState();
  const w = host.wizard;
  const l = w.data.listing || {};

  const save = async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.target).entries());
    const patch = {
      basePriceKobo: toKobo(form.basePrice),
      cleaningFeeKobo: toKobo(form.cleaningFee || 0),
      securityDepositKobo: toKobo(form.securityDeposit || 0),
      checkInTime: form.checkInTime,
      checkOutTime: form.checkOutTime,
      instantBook: form.instantBook === 'on',
      cancellationPolicy: form.cancellationPolicy,
    };

    try {
      await api.hostUpdateListing(getState().accessToken, w.listingId, patch);
      await api.hostSubmitListing(getState().accessToken, w.listingId);
      setState({
        host: {
          ...host,
          wizard: { ...w, open: false },
          flash: 'Listing submitted for review.',
        },
      });
      loadHostListings();
    } catch (err) {
      setState({ host: { ...host, error: err.message } });
    }
  };

  return h('form', { class: 'wizard-form', onsubmit: save },
    h('h3', {}, 'Set your price'),
    h('div', { class: 'grid-3' },
      Field({
        label: 'Base price (₦ / night)', name: 'basePrice', type: 'number',
        value: l.basePriceKobo ? l.basePriceKobo / 100 : ''
      }),
      Field({
        label: 'Cleaning fee (₦)', name: 'cleaningFee', type: 'number',
        value: l.cleaningFeeKobo ? l.cleaningFeeKobo / 100 : 0
      }),
      Field({
        label: 'Security deposit (₦)', name: 'securityDeposit', type: 'number',
        value: l.securityDepositKobo ? l.securityDepositKobo / 100 : 0
      })
    ),
    h('div', { class: 'grid-2' },
      Field({ label: 'Check-in time', name: 'checkInTime', type: 'time', value: l.checkInTime || '15:00' }),
      Field({ label: 'Check-out time', name: 'checkOutTime', type: 'time', value: l.checkOutTime || '11:00' })
    ),
    h('label', { class: 'field' },
      h('span', { class: 'label' }, 'Cancellation policy'),
      h('select', { name: 'cancellationPolicy' },
        [['flexible', 'Flexible — full refund 24h before'],
        ['moderate', 'Moderate — full refund 5 days before'],
        ['strict', 'Strict — 50% refund 7 days before']]
          .map(([v, t]) => h('option', { value: v, selected: l.cancellationPolicy === v ? '' : null }, t))
      )
    ),
    h('label', { class: 'check-row' },
      h('input', {
        type: 'checkbox', name: 'instantBook',
        checked: l.instantBook ? '' : null
      }),
      h('span', {}, 'Enable instant book (guests book without approval)')
    ),
    h('div', { class: 'wizard-actions' },
      h('button', {
        type: 'button', class: 'btn ghost',
        onclick: () => setState({ host: { ...host, wizard: { ...w, step: 3 } } })
      }, '← Back'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Submit for review ✓')
    )
  );
}

function Field({ label, name, type = 'text', value, placeholder }) {
  return h('label', { class: 'field' },
    h('span', { class: 'label' }, label),
    h('input', {
      type, name, placeholder,
      value: value == null ? '' : String(value),
      'data-focus-key': name,
    })
  );
}