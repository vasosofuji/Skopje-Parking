type Vector = { remove: () => void; show: () => void; onReady: (callback: () => void) => void; onError: (callback: (fatal?: boolean) => void) => void };
type Adapter = { addRaster: () => { remove: () => void }; addVector: () => Vector; supported: () => boolean };

/** Let Leaflet finish unregistering a layer even when GL never initialized or already lost its context. */
export function guardVectorLayerRemoval<Map>(layer: {
  onRemove: (map: Map) => unknown;
  getMaplibreMap: () => { remove: () => void } | undefined;
  getContainer: () => { remove: () => void } | undefined;
}) {
  // Injected into the map WebView via toString(); Hermes keeps source only with this directive.
  "show source";
  const original = layer.onRemove;
  layer.onRemove = function (map) {
    try { original.call(this, map); }
    catch {
      try { this.getMaplibreMap()?.remove(); } catch { /* Failed contexts can throw during disposal. */ }
      try { this.getContainer()?.remove(); } catch { /* An already detached container needs no cleanup. */ }
    }
  };
}

/** A raster stays beneath the vector until it is ready; errors never leave an empty map.
 * Without `rasterUnderlay` the raster loads only as a fallback: OSM's public tile servers
 * do not allow distributed apps to use them by default. */
export function installBasemap(adapter: Adapter, forceRaster = false, timeoutMs = 15000, rasterUnderlay = true) {
  // Injected into the map WebView via toString(); Hermes keeps source only with this directive.
  "show source";
  let raster = forceRaster || rasterUnderlay ? adapter.addRaster() : undefined;
  let vector: Vector | undefined, disposed = false, failed = false, ready = false, errors = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lifecycle = { fallback() {
    if (disposed || failed) return;
    failed = true;
    if (timer) clearTimeout(timer);
    if (ready || !raster) raster = adapter.addRaster();
    try { vector?.remove(); } catch { /* Keep the raster even if a failed GL context cannot dispose normally. */ } vector = undefined;
  } };
  if (!forceRaster) {
    try {
      if (adapter.supported()) {
        vector = adapter.addVector();
        timer = setTimeout(lifecycle.fallback, timeoutMs);
        vector.onReady(() => {
          if (disposed || failed) return;
          ready = true; errors = 0;
          if (timer) clearTimeout(timer);
          vector?.show(); raster?.remove();
        });
        vector.onError(fatal => { if (fatal || ++errors >= 3) lifecycle.fallback(); });
      } else if (!raster) raster = adapter.addRaster();
    } catch { lifecycle.fallback(); }
  }
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    try { vector?.remove(); } catch { /* A destroyed WebGL context may already have removed itself. */ }
    raster?.remove();
  };
}

type Loader = { open(method: string, url: string): void; send(): void; responseType: string; status: number; response: ArrayBuffer | null; onload: (() => void) | null; onerror: (() => void) | null };
/** Serves offline:// tiles and glyphs from files bundled with the app; `ready` is false when they are
 * missing (an older build), so the map uses the online style. A missing tile is an empty tile. */
export function registerOfflineBasemap(maplibre: { addProtocol: (name: string, load: (params: { url: string }) => Promise<{ data: ArrayBuffer }>) => void }, root: string, Request: new () => Loader, ready: (available: boolean) => void) {
  // Injected into the map WebView via toString(); Hermes keeps source only with this directive.
  "show source";
  const read = (path: string, done: (data: ArrayBuffer | null) => void) => {
    const request = new Request();
    request.open("GET", root + path);
    request.responseType = "arraybuffer";
    // file:// answers with status 0.
    request.onload = () => done((request.status === 200 || request.status === 0) && request.response?.byteLength ? request.response : null);
    request.onerror = () => done(null);
    request.send();
  };
  read("manifest.json", manifest => {
    if (manifest) maplibre.addProtocol("offline", params => new Promise(resolve => read(decodeURIComponent(params.url.slice("offline://".length)), data => resolve({ data: data ?? new ArrayBuffer(0) }))));
    ready(Boolean(manifest));
  });
}
