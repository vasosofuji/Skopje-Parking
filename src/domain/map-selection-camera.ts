/** Near me always frames the latest fix at street level, regardless of prior zoom. */
export const CURRENT_LOCATION_ZOOM = 18;

/** Match native framing to the Leaflet overview and its absolute zoom levels. */
export function mapCameraDeltas(zoom = 15) {
  const span = 0.022 / 2 ** (zoom - 15);
  return { latitudeDelta: span, longitudeDelta: span };
}

/** POC tariff sectors need context around their streets, rather than a pin-sized close-up. */
export function parkingSelectionZoom(currentZoom: number, pocSector: boolean) {
  // Injected into the map WebView via toString(); Hermes keeps source only with this directive.
  "show source";
  const current = Number.isFinite(currentZoom) && currentZoom > 0 ? currentZoom : 15;
  return pocSector ? Math.max(current, Math.min(16, current + 0.5)) : Math.max(16, current);
}

/** Native region spans retain their aspect ratio; 0.022 is this map's overview span. */
export function parkingSelectionDeltas(latitudeDelta: number, longitudeDelta: number, pocSector: boolean) {
  if (!pocSector) return { latitudeDelta: Math.min(0.011, latitudeDelta), longitudeDelta: Math.min(0.011, longitudeDelta) };
  const latitude = Number.isFinite(latitudeDelta) && latitudeDelta > 0 ? latitudeDelta : 0.022;
  const longitude = Number.isFinite(longitudeDelta) && longitudeDelta > 0 ? longitudeDelta : latitude;
  const current = 15 + Math.log2(0.022 / latitude);
  const scale = 2 ** (parkingSelectionZoom(current, true) - current);
  return { latitudeDelta: latitude / scale, longitudeDelta: longitude / scale };
}
