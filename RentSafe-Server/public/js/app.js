import { h, mount } from './mini.js';
import { store, setState, getState } from './store.js';
import { api } from './api.js';
import {
  AdminShell, AdminKycList, AdminKycDetail, AdminAudit,
  loadStats, loadKycList, openKycDetail, loadAudit,
} from './admin.js';
import {
  InspectorShell, InspectorQueue, InspectorHistory,
  InspectorEarnings, InspectorProfile, InspectorInspectionDetail,
  loadQueue as loadInspectorQueue,
} from './inspector.js';

import { AdminInspections, AdminInspectionDetail, loadAdminInspections } from './admin.js';

//---------------> helpers
const navigate = (route) => setState({ route, error: null, flash: null });

function Field({ label, name, type = 'text', placeholder = '', autocomplete }) {
  return h('label', { class: 'field' },
    h('span', { class: 'label' }, label),
    h('input', {
      type, name, placeholder,
      autocomplete: autocomplete || 'off',
      'data-focus-key': name,
      required: true,
    })
  );
}

function Alert() {
  const { error, flash } = getState();
  if (!error && !flash) return null;
  return h('div', { class: error ? 'alert error' : 'alert success' },
    error || flash);
}

const Spinner = () => h('span', { class: 'spinner' });

function isInspector(user) {
  return (user?.roles || []).includes('inspector');
}

//------------------> header
function Header() {
  const { user, accessToken } = getState();
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'RentSafe'),
    h('nav', {},
      accessToken
        ? h('div', { class: 'user' },
          isAdmin(user)
            ? h('button', {
              class: 'link',
              onclick: () => {
                setState({ route: 'admin', admin: { ...getState().admin, view: 'kyc_list' } });
                loadStats();
                loadKycList();
              },
            }, 'Admin')
            : null,

          isInspector(user)
            ? h('button', {
              class: 'link',
              onclick: () => {
                setState({ route: 'inspector', inspector: { ...getState().inspector, view: 'queue' } });
                loadInspectorQueue();
              },
            }, 'Inspector')
            : null,

          h('button', { class: 'link', onclick: () => { setState({ route: 'browse' }); runSearch(); } }, 'Browse'),
          h('button', { class: 'link', onclick: () => { setState({ route: 'host' }); loadHostListings(); } }, 'Hosting'),
          h('span', {}, user?.firstName || 'User'),
          h('button', {
            class: 'link',
            onclick: async () => {
              try { await api.logout({ refreshToken: getState().refreshToken }); } catch { }
              localStorage.removeItem('refreshToken');
              setState({ accessToken: null, refreshToken: null, user: null, route: 'login' });
            },
          }, 'Log out'))
        : h('span', { class: 'muted' }, 'Nigeria · escrow-protected stays')
    )
  );
}

// ------------> Register 
function RegisterScreen() {
  const loading = getState().loading;
  return h('main', { class: 'screen' },
    Alert(),
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        setState({ loading: true, error: null, flash: null });
        try {
          const res = await api.register(body);
          setState({
            loading: false,
            pendingPhone: body.phone,
            user: res.user,
            devOtp: res.devCode || null,
            flash: 'Account created. Enter the OTP sent to your phone.',
            route: 'verify',
          });
        } catch (err) {
          setState({ loading: false, error: err.message });
        }
      },
    },
      h('h1', {}, 'Create your account'),
      h('p', { class: 'muted' }, 'Rent safely. Pay only through escrow.'),
      Field({ label: 'First name', name: 'firstName' }),
      Field({ label: 'Last name', name: 'lastName' }),
      Field({ label: 'Phone (+234…)', name: 'phone', type: 'tel', autocomplete: 'tel' }),
      Field({ label: 'Email (optional)', name: 'email', type: 'email', autocomplete: 'email' }),
      Field({ label: 'Password', name: 'password', type: 'password', autocomplete: 'new-password' }),
      h('label', { class: 'field' },
        h('span', { class: 'label' }, 'I want to'),
        h('select', { name: 'role' },
          h('option', { value: 'guest' }, 'Book a stay (guest)'),
          h('option', { value: 'host' }, 'List my place (host)')
        )
      ),
      h('button', { class: 'primary', type: 'submit', disabled: loading },
        loading ? Spinner() : 'Create account'),
      h('p', { class: 'muted small' },
        'Already have an account? ',
        h('button', {
          type: 'button', class: 'link',
          onclick: () => navigate('login'),
        }, 'Log in')
      )
    )
  );
}

// --------------------------> Verify
function VerifyScreen() {
  const { pendingPhone, devOtp, loading } = getState();

  const resend = async () => {
    try {
      const res = await api.resendOtp({ phone: pendingPhone, purpose: 'verify_phone' });
      setState({
        flash: 'Code resent.', devOtp: res.devCode || null, error: null,
      });
    } catch (err) {
      setState({ error: err.message });
    }
  };

  return h('main', { class: 'screen' },
    Alert(),
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const { code } = Object.fromEntries(new FormData(e.target).entries());
        setState({ loading: true, error: null });
        try {
          await api.verifyPhone({ phone: pendingPhone, code });
          setState({
            loading: false,
            flash: 'Phone verified. Please log in.',
            route: 'login',
            devOtp: null,
          });
        } catch (err) {
          setState({ loading: false, error: err.message });
        }
      },
    },
      h('h1', {}, 'Verify your phone'),
      h('p', { class: 'muted' },
        `We sent a 6-digit code to ${pendingPhone || 'your phone'}.`),
      devOtp ? h('p', { class: 'dev' }, `DEV OTP: ${devOtp}`) : null,
      Field({ label: 'OTP code', name: 'code', autocomplete: 'one-time-code' }),
      h('button', { class: 'primary', type: 'submit', disabled: loading },
        loading ? Spinner() : 'Verify'),
      h('button', {
        type: 'button', class: 'link', style: { marginTop: '12px' },
        onclick: resend,
      }, 'Resend code'),
      h('p', { class: 'muted small' },
        h('button', {
          type: 'button', class: 'link',
          onclick: () => navigate('register'),
        }, 'Back to register')
      )
    )
  );
}

// ----------------------> Login
function LoginScreen() {
  const loading = getState().loading;
  return h('main', { class: 'screen' },
    Alert(),
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        setState({ loading: true, error: null });
        try {
          const res = await api.login(body);
          localStorage.setItem('refreshToken', res.refreshToken);
          setState({
            loading: false,
            user: res.user,
            accessToken: res.accessToken,
            refreshToken: res.refreshToken,
            route: 'dashboard',
            flash: null,
          });
          if (isAdmin(res.user)) {
            loadStats();
            loadKycList();
          } else if (isInspector(res.user)) {
            loadInspectorQueue();
          }
          loadKyc();
        } catch (err) {
          setState({ loading: false, error: err.message });
        }
      },
    },
      h('h1', {}, 'Welcome back'),
      Field({ label: 'Phone or email', name: 'identifier', autocomplete: 'username' }),
      Field({ label: 'Password', name: 'password', type: 'password', autocomplete: 'current-password' }),
      h('button', { class: 'primary', type: 'submit', disabled: loading },
        loading ? Spinner() : 'Log in'),
      h('p', { class: 'muted small' },
        h('button', {
          type: 'button', class: 'link',
          onclick: () => navigate('register'),
        }, 'Create account')
      )
    )
  );
}

// ------------------> DAshboard
function DashboardScreen() {
  const { user, kyc } = getState();
  const overall = kyc.overall || user?.kycStatus || 'pending';
  return h('main', { class: 'screen' },
    Alert(),
    h('section', { class: 'card' },
      h('h1', {}, `Hi, ${user?.firstName || 'there'}`),
      h('p', { class: 'muted' },
        'KYC status: ', h('strong', { class: `pill ${overall}` }, overall)),
      h('button', {
        class: 'primary',
        onclick: () => navigate('kyc'),
      }, 'Verify identity (KYC)')
    )
  );
}

// -----------------> KYC
function KycScreen() {
  const { kyc, loading } = getState();

  return h('main', { class: 'screen' },
    Alert(),
    h('section', { class: 'card' },
      h('h1', {}, 'Identity verification'),
      h('p', { class: 'muted' },
        'We verify with NIN or BVN. Your data is encrypted and never shared with hosts.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          setState({ loading: true, error: null });
          try {
            const res = await api.submitKyc(getState().accessToken, fd);
            setState({
              loading: false,
              flash: `KYC ${res.status}${res.reason ? ' — ' + res.reason : ''}`,
              error: null,
            });
            loadKyc();
          } catch (err) {
            setState({ loading: false, error: err.message });
          }
        },
      },
        h('label', { class: 'field' },
          h('span', { class: 'label' }, 'ID type'),
          h('select', { name: 'type' },
            h('option', { value: 'nin' }, 'NIN'),
            h('option', { value: 'bvn' }, 'BVN')
          )
        ),
        Field({ label: 'ID number', name: 'number' }),
        Field({ label: 'First name (as on ID)', name: 'firstName' }),
        Field({ label: 'Last name (as on ID)', name: 'lastName' }),
        h('label', { class: 'field' },
          h('span', { class: 'label' }, 'Selfie (optional for now)'),
          h('input', { type: 'file', name: 'selfie', accept: 'image/*' })
        ),
        h('button', { class: 'primary', type: 'submit', disabled: loading },
          loading ? Spinner() : 'Submit for verification')
      ),
      h('h2', {}, 'History'),
      kyc.records.length === 0
        ? h('p', { class: 'muted' }, 'No submissions yet.')
        : h('ul', { class: 'records' },
          kyc.records.map((r) =>
            h('li', {},
              h('strong', {}, String(r.type).toUpperCase()),
              ' — ', h('span', { class: `pill ${r.status}` }, r.status),
              r.reason ? h('span', { class: 'muted' }, ` (${r.reason})`) : null
            )
          )
        )
    ),
    h('button', {
      class: 'link',
      onclick: () => navigate('dashboard'),
    }, '← Back to dashboard')
  );
}

async function loadKyc() {
  const { accessToken } = getState();
  if (!accessToken) return;
  try {
    const res = await api.kycStatus(accessToken);
    setState({ kyc: { overall: res.overall, records: res.records } });
  } catch (err) {
    console.warn('kyc load failed', err.message);
  }
}

function isAdmin(user) {
  const roles = user?.roles || [];
  return roles.includes('admin') || roles.includes('support');
}


// -------------> Root
function App() {
  const { route, accessToken, user, admin, inspector, browse } = getState();
  const publicRoutes = new Set(['register', 'verify', 'login']);


  // Inspector routes
  if (accessToken && isInspector(user) && route === 'inspector') {
    let screen;
    switch (inspector.view) {
      case 'history': screen = InspectorHistory(); break;
      case 'earnings': screen = InspectorEarnings(); break;
      case 'profile': screen = InspectorProfile(); break;
      case 'detail': screen = InspectorInspectionDetail(); break;
      case 'queue': 
      default: screen = InspectorQueue();
    }
    return InspectorShell({ children: screen });
  }

  // Admin routes
  if (accessToken && isAdmin(user) && route.startsWith('admin')) {
    let screen;
    switch (admin.view) {
      case 'inspection_detail': screen = AdminInspectionDetail(); break;
      case 'inspection_list': screen = AdminInspections(); break;
      case 'kyc_detail': screen = AdminKycDetail(); break;
      case 'audit': screen = AdminAudit(); break;
      case 'host': screen = HostDashboard(); break;
      case 'browse':
        if (getState().browse.view === 'map') {
          screen = BrowseMapView();
        } else if (getState().browse.view === 'detail') {
          screen = ListingDetail();
        } else {
          screen = BrowseScreen();
        }
        break;
      case 'listing_list':
        screen = AdminListings();
        if (!admin.listings) loadAdminListings();
        break;
      case 'listing_detail':
        screen = AdminListingDetail();
        break;
      case 'kyc_list':
      default: screen = AdminKycList();

    }
    return AdminShell({ children: screen });
  }

  // Regular user routes
  let screen;
  if (!accessToken && !publicRoutes.has(route)) screen = LoginScreen();
  else switch (route) {
    case 'register': screen = RegisterScreen(); break;
    case 'verify': screen = VerifyScreen(); break;
    case 'login': screen = LoginScreen(); break;
    case 'kyc': screen = KycScreen(); break;
    case 'dashboard': screen = DashboardScreen(); break;
    default: screen = LoginScreen();
  }

  return h('div', { class: 'app' }, Header(), screen);
}

// --------------> Boot
const root = document.getElementById('root');
const rerender = mount(App, root);
const originalRender = renderFn;
store.subscribe(() => rerender());

// Try silent refresh on boot
(async () => {
  const saved = localStorage.getItem('refreshToken');
  if (!saved) return;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: saved }),
    });
    if (!res.ok) throw new Error('refresh failed');
    const data = await res.json();
    localStorage.setItem('refreshToken', data.refreshToken);
    setState({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      route: 'dashboard',
    });
    const me = await api.me(data.accessToken);
    setState({ user: me.user });
    if (isAdmin(me.user)) {
      loadStats();
      loadKycList();
    } else if (isInspector(me.user)) {
      loadInspectorQueue();
    }
    loadKyc();
  } catch {
    localStorage.removeItem('refreshToken');
  }
})();