import { h } from './mini.js';
import { getState, setState } from './store.js';
import { api } from './api.js';

/* ============================================================
   Helpers
   ============================================================ */

const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('en-NG', {
  day: '2-digit', month: 'short', year: 'numeric',
}) : '—';

const fmtN = (kobo) =>
  kobo == null ? '—' : `₦${(Number(kobo) / 100).toLocaleString('en-NG')}`;


const initials = (u) =>
  `${(u?.firstName || '?')[0] || '?'}${(u?.lastName || '?')[0] || '?'}`.toUpperCase();

function StatusPill({ status }) {
  return h('span', { class: `pill ${status}` }, status);
}

function Spinner() {
  return h('span', { class: 'spinner' });
}

function EmptyState({ title, subtitle }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, '∅'),
    h('h3', {}, title),
    subtitle ? h('p', { class: 'muted' }, subtitle) : null
  );
}

/* ============================================================
   Admin shell
   ============================================================ */

export function AdminShell({ children }) {
  const { user, admin } = getState();
  const view = admin.view;

  const navItem = (key, label, badge) =>
    h('button', {
      class: `nav-item ${view === key ? 'active' : ''}`,
      onclick: () => {
        setState({
          admin: {
            ...admin,
            view: key,
            detail: { ...admin.detail, id: null, data: null, revealedFields: {} },
          },
        });
        if (key === 'kyc_list') loadKycList();
        if (key === 'audit') loadAudit();
      },
    },
      h('span', {}, label),
      badge != null ? h('span', { class: 'badge' }, badge) : null
    );

  return h('div', { class: 'admin-shell' },
    h('aside', { class: 'admin-side' },
      h('div', { class: 'admin-brand' }, 'RentSafe', h('span', { class: 'admin-tag' }, 'Admin')),
      h('nav', {},
        navItem('kyc_list', 'KYC queue', admin.stats?.pending || 0),
        navItem('audit', 'Audit log'),
        navItem('listing_list', 'Listings', admin.listings?.total || 0),
        navItem('inspection_list', 'Inspections', admin.inspections?.items?.length || 0),
      ),
      h('div', { class: 'admin-me' },
        h('div', { class: 'avatar' }, initials(user)),
        h('div', {},
          h('div', { class: 'name' }, `${user?.firstName || ''} ${user?.lastName || ''}`.trim()),
          h('div', { class: 'role' }, (user?.roles || []).join(' · '))
        )
      ),
      h('button', {
        class: 'link',
        style: { marginTop: '12px' },
        onclick: async () => {
          try { await api.logout({ refreshToken: getState().refreshToken }); } catch { }
          localStorage.removeItem('refreshToken');
          setState({
            accessToken: null, refreshToken: null, user: null, route: 'login',
          });
        },
      }, 'Sign out')
    ),
    h('main', { class: 'admin-main' },
      admin.error ? h('div', { class: 'alert error' }, admin.error) : null,
      admin.flash ? h('div', { class: 'alert success' }, admin.flash) : null,
      children
    )
  );
}

/* ============================================================
   Stats strip
   ============================================================ */

function StatsStrip() {
  const { admin } = getState();
  const s = admin.stats;
  if (!s) return null;
  const Card = (label, value, tone) =>
    h('div', { class: `stat ${tone || ''}` },
      h('div', { class: 'stat-value' }, value),
      h('div', { class: 'stat-label' }, label)
    );
  return h('div', { class: 'stats' },
    Card('Pending review', s.pending ?? 0, 'warn'),
    Card('Verified', s.verified ?? 0, 'ok'),
    Card('Rejected', s.rejected ?? 0, 'bad'),
    Card('Last 24h', s.last_24h ?? 0, '')
  );
}

/* ============================================================
   KYC list
   ============================================================ */

