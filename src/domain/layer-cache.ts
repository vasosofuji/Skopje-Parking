/** Reuse unchanged layers and keep a small detached LRU for nearby return visits. */
export function createLayerCache<T>(add: (layer: T) => void, remove: (layer: T) => void, dispose: (layer: T) => void, limit = 1200) {
  // Injected into the map WebView via toString(); Hermes keeps source only with this directive.
  "show source";
  const entries = new Map<string, { signature: string; layer: T; attached: boolean }>();
  let seen = new Set<string>();
  return {
    begin() { seen = new Set(); },
    use(key: string, signature: string, create: () => T) {
      seen.add(key);
      let entry = entries.get(key);
      if (entry && entry.signature !== signature) { if (entry.attached) remove(entry.layer); dispose(entry.layer); entries.delete(key); entry = undefined; }
      if (!entry) entry = { signature, layer: create(), attached: false };
      if (!entry.attached) { add(entry.layer); entry.attached = true; }
      entries.delete(key); entries.set(key, entry);
      return entry.layer;
    },
    end() {
      for (const [key, entry] of entries) if (!seen.has(key) && entry.attached) { remove(entry.layer); entry.attached = false; }
      for (const [key, entry] of entries) {
        if (entries.size <= limit) break;
        if (!entry.attached) { dispose(entry.layer); entries.delete(key); }
      }
    },
    clear() { for (const entry of entries.values()) { if (entry.attached) remove(entry.layer); dispose(entry.layer); } entries.clear(); },
  };
}
