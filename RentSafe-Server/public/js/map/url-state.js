const MAP_PARAMS = ['view', 'lat', 'lng', 'z', 'city', 'checkIn', 'checkOut', 'guests',
  'minPrice', 'maxPrice', 'type', 'amenities', 'instant'];

export function readMapStateFromURL() {
const params = new URLSearchParams(window.location.search);
const out = {};
for (const k of MAP_PARAMS) {
const v = params.get(k);
if (v != null) out[k] = v;
}
return {
view: out.view === 'map' ? 'map' : 'list',
center: out.lat && out.lng ? { lat: Number(out.lat), lng: Number(out.lng) } : null,
zoom: out.z ? Number(out.z) : null,
filters: {
city: out.city || '',
checkIn: out.checkIn || '',
checkOut: out.checkOut || '',
guests: out.guests || '1',
minPrice: out.minPrice || '',
maxPrice: out.maxPrice || '',
type: out.type || '',
amenities: out.amenities || '',
instant: out.instant || '',
},
};
}

let writeTimer = null;

export function writeMapStateToURL(state) {
clearTimeout(writeTimer);
writeTimer = setTimeout(() => {
const params = new URLSearchParams();
params.set('view', state.view || 'list');
if (state.center) {
params.set('lat', state.center.lat.toFixed(5));
params.set('lng', state.center.lng.toFixed(5));
}
if (state.zoom) params.set('z', String(state.zoom));
const f = state.filters || {};
for (const k of ['city', 'checkIn', 'checkOut', 'guests', 'minPrice', 'maxPrice', 'type', 'amenities', 'instant']) {
if (f[k]) params.set(k, f[k]);
}
const qs = params.toString();
const next = `${window.location.pathname}${qs ? '?' + qs : ''}`;
window.history.replaceState(null, '', next);
}, 400);
}