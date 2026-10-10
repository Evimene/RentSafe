// h(tag, props, ...children) → DOM node
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in node) node.value = v;
    else node.setAttribute(k, v);
  }

  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === true || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Tiny store
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set: (patch) => {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      subs.forEach((fn) => fn(state));
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

// Render loop with focus preservation
export function mount(renderFn, container) {
  const rerender = () => {
    const active = document.activeElement;
    const focusKey = active?.dataset?.focusKey;
    const selStart = active?.selectionStart;
    const selEnd = active?.selectionEnd;

    container.replaceChildren(renderFn());

    if (focusKey) {
      const next = container.querySelector(`[data-focus-key="${focusKey}"]`);
      if (next) {
        next.focus();
        try { next.setSelectionRange(selStart, selEnd); } catch {}
      }
    }
  };
  rerender();
  return rerender;
}