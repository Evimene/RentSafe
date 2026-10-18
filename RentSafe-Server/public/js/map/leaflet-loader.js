const CDN = 'https://unpkg.com';
let loadingPromise = null;

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    // CSS
    const css = [
      `${CDN}/leaflet@1.9.4/dist/leaflet.css`,
      `${CDN}/leaflet.markercluster@1.5.3/dist/MarkerCluster.css`,
      `${CDN}/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css`,
    ];
    for (const href of css) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }

    // JS
    const scripts = [
      `${CDN}/leaflet@1.9.4/dist/leaflet.js`,
      `${CDN}/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js`,
    ];

    let i = 0;
    const loadNext = () => {
      if (i >= scripts.length) return resolve(window.L);
      const s = document.createElement('script');
      s.src = scripts[i++];
      s.async = true;
      s.onload = loadNext;
      s.onerror = () => reject(new Error(`Failed to load ${s.src}`));
      document.head.appendChild(s);
    };
    loadNext();
  });

  return loadingPromise;
}