export function AdminKycList() {
  const { admin } = getState();
  const { list } = admin;

  const applyFilter = (patch) => {
    setState({
      admin: {
        ...admin,
        list: { ...list, filters: { ...list.filters, ...patch }, page: 1 },
      },
    });
    loadKycList();
  };

  const setPage = (p) => {
    setState({ admin: { ...admin, list: { ...list, page: p } } });
    loadKycList();
  };

  const rows = list.items.map((r) =>
    h('tr', {
      onclick: () => openKycDetail(r.id),
      class: 'clickable',
    },
      h('td', {},
        h('div', { class: 'user-cell' },
          h('div', { class: 'avatar sm' }, initials(r.user)),
          h('div', {},
            h('div', { class: 'strong' }, `${r.user.firstName || ''} ${r.user.lastName || ''}`.trim() || '—'),
            h('div', { class: 'muted small' }, r.user.phone)
          )
        )
      ),
      h('td', {}, h('span', { class: 'type' }, String(r.type).toUpperCase())),
      h('td', {}, StatusPill({ status: r.status })),
      h('td', { class: 'muted small' }, r.provider),
      h('td', { class: 'muted small' }, fmtDate(r.submittedAt || r.createdAt)),
      h('td', {}, r.hasSelfie ? h('span', { class: 'chip' }, 'selfie') : h('span', { class: 'muted' }, '—'))
    )
  );

  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'KYC review queue'),
      h('button', {
        class: 'btn ghost',
        onclick: () => { loadStats(); loadKycList(); },
      }, 'Refresh')
    ),
    StatsStrip(),
    h('div', { class: 'filters' },
      h('div', { class: 'filter' },
        h('label', {}, 'Status'),
        h('select', {
          value: list.filters.status,
          onchange: (e) => applyFilter({ status: e.target.value }),
        },
          h('option', { value: 'submitted' }, 'Submitted (pending)'),
          h('option', { value: 'pending' }, 'Pending'),
          h('option', { value: 'verified' }, 'Verified'),
          h('option', { value: 'rejected' }, 'Rejected'),
          h('option', { value: 'expired' }, 'Expired'),
          h('option', { value: 'all' }, 'All')
        )
      ),
      h('div', { class: 'filter' },
        h('label', {}, 'Type'),
        h('select', {
          value: list.filters.type,
          onchange: (e) => applyFilter({ type: e.target.value }),
        },
          h('option', { value: '' }, 'Any'),
          h('option', { value: 'nin' }, 'NIN'),
          h('option', { value: 'bvn' }, 'BVN'),
          h('option', { value: 'selfie' }, 'Selfie'),
          h('option', { value: 'address' }, 'Address')
        )
      ),
      h('div', { class: 'filter grow' },
        h('label', {}, 'Search'),
        h('input', {
          type: 'text',
          placeholder: 'Phone, email, or name…',
          value: list.filters.search,
          'data-focus-key': 'admin-search',
          oninput: (e) => {
            clearTimeout(applyFilter._t);
            applyFilter._t = setTimeout(() => applyFilter({ search: e.target.value }), 350);
          },
        })
      )
    ),
    list.loading
      ? h('div', { class: 'loading-row' }, Spinner(), ' Loading…')
      : list.items.length === 0
        ? EmptyState({ title: 'Nothing in this queue', subtitle: 'Try a different filter.' })
        : h('div', { class: 'table-wrap' },
          h('table', { class: 'data-table' },
            h('thead', {},
              h('tr', {},
                h('th', {}, 'User'),
                h('th', {}, 'ID type'),
                h('th', {}, 'Status'),
                h('th', {}, 'Provider'),
                h('th', {}, 'Submitted'),
                h('th', {}, 'Documents')
              )
            ),
            h('tbody', {}, rows)
          )
        ),
    h('div', { class: 'pager' },
      h('button', {
        class: 'btn ghost', disabled: list.page <= 1,
        onclick: () => setPage(list.page - 1),
      }, 'Prev'),
      h('span', { class: 'muted' }, `Page ${list.page} of ${pages} · ${list.total} total`),
      h('button', {
        class: 'btn ghost', disabled: list.page >= pages,
        onclick: () => setPage(list.page + 1),
      }, 'Next')
    )
  );
}

/* ============================================================
   KYC detail
   ============================================================ */

export function AdminKycDetail() {
  const { admin } = getState();
  const d = admin.detail;

  if (d.loading || !d.data) {
    return h('div', { class: 'admin-page' },
      h('div', { class: 'loading-row' }, Spinner(), ' Loading…'));
  }

  const k = d.data;
  const revealed = d.revealedFields;

  const InfoRow = (label, value) =>
    h('div', { class: 'info-row' },
      h('div', { class: 'info-label' }, label),
      h('div', { class: 'info-value' }, value || h('span', { class: 'muted' }, '—'))
    );

  const Sensitive = ({ label, field, children }) =>
    h('div', { class: 'sensitive' },
      h('div', { class: 'sensitive-head' },
        h('span', { class: 'info-label' }, label),
        revealed[field]
          ? h('span', { class: 'chip reveal' }, 'revealed')
          : h('button', {
            class: 'btn tiny',
            onclick: async () => {
              try {
                const res = await api.adminReveal(getState().accessToken, k.id, field);
                setState({
                  admin: {
                    ...admin,
                    detail: {
                      ...d,
                      revealedFields: { ...revealed, [field]: true },
                      data: field === 'verified_data'
                        ? { ...k, verifiedData: res.value }
                        : k,
                    },
                  },
                });
              } catch (err) {
                setState({ admin: { ...admin, error: err.message } });
              }
            },
          }, 'Reveal (audited)')
      ),
      h('div', { class: 'sensitive-body' }, children)
    );

  const kv = k.verifiedData && Object.keys(k.verifiedData).length
    ? Object.entries(k.verifiedData).map(([key, val]) =>
      h('div', { class: 'kv' },
        h('span', { class: 'kv-k' }, key),
        h('span', { class: 'kv-v' }, typeof val === 'object' ? JSON.stringify(val) : String(val))
      )
    )
    : [h('div', { class: 'muted' }, 'No provider data stored')];

  const openReview = (action) =>
    setState({
      admin: {
        ...admin,
        reviewModal: { ...admin.reviewModal, open: true, action, reason: '', notes: '' },
      },
    });

  const canReview = ['submitted', 'pending'].includes(k.status);

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('button', {
        class: 'btn ghost',
        onclick: () => setState({
          admin: {
            ...admin,
            view: 'kyc_list',
            detail: { id: null, data: null, loading: false, revealedFields: {} },
          },
        }),
      }, '← Back to queue'),
      h('div', { class: 'head-right' },
        StatusPill({ status: k.status }),
        h('span', { class: 'muted small' }, k.reference || k.id.slice(0, 8))
      )
    ),

    h('div', { class: 'detail-grid' },
      // ---------- Left column: user + submission ----------
      h('section', { class: 'card flat' },
        h('h2', {}, 'Applicant'),
        h('div', { class: 'user-block' },
          h('div', { class: 'avatar lg' }, initials(k.user)),
          h('div', {},
            h('div', { class: 'strong' }, `${k.user.firstName || ''} ${k.user.lastName || ''}`.trim() || '—'),
            h('div', { class: 'muted small' }, k.user.phone),
            k.user.email ? h('div', { class: 'muted small' }, k.user.email) : null
          )
        ),
        h('div', { class: 'divider' }),
        InfoRow('User ID', h('code', { class: 'mono' }, k.user.id)),
        InfoRow('Phone verified', k.user.isPhoneVerified ? 'Yes' : 'No'),
        InfoRow('Email verified', k.user.isEmailVerified ? 'Yes' : 'No'),
        InfoRow('Account created', fmtDate(k.user.createdAt)),
        InfoRow('Last login', fmtDate(k.user.lastLoginAt)),
        InfoRow('Account KYC status', StatusPill({ status: k.user.kycStatus })),
        k.user.isBanned ? h('div', { class: 'alert error' }, 'This user is banned.') : null
      ),

      // ---------- Middle column: submission ----------
      h('section', { class: 'card flat' },
        h('h2', {}, 'Submission'),
        InfoRow('Type', h('span', { class: 'type' }, String(k.type).toUpperCase())),
        InfoRow('Provider', k.provider),
        InfoRow('Reference', k.reference ? h('code', { class: 'mono' }, k.reference) : null),
        InfoRow('Submitted', fmtDate(k.submittedAt)),
        InfoRow('Verified', fmtDate(k.verifiedAt)),
        k.rejectionReason
          ? InfoRow('Rejection reason', h('span', { class: 'pill rejected' }, k.rejectionReason))
          : null,
        h('div', { class: 'divider' }),

        Sensitive({
          label: 'Provider response (verified data)',
          field: 'verified_data',
          children: h('div', { class: 'kv-list' }, kv),
        }),

        h('div', { class: 'divider' }),

        Sensitive({
          label: 'Selfie',
          field: 'selfie_url',
          children: k.selfieUrl
            ? h('div', { class: 'media-preview' },
              h('img', {
                src: k.selfieUrl,
                alt: 'Selfie',
                onclick: () => openLightbox(k.selfieUrl),
              })
            )
            : h('div', { class: 'muted' }, 'No selfie uploaded')
        }),

        k.documentUrl ? Sensitive({
          label: 'ID document',
          field: 'document_url',
          children: h('div', { class: 'media-preview' },
            h('img', {
              src: k.documentUrl,
              alt: 'Document',
              onclick: () => openLightbox(k.documentUrl),
            })
          ),
        }) : null
      ),

      // ---------- Right column: audit ----------
      h('section', { class: 'card flat' },
        h('h2', {}, 'Audit trail'),
        k.auditTrail.length === 0
          ? h('div', { class: 'muted' }, 'No events yet.')
          : h('ul', { class: 'timeline' },
            k.auditTrail.map((a) =>
              h('li', {},
                h('div', { class: 'dot' }),
                h('div', {},
                  h('div', { class: 'strong' }, a.action),
                  h('div', { class: 'muted small' },
                    `${a.actor_role || 'system'} · ${fmtDate(a.created_at)}`),
                  a.notes ? h('div', { class: 'small' }, a.notes) : null
                )
              )
            )
          )
      )
    ),

    canReview
      ? h('div', { class: 'review-actions' },
        h('button', {
          class: 'btn danger',
          onclick: () => openReview('reject'),
        }, 'Reject'),
        h('button', {
          class: 'btn success',
          onclick: () => openReview('approve'),
        }, 'Approve')
      )
      : null,

    ReviewModal()
  );
}

/* ============================================================
   Review modal
   ============================================================ */

function ReviewModal() {
  const { admin } = getState();
  const m = admin.reviewModal;
  if (!m.open) return null;

  const close = () =>
    setState({ admin: { ...admin, reviewModal: { ...m, open: false } } });

  const submit = async () => {
    const { detail, reviewModal } = admin;
    if (reviewModal.action === 'reject' && !reviewModal.reason) return;

    setState({ admin: { ...admin, reviewModal: { ...m, submitting: true } } });

    try {
      await api.adminReviewKyc(getState().accessToken, detail.id, {
        action: reviewModal.action,
        reason: reviewModal.reason || undefined,
        notes: reviewModal.notes || undefined,
      });
      setState({
        admin: {
          ...admin,
          view: 'kyc_list',
          detail: { id: null, data: null, loading: false, revealedFields: {} },
          reviewModal: { open: false, action: null, reason: '', notes: '', submitting: false },
          flash: reviewModal.action === 'approve' ? 'KYC approved.' : 'KYC rejected.',
        },
      });
      loadStats();
      loadKycList();
    } catch (err) {
      setState({
        admin: {
          ...admin,
          reviewModal: { ...m, submitting: false },
          error: err.message,
        },
      });
    }
  };

  return h('div', { class: 'modal-backdrop', onclick: (e) => e.target === e.currentTarget && close() },
    h('div', { class: 'modal' },
      h('h3', {}, m.action === 'approve' ? 'Approve KYC' : 'Reject KYC'),
      m.action === 'reject'
        ? h('div', { class: 'field' },
          h('span', { class: 'label' }, 'Reason'),
          h('select', {
            value: m.reason,
            onchange: (e) => setState({ admin: { ...admin, reviewModal: { ...m, reason: e.target.value } } }),
          },
            h('option', { value: '' }, 'Select a reason…'),
            admin.rejectionReasons.map((r) =>
              h('option', { value: r.value }, r.label))
          )
        )
        : h('p', { class: 'muted' }, 'This will mark the user as KYC-verified and unlock host/guest actions.'),
      h('div', { class: 'field' },
        h('span', { class: 'label' }, 'Notes (optional)'),
        h('textarea', {
          rows: 3,
          value: m.notes,
          'data-focus-key': 'review-notes',
          oninput: (e) => setState({ admin: { ...admin, reviewModal: { ...m, notes: e.target.value } } }),
          placeholder: m.action === 'reject' ? 'Add context for the audit trail…' : 'Any notes for the audit trail…',
        })
      ),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn ghost', onclick: close, disabled: m.submitting }, 'Cancel'),
        h('button', {
          class: m.action === 'approve' ? 'btn success' : 'btn danger',
          onclick: submit,
          disabled: m.submitting || (m.action === 'reject' && !m.reason),
        }, m.submitting ? Spinner() : (m.action === 'approve' ? 'Approve' : 'Reject'))
      )
    )
  );
}

/* ============================================================
   Lightbox
   ============================================================ */

function openLightbox(src) {
  const el = h('div', { class: 'lightbox', onclick: () => el.remove() },
    h('img', { src }));
  document.body.append(el);
}

/* ============================================================
   Audit log
   ============================================================ */

export function AdminAudit() {
  const { admin } = getState();
  const a = admin.audit;

  const setPage = (p) => {
    setState({ admin: { ...admin, audit: { ...a, page: p } } });
    loadAudit();
  };

  const pages = Math.max(1, Math.ceil(a.total / a.pageSize));

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'Audit log'),
      h('button', { class: 'btn ghost', onclick: loadAudit }, 'Refresh')
    ),
    a.loading
      ? h('div', { class: 'loading-row' }, Spinner(), ' Loading…')
      : a.items.length === 0
        ? EmptyState({ title: 'No audit entries yet' })
        : h('div', { class: 'table-wrap' },
          h('table', { class: 'data-table' },
            h('thead', {},
              h('tr', {},
                h('th', {}, 'When'),
                h('th', {}, 'Actor'),
                h('th', {}, 'Action'),
                h('th', {}, 'Entity'),
                h('th', {}, 'Notes')
              )
            ),
            h('tbody', {},
              a.items.map((row) =>
                h('tr', { class: row.sensitive ? 'sens-row' : '' },
                  h('td', { class: 'muted small' }, fmtDate(row.created_at)),
                  h('td', {},
                    h('span', { class: 'role-chip' }, row.actor_role || 'system'),
                    h('div', { class: 'muted small mono' }, (row.actor_id || '').slice(0, 8))
                  ),
                  h('td', {}, h('span', { class: 'action-chip' }, row.action)),
                  h('td', { class: 'muted small' },
                    row.entity_type,
                    h('div', { class: 'mono small' }, (row.entity_id || '').slice(0, 8))
                  ),
                  h('td', { class: 'muted small' }, row.notes || '—')
                )
              )
            )
          )
        ),
    h('div', { class: 'pager' },
      h('button', { class: 'btn ghost', disabled: a.page <= 1, onclick: () => setPage(a.page - 1) }, 'Prev'),
      h('span', { class: 'muted' }, `Page ${a.page} of ${pages} · ${a.total} total`),
      h('button', { class: 'btn ghost', disabled: a.page >= pages, onclick: () => setPage(a.page + 1) }, 'Next')
    )
  );
}

/* ============================================================
   Loaders
   ============================================================ */

export async function loadStats() {
  const { admin, accessToken } = getState();
  try {
    const stats = await api.adminStats(accessToken);
    setState({ admin: { ...admin, stats } });
  } catch (err) {
    console.warn('[admin] stats failed', err.message);
  }
}

export async function loadKycList() {
  const { admin, accessToken } = getState();
  setState({ admin: { ...admin, list: { ...admin.list, loading: true } } });
  try {
    const res = await api.adminListKyc(accessToken, {
      status: admin.list.filters.status,
      type: admin.list.filters.type,
      search: admin.list.filters.search,
      page: admin.list.page,
      pageSize: admin.list.pageSize,
    });
    setState({
      admin: {
        ...admin,
        list: {
          ...admin.list,
          items: res.data,
          total: res.pagination.total,
          loading: false,
        },
      },
    });
  } catch (err) {
    setState({
      admin: { ...admin, list: { ...admin.list, loading: false }, error: err.message },
    });
  }
}

export async function openKycDetail(id) {
  const { admin, accessToken } = getState();
  setState({
    admin: {
      ...admin,
      view: 'kyc_detail',
      detail: { id, data: null, loading: true, revealedFields: {} },
    },
  });
  try {
    const [detail, reasons] = await Promise.all([
      api.adminKycDetail(accessToken, id),
      admin.rejectionReasons.length
        ? Promise.resolve(admin.rejectionReasons)
        : api.adminRejectionReasons(accessToken),
    ]);
    setState({
      admin: {
        ...admin,
        rejectionReasons: reasons,
        detail: { id, data: detail, loading: false, revealedFields: {} },
      },
    });
  } catch (err) {
    setState({
      admin: {
        ...admin,
        detail: { id, data: null, loading: false, revealedFields: {} },
        error: err.message,
      },
    });
  }
}

export async function loadAudit() {
  const { admin, accessToken } = getState();
  setState({ admin: { ...admin, audit: { ...admin.audit, loading: true } } });
  try {
    const res = await api.adminAudit(accessToken, {
      page: admin.audit.page,
      pageSize: admin.audit.pageSize,
    });
    setState({
      admin: {
        ...admin,
        audit: { ...admin.audit, items: res.data, total: res.pagination.total, loading: false },
      },
    });
  } catch (err) {
    setState({ admin: { ...admin, audit: { ...admin.audit, loading: false }, error: err.message } });
  }
}


/* ---------- LIST ---------- */

export function AdminListings() {
  const { admin } = getState();
  const list = admin.listings || { items: [], loading: false, page: 1, total: 0 };

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'Listing approvals'),
      h('button', { class: 'btn ghost', onclick: loadAdminListings }, 'Refresh')
    ),
    list.loading
      ? h('div', { class: 'loading-row' }, 'Loading…')
      : list.items.length === 0
        ? h('div', { class: 'empty' }, h('h3', {}, 'No listings pending'))
        : h('div', { class: 'table-wrap' },
            h('table', { class: 'data-table' },
              h('thead', {},
                h('tr', {},
                  h('th', {}, 'Listing'),
                  h('th', {}, 'Host'),
                  h('th', {}, 'Location'),
                  h('th', {}, 'Price / night'),
                  h('th', {}, 'Photos'),
                  h('th', {}, 'Submitted')
                )
              ),
              h('tbody', {},
                list.items.map((it) =>
                  h('tr', {
                    class: 'clickable',
                    onclick: () => openAdminListingDetail(it.id),
                  },
                    h('td', {},
                      h('div', { class: 'user-cell' },
                        h('img', {
                          src: it.coverUrl || '', alt: '',
                          class: 'thumb',
                          onerror: (e) => { e.target.style.display = 'none'; },
                        }),
                        h('div', {},
                          h('div', { class: 'strong' }, it.title),
                          h('div', { class: 'muted small' }, it.listingType)
                        )
                      )
                    ),
                    h('td', {},
                      h('div', {}, it.hostName),
                      h('div', { class: 'muted small' }, it.hostPhone)
                    ),
                    h('td', { class: 'muted small' },
                      `${it.neighborhood || ''}${it.neighborhood ? ', ' : ''}${it.city}`),
                    h('td', {}, fmtN(it.basePriceKobo)),
                    h('td', {}, it.mediaCount),
                    h('td', { class: 'muted small' }, fmtDate(it.createdAt))
                  )
                )
              )
            )
          )
  );
}

/* ---------- DETAIL ---------- */

export function AdminListingDetail() {
  const { admin } = getState();
  const d = admin.listings?.detail;

  if (!d) return h('div', { class: 'admin-page' }, 'Loading…');

  const back = () => setState({
    admin: {
      ...admin,
      listings: { ...admin.listings, view: 'list', detail: null },
    },
  });

  const approve = async () => {
    const score = prompt('Verification score (0–100):', '75');
    if (score == null) return;
    try {
      await api.adminApproveListing(getState().accessToken, d.id, { verificationScore: Number(score) });
      back();
      loadAdminListings();
    } catch (err) {
      setState({ admin: { ...admin, error: err.message } });
    }
  };

  const reject = async () => {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    try {
      await api.adminRejectListing(getState().accessToken, d.id, { reason });
      back();
      loadAdminListings();
    } catch (err) {
      setState({ admin: { ...admin, error: err.message } });
    }
  };

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('button', { class: 'btn ghost', onclick: back }, '← Back'),
      h('div', { class: 'head-right' },
        h('span', { class: `pill ${d.status}` }, d.status)
      )
    ),
    h('div', { class: 'detail-layout' },
      h('section', { class: 'detail-main' },
        h('h1', {}, d.title),
        h('div', { class: 'muted' },
          `${d.property.neighborhood || ''}${d.property.neighborhood ? ', ' : ''}${d.property.city}, ${d.property.state}`),
        h('div', { class: 'detail-specs' },
          h('span', {}, d.listingType),
          h('span', {}, `${d.bedrooms} bd · ${d.beds} bed · ${d.bathrooms} bath`),
          h('span', {}, `Max ${d.maxGuests} guests`)
        ),
        h('div', { class: 'gallery-thumbs-grid' },
          d.photos.map((p) =>
            h('img', {
              src: p.thumbnailUrl || p.url, alt: '',
              onclick: () => window.open(p.url, '_blank'),
            })
          )
        ),
        h('p', { class: 'detail-desc' }, d.description || 'No description.'),
        h('h3', {}, 'Amenities'),
        h('div', { class: 'amenity-list' },
          d.amenities.map((a) => h('span', { class: 'amenity-tag' }, a.name))
        ),
        d.houseRules ? h('section', {},
          h('h3', {}, 'House rules'),
          h('p', { class: 'muted' }, d.houseRules)
        ) : null
      ),
      h('aside', { class: 'detail-side' },
        h('div', { class: 'card flat' },
          h('h2', {}, 'Host'),
          h('div', {}, d.host.firstName, ' ', d.host.lastName),
          h('div', { class: 'muted small' }, d.host.phone),
          h('div', { class: 'muted small' }, `KYC: ${d.host.kycStatus}`)
        ),
        h('div', { class: 'card flat' },
          h('h2', {}, 'Pricing'),
          h('div', {}, 'Base: ', h('strong', {}, fmtN(d.basePriceKobo))),
          h('div', {}, 'Cleaning: ', h('strong', {}, fmtN(d.cleaningFeeKobo))),
          d.securityDepositKobo > 0
            ? h('div', {}, 'Deposit: ', h('strong', {}, fmtN(d.securityDepositKobo)))
            : null
        ),
        d.property.ownershipDocUrl
          ? h('div', { class: 'card flat' },
              h('h2', {}, 'Ownership document'),
              h('a', {
                href: d.property.ownershipDocUrl,
                target: '_blank',
                class: 'btn ghost',
              }, 'View document')
            )
          : null,
        h('div', { class: 'review-actions' },
          h('button', { class: 'btn danger', onclick: reject }, 'Reject'),
          h('button', { class: 'btn success', onclick: approve }, 'Approve')
        )
      )
    )
  );
}

export async function loadAdminListings() {
  const { admin, accessToken } = getState();
  const listings = admin.listings || { items: [], page: 1 };
  setState({ admin: { ...admin, listings: { ...listings, loading: true } } });
  try {
    const res = await api.adminListListings(accessToken, {
      status: 'pending_review',
      page: listings.page || 1,
    });
    setState({
      admin: { ...admin, listings: { ...listings, loading: false, items: res.data, total: res.pagination.total } },
    });
  } catch (err) {
    setState({ admin: { ...admin, listings: { ...listings, loading: false }, error: err.message } });
  }
}

export async function openAdminListingDetail(id) {
  const { admin, accessToken } = getState();
  setState({ admin: { ...admin, listings: { ...admin.listings, view: 'detail', detail: null } } });
  try {
    const data = await api.adminListListingDetail(accessToken, id);
    setState({ admin: { ...admin, listings: { ...admin.listings, view: 'detail', detail: data } } });
  } catch (err) {
    setState({ admin: { ...admin, error: err.message } });
  }
}


/* ---------- ADMIN INSPECTION LIST ---------- */

export function AdminInspections() {
  const { admin } = getState();
  const list = admin.inspections || { items: [], loading: false };

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('h1', {}, 'Inspections'),
      h('button', { class: 'btn ghost', onclick: loadAdminInspections }, 'Refresh')
    ),
    list.loading
      ? h('div', { class: 'loading-row' }, 'Loading…')
      : list.items.length === 0
        ? h('div', { class: 'empty' }, h('h3', {}, 'No inspections to review'))
        : h('div', { class: 'table-wrap' },
            h('table', { class: 'data-table' },
              h('thead', {},
                h('tr', {},
                  h('th', {}, 'Listing'),
                  h('th', {}, 'Inspector'),
                  h('th', {}, 'Score'),
                  h('th', {}, 'Flags'),
                  h('th', {}, 'Submitted')
                )
              ),
              h('tbody', {},
                list.items.map((it) =>
                  h('tr', {
                    class: 'clickable',
                    onclick: () => openAdminInspection(it.id),
                  },
                    h('td', {},
                      h('div', { class: 'strong' }, it.listing.title),
                      h('div', { class: 'muted small' },
                        `${it.listing.neighborhood || ''}, ${it.listing.city || ''}`)),
                    h('td', { class: 'muted small' },
                      it.inspector
                        ? `${it.inspector.firstName} ${it.inspector.lastName}`
                        : '—'),
                    h('td', {},
                      it.score != null
                        ? h('strong', { class: it.score >= 70 ? 'text-ok' : 'text-bad' }, String(it.score))
                        : '—'),
                    h('td', {},
                      it.flags?.length
                        ? h('span', { class: 'chip warn' }, it.flags.length)
                        : h('span', { class: 'muted' }, '—')),
                    h('td', { class: 'muted small' }, fmtDate(it.submittedAt || it.createdAt))
                  )
                )
              )
            )
          )
  );
}

/* ---------- ADMIN INSPECTION DETAIL ---------- */

export function AdminInspectionDetail() {
  const { admin } = getState();
  const d = admin.inspections?.detail;
  if (!d) return h('div', { class: 'admin-page' }, 'Loading…');

  const back = () => setState({
    admin: { ...admin, inspections: { ...admin.inspections, view: 'list', detail: null } },
  });

  const approve = async () => {
    const overrideStr = prompt('Override score? (leave blank to use computed)', '');
    const overrideScore = overrideStr ? Number(overrideStr) : null;
    const notes = prompt('Review notes (optional):') || null;
    try {
      await api.adminApproveInspection(getState().accessToken, d.id, { overrideScore, notes });
      back();
      loadAdminInspections();
    } catch (err) {
      setState({ admin: { ...admin, error: err.message } });
    }
  };

  const reject = async () => {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    try {
      await api.adminRejectInspection(getState().accessToken, d.id, { reason });
      back();
      loadAdminInspections();
    } catch (err) {
      setState({ admin: { ...admin, error: err.message } });
    }
  };

  return h('div', { class: 'admin-page' },
    h('header', { class: 'page-head' },
      h('button', { class: 'btn ghost', onclick: back }, '← Back'),
      h('div', { class: 'head-right' },
        h('span', { class: `pill ${d.status}` }, d.status))
    ),
    h('div', { class: 'detail-layout' },
      h('section', { class: 'detail-main' },
        h('h1', {}, d.listing.title),
        h('div', { class: 'muted' },
          `${d.listing.addressLine1}${d.listing.addressLine2 ? ', ' + d.listing.addressLine2 : ''}`),
        h('div', { class: 'muted' },
          `${d.listing.neighborhood || ''}, ${d.listing.city}, ${d.listing.state}`),

        d.flaggedReasons?.length
          ? h('div', { class: 'alert error' },
              'Flags: ' + d.flaggedReasons.join(', '))
          : null,

        h('h3', {}, 'Checklist results'),
        (d.template.definition.categories || []).map((cat) =>
          h('div', { class: 'checklist-cat' },
            h('h3', {}, cat.label),
            cat.items.map((item) => {
              const ans = d.items.find((i) => i.item_key === item.key);
              return h('div', { class: 'checklist-item' },
                h('div', { class: 'ci-label' }, item.label),
                h('div', { class: 'ci-answers' },
                  ans
                    ? h('span', { class: `chip ci-${ans.answer}` }, ans.answer)
                    : h('span', { class: 'muted' }, 'not answered'))
              );
            })
          )
        ),

        h('h3', {}, `Photos (${d.photos.length})`),
        h('div', { class: 'photo-grid' },
          d.photos.map((p) =>
            h('div', { class: 'photo-tile' },
              h('img', {
                src: p.url, alt: '',
                onclick: () => window.open(p.url, '_blank'),
              }),
              p.distanceToPropertyM != null
                ? h('span', { class: 'cover-badge' },
                    `${Math.round(p.distanceToPropertyM)}m`)
                : null,
              p.category
                ? h('span', { class: 'cover-badge', style: { left: 'auto', right: '6px' } }, p.category)
                : null
            )
          )
        )
      ),
      h('aside', { class: 'detail-side' },
        h('div', { class: 'card flat' },
          h('h2', {}, 'Score'),
          h('div', { style: { fontSize: '36px', fontWeight: '700' } },
            `${d.overrideScore ?? d.score}/100`),
          d.overrideScore != null
            ? h('div', { class: 'muted small' },
                `Overridden from ${d.score}`)
            : null
        ),
        h('div', { class: 'card flat' },
          h('h2', {}, 'Inspector'),
          h('div', {}, d.inspector
            ? `${d.inspector.firstName} ${d.inspector.lastName}`
            : '—'),
          h('div', { class: 'muted small' }, d.inspector?.phone)
        ),
        h('div', { class: 'card flat' },
          h('h2', {}, 'Visit integrity'),
          h('div', { class: 'info-row' },
            h('div', { class: 'info-label' }, 'Distance'),
            h('div', { class: 'info-value' },
              d.distanceToPropertyM != null
                ? `${Math.round(d.distanceToPropertyM)}m`
                : '—')),
          h('div', { class: 'info-row' },
            h('div', { class: 'info-label' }, 'Duration'),
            h('div', { class: 'info-value' },
              d.durationSeconds ? `${Math.round(d.durationSeconds / 60)} min` : '—')),
          h('div', { class: 'info-row' },
            h('div', { class: 'info-label' }, 'Selfie'),
            h('div', { class: 'info-value' },
              d.selfieUrl
                ? h('img', {
                    src: d.selfieUrl, alt: '',
                    style: { width: '60px', height: '60px', objectFit: 'cover', borderRadius: '8px', cursor: 'zoom-in' },
                    onclick: () => window.open(d.selfieUrl, '_blank'),
                  })
                : '—'))
        ),
        d.status === 'submitted'
          ? h('div', { class: 'review-actions' },
              h('button', { class: 'btn danger', onclick: reject }, 'Reject'),
              h('button', { class: 'btn success', onclick: approve }, 'Approve'))
          : null
      )
    )
  );
}

/* ---------- LOADERS ---------- */

export async function loadAdminInspections() {
  const { admin, accessToken } = getState();
  setState({ admin: { ...admin, inspections: { ...(admin.inspections || {}), loading: true } } });
  try {
    const res = await api.adminListInspections(accessToken, { status: 'submitted' });
    setState({
      admin: { ...admin, inspections: { ...admin.inspections, items: res.data, loading: false } },
    });
  } catch (err) {
    setState({ admin: { ...admin, inspections: { ...admin.inspections, loading: false }, error: err.message } });
  }
}

export async function openAdminInspection(id) {
  const { admin, accessToken } = getState();
  setState({ admin: { ...admin, inspections: { ...admin.inspections, view: 'detail', detail: null } } });
  try {
    const d = await api.adminGetInspection(accessToken, id);
    setState({ admin: { ...admin, inspections: { ...admin.inspections, detail: d } } });
  } catch (err) {
    setState({ admin: { ...admin, error: err.message } });
  }
}