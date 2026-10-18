import { h } from '../mini.js';
import { getState, setState } from '../store.js';
import { api } from '../api.js';

let debounceTimer = null;
let abortController = null;

export function GeocoderInput({ value, onPick, onClear }) {
  return h('div', { class: 'geocoder' },
    h('div', { class: 'geocoder-input-wrap' },
      h('span', { class: 'geocoder-icon' }, '📍'),
      h('input', {
        type: 'text',
        class: 'geocoder-input',
        placeholder: 'Search a city, neighborhood, or address…',
        value: value || '',
        'data-focus-key': 'geocoder',
        oninput: (e) => handleInput(e.target.value, onPick),
        onkeydown: (e) => {
          if (e.key === 'Escape') onClear?.();
        },
      }),
      value ? h('button', {
        class: 'geocoder-clear', type: 'button',
        onclick: () => { onClear?.(); },
      }, '✕') : null
    ),
    GeocoderSuggestions({ onPick })
  );
}

function GeocoderSuggestions({ onPick }) {
  const { browse } = getState();
  const s = browse.geocoder;
  if (!s?.open) return null;
  if (s.loading) return h('div', { class: 'geocoder-suggest loading' }, 'Searching…');
  if (s.error) return h('div', { class: 'geocoder-suggest error' }, s.error);
  if (!s.results.length) return h('div', { class: 'geocoder-suggest empty' }, 'No matches');
  return h('ul', { class: 'geocoder-suggest' },
    s.results.map((r) =>
      h('li', {
        onclick: () => {
          onPick?.(r);
          setState({
            browse: { ...browse, geocoder: { open: false, results: [], loading: false } },
          });
        },
      },
        h('div', { class: 'g-name' }, r.shortName || r.displayName.split(',')[0]),
        h('div', { class: 'g-rest' }, r.displayName)
      )
    )
  );
}

async function handleInput(text, onPick) {
  const { browse, accessToken } = getState();
  clearTimeout(debounceTimer);

  if (!text || text.length < 2) {
    setState({ browse: { ...browse, geocoder: { open: false, results: [], loading: false } } });
    return;
  }

  setState({ browse: { ...browse, geocoder: { open: true, results: [], loading: true, error: null } } });
  debounceTimer = setTimeout(async () => {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    try {
      const res = await api.geocode(accessToken, text);
      setState({
        browse: { ...browse, geocoder: { open: true, loading: false, results: res.results || [], error: null } },
      });
    } catch (err) {
      setState({
        browse: { ...browse, geocoder: { open: true, loading: false, results: [], error: 'Search failed' } },
      });
    }
  }, 350);
}