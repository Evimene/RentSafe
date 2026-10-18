import { loadLeaflet } from './leaflet-loader.js';

const fmtShort = (kobo) => {
  const n = Number(kobo) / 100;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `₦${Math.round(n / 1_000)}k`;
  return `₦${Math.round(n)}`;
};

function priceIcon(priceKobo, { instant = false, active = false } = {}) {
  const label = fmtShort(priceKobo);
  const cls = ['price-marker'];
  if (active) cls.push('pm-active');
  if (instant) cls.push('pm-instant');
  return window.L.divIcon({
    className: cls.join(' '),
    html: `<span class="pm-label">${label}</span>`,
    iconSize: null,
    iconAnchor: [20, 32],
  });
}

/* ============================================================
   MarkerLayer — owns the cluster group + marker map
   ============================================================ */

export class MarkerLayer {
  constructor(map) {
    this.map = map;
    this.cluster = window.L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: (zoom) => (zoom <= 10 ? 70 : zoom <= 12 ? 55 : 45),
      disableClusteringAtZoom: 16,
      chunkedLoading: true,
    });
    map.addLayer(this.cluster);
    this.markers = new Map(); // id -> L.Marker
    this.listingsById = new Map();
    this.activeId = null;
    this.onClick = null;
    this.onHover = null;
  }

  setListings(listings) {
    this.listingsById = new Map(listings.map((l) => [l.id, l]));

    // Remove markers that no longer exist
    for (const [id, marker] of this.markers) {
      if (!this.listingsById.has(id)) {
        this.cluster.removeLayer(marker);
        this.markers.delete(id);
      }
    }

    // Add new, update existing
    for (const listing of listings) {
      let marker = this.markers.get(listing.id);
      if (marker) {
        // Update icon if active state changed or price changed
        const active = listing.id === this.activeId;
        marker.setIcon(priceIcon(listing.priceKobo, { instant: listing.instant, active }));
      } else {
        const active = listing.id === this.activeId;
        marker = window.L.marker([listing.lat, listing.lng], {
          icon: priceIcon(listing.priceKobo, { instant: listing.instant, active }),
          riseOnHover: true,
          keyboard: false,
        });
        marker.on('click', () => this.onClick?.(listing.id));
        marker.on('mouseover', () => this.onHover?.(listing.id, true));
        marker.on('mouseout', () => this.onHover?.(listing.id, false));
        this.markers.set(listing.id, marker);
        this.cluster.addLayer(marker);
      }
    }

    // Re-apply active state after rebuild
    this.applyActive();
  }

  setActive(id) {
    if (this.activeId === id) return;
    this.activeId = id;
    this.applyActive();
  }

  applyActive() {
    for (const [id, marker] of this.markers) {
      const listing = this.listingsById.get(id);
      if (!listing) continue;
      const active = id === this.activeId;
      marker.setIcon(priceIcon(listing.priceKobo, { instant: listing.instant, active }));
      marker.setZIndexOffset(active ? 2000 : 0);
    }
  }

  focusListing(id) {
    const marker = this.markers.get(id);
    if (!marker) return;
    // If clustered, zoom in to un-cluster
    if (this.cluster.getVisibleParent(marker) !== marker) {
      this.cluster.zoomToShowLayer(marker, () => {
        marker.openPopup?.();
      });
    }
  }

  clear() {
    this.cluster.clearLayers();
    this.markers.clear();
    this.listingsById.clear();
  }

  destroy() {
    this.clear();
    this.map.removeLayer(this.cluster);
  }
}