import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { createBasemapStyle, googleBasemapStyle, BASEMAP_ATTRIBUTION } from "../src/domain/basemap-style";
import { guardVectorLayerRemoval, installBasemap, registerOfflineBasemap } from "../src/domain/basemap-lifecycle";

test("clean basemap validates and retains street names plus only named food and shops", () => {
  const style = createBasemapStyle();
  assert.deepEqual(validateStyleMin(style), []);
  const poi = style.layers.filter(layer => "source-layer" in layer && layer["source-layer"] === "poi");
  assert.equal(poi.length, 1); assert.equal(poi[0].minzoom, 16);
  assert.equal(poi[0].type, "symbol");
  if (poi[0].type !== "symbol") throw new Error("Expected business symbols");
  const filter = featureFilter(poi[0].filter);
  const accepts = (properties: Record<string, string>) => filter.filter({ zoom: 17 }, { type: 1, properties });
  assert.equal(accepts({ class: "shop", name: "Local market" }), true);
  assert.equal(accepts({ class: "food", subclass: "cafe", name: "Coffee" }), true);
  for (const klass of ["place_of_worship", "religion", "bus", "rail", "park", "school", "hospital", "attraction"]) assert.equal(accepts({ class: klass, name: "Named place" }), false);
  assert.equal(accepts({ class: "shop", name: "" }), false);
  assert.equal(accepts({ class: "food" }), false);
  assert.ok(style.layers.some(layer => layer.id === "highway-name-minor"));
  assert.ok(style.layers.some(layer => layer.id === "highway-name-major"));
  assert.ok(style.layers.findIndex(layer => layer.id === "skopje-parking-named-businesses") < style.layers.findIndex(layer => layer.id === "highway-name-minor"), "street labels are placed first and win collisions");
  assert.ok(style.layers.filter(layer => layer.type === "symbol").every(layer => !layer.layout?.["icon-image"] && layer.layout?.["text-allow-overlap"] === false));
  assert.equal(style.layers.some(layer => layer.type === "fill-extrusion"), false);
  assert.match(BASEMAP_ATTRIBUTION, /openstreetmap.org\/copyright/); assert.match(BASEMAP_ATTRIBUTION, /openmaptiles.org/); assert.match(BASEMAP_ATTRIBUTION, /openfreemap.org/);
  assert.ok(googleBasemapStyle(false).some(rule => rule.featureType === "poi.place_of_worship" && rule.stylers.some(value => "visibility" in value && value.visibility === "off")));
  assert.ok(readFileSync("src/vendor/maplibre.web.ts", "utf8").length < 300, "web bundling cannot include the native WebView's UMD asset strings");
});

function basemap(options: { supported?: boolean; forceRaster?: boolean; throws?: boolean; timeout?: number; removeThrows?: boolean; underlay?: boolean } = {}) {
  let rasters = 0, rasterRemovals = 0, vectors = 0, vectorRemovals = 0, shows = 0;
  let ready = () => {}, error = (_fatal?: boolean) => {};
  const dispose = installBasemap({
    supported: () => options.supported !== false,
    addRaster: () => { rasters++; return { remove() { rasterRemovals++; } }; },
    addVector: () => { vectors++; if (options.throws) throw new Error("WebGL unavailable"); return { remove() { vectorRemovals++; if (options.removeThrows) throw new Error("already removed"); }, show() { shows++; }, onReady(callback) { ready = callback; }, onError(callback) { error = callback; } }; },
  }, options.forceRaster, options.timeout, options.underlay);
  return { ready: () => ready(), error: (fatal = false) => error(fatal), dispose, counts: () => ({ rasters, rasterRemovals, vectors, vectorRemovals, shows }) };
}

test("basemap keeps raster until vector is ready, restores it on fatal context loss and disposes safely", () => {
  const map = basemap({ removeThrows: true });
  assert.equal(map.counts().rasterRemovals, 0);
  map.ready(); assert.equal(map.counts().shows, 1); assert.equal(map.counts().rasterRemovals, 1);
  map.error(true); assert.equal(map.counts().rasters, 2); assert.equal(map.counts().vectorRemovals, 1);
  map.error(true); assert.equal(map.counts().rasters, 2);
  map.dispose(); map.ready(); assert.equal(map.counts().shows, 1);
});

test("basemap supports custom raster overrides, unavailable WebGL, network errors and startup timeout", async () => {
  for (const options of [{ forceRaster: true }, { supported: false }]) { const map = basemap(options); assert.equal(map.counts().vectors, 0); map.dispose(); }
  const failed = basemap({ throws: true }); assert.equal(failed.counts().rasters, 1); failed.dispose();
  const network = basemap(); network.error(); network.error(); assert.equal(network.counts().vectorRemovals, 0); network.error(); assert.equal(network.counts().vectorRemovals, 1); network.dispose();
  const timeout = basemap({ timeout: 5 }); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(timeout.counts().vectorRemovals, 1); assert.equal(timeout.counts().rasterRemovals, 0); timeout.dispose();
});

test("the app map loads OSM raster tiles only when the vector basemap cannot be used", async () => {
  const healthy = basemap({ underlay: false });
  healthy.ready(); assert.deepEqual(healthy.counts(), { rasters: 0, rasterRemovals: 0, vectors: 1, vectorRemovals: 0, shows: 1 });
  healthy.error(true); assert.equal(healthy.counts().rasters, 1, "context loss still falls back to raster");
  healthy.dispose(); assert.equal(healthy.counts().rasterRemovals, 1);
  for (const options of [{ supported: false }, { throws: true }, { forceRaster: true }]) {
    const map = basemap({ ...options, underlay: false }); assert.equal(map.counts().rasters, 1); map.dispose();
  }
  const slow = basemap({ underlay: false, timeout: 5 }); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(slow.counts().rasters, 1); slow.dispose();
});

test("the installed adapter initializes against a read-only v5 transform and unregisters failed GL layers", () => {
  type Container = { remove: () => void };
  type AdapterMap = {
    options: { zoomAnimation: boolean };
    getCenter: () => { lat: number; lng: number };
    getZoom: () => number;
    getPane: () => { removeChild: (container: Container) => Container };
  };
  type Layer = Parameters<typeof guardVectorLayerRemoval<AdapterMap>>[0] & {
    _initGL: () => void; _map: AdapterMap; _container: Container; options: Record<string, unknown>;
  };
  const adapter = readFileSync("node_modules/@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js", "utf8");
  for (const failure of ["constructor", "context-loss", "detached-container"] as const) {
    let attached = true, disposals = 0, constraints = 0, zoom: number | undefined;
    class ReadonlyTransform { get latRange() { return [-85, 85]; } get maxValidLatitude() { return 85; } }
    class GLMap {
      readonly transform = new ReadonlyTransform(); readonly _canvas = {};
      constructor() { if (failure === "constructor") throw new Error("GPU context unavailable"); }
      getStyle() { return { sources: {} }; }
      on() { return this; }
      setTransformConstrain() { constraints++; }
      jumpTo(options: { zoom: number }) { zoom = options.zoom; }
      remove() { disposals++; if (failure === "context-loss") throw new Error("Destroyed GL context"); }
    }
    const L: Record<string, unknown> & { MaplibreGL?: new () => Layer } = {
      Layer: { extend(definition: Record<string, unknown>) { function Layer() {} Object.assign(Layer.prototype, definition); return Layer; } },
      extend: Object.assign, DomUtil: { addClass() {} },
    };
    runInNewContext(adapter, { L, maplibregl: { Map: GLMap } });
    assert.ok(L.MaplibreGL);
    const layer = new L.MaplibreGL();
    const container = { remove() { attached = false; } };
    layer._map = {
      options: { zoomAnimation: false }, getCenter: () => ({ lat: 42, lng: 21.43 }), getZoom: () => 15,
      getPane: () => ({ removeChild(node) { if (!attached) throw new Error("Container already removed"); attached = false; return node; } }),
    };
    layer._container = container; layer.options = {};
    if (failure === "constructor") assert.throws(() => layer._initGL(), /GPU context unavailable/);
    else {
      layer._initGL(); assert.equal(constraints, 1); assert.equal(zoom, 14);
      if (failure === "detached-container") attached = false;
    }
    guardVectorLayerRemoval(layer);
    const registered = new Set([layer]);
    let eventsAttached = true;
    // Leaflet removes registration and fires event cleanup only AFTER onRemove returns.
    const removeLayer = () => { layer.onRemove(layer._map); registered.delete(layer); eventsAttached = false; };
    assert.doesNotThrow(removeLayer, failure);
    assert.equal(registered.size, 0, failure); assert.equal(eventsAttached, false, failure);
    assert.equal(attached, false, failure);
    if (failure !== "constructor") assert.ok(disposals >= 1, failure);
  }
});


test("the Android map reads the bundled Skopje streets, and falls back to online tiles in a build without them", async () => {
  const offline = createBasemapStyle(true);
  assert.deepEqual(validateStyleMin(offline), []);
  const source = offline.sources.openmaptiles;
  assert.ok(source.type === "vector" && source.tiles?.[0] === "offline://tiles/{z}/{x}/{y}.pbf" && source.maxzoom === 14);
  assert.deepEqual(source.type === "vector" && source.bounds, [21.22, 41.86, 21.66, 42.13]);
  assert.equal(offline.glyphs, "offline://fonts/{fontstack}/{range}.pbf");
  assert.equal(JSON.stringify(offline).includes("openfreemap.org/planet"), false, "no tile server");
  assert.ok(existsSync("assets/offline-map/fonts/Noto Sans Regular/1024-1279.pbf"), "Cyrillic street names");
  for (const layer of offline.layers) if (layer.type === "symbol") for (const font of layer.layout?.["text-font"] as string[] ?? [])
    assert.ok(existsSync(`assets/offline-map/fonts/${font}/0-255.pbf`), font);

  const files: Record<string, ArrayBuffer> = { "manifest.json": new ArrayBuffer(2), "tiles/14/9046/6012.pbf": new ArrayBuffer(9), "fonts/Noto Sans Bold/0-255.pbf": new ArrayBuffer(5) };
  const opened: string[] = [];
  const serve = (available: Record<string, ArrayBuffer>) => class {
    responseType = ""; status = 0; response: ArrayBuffer | null = null; onload: (() => void) | null = null; onerror: (() => void) | null = null; private url = "";
    open(_method: string, url: string) { this.url = url; opened.push(url); }
    send() { const path = this.url.replace("file:///android_asset/offline-map/", ""); setImmediate(() => { if (available[path]) { this.response = available[path]; this.onload?.(); } else this.onerror?.(); }); }
  };
  const protocols = new Map<string, (params: { url: string }) => Promise<{ data: ArrayBuffer }>>();
  const maplibre = { addProtocol: (name: string, load: (params: { url: string }) => Promise<{ data: ArrayBuffer }>) => { protocols.set(name, load); } };
  const ready = await new Promise<boolean>(resolve => registerOfflineBasemap(maplibre, "file:///android_asset/offline-map/", serve(files), resolve));
  assert.equal(ready, true);
  const load = protocols.get("offline")!;
  assert.equal((await load({ url: "offline://tiles/14/9046/6012.pbf" })).data.byteLength, 9);
  assert.equal((await load({ url: "offline://fonts/Noto%20Sans%20Bold/0-255.pbf" })).data.byteLength, 5);
  assert.equal((await load({ url: "offline://tiles/14/1/1.pbf" })).data.byteLength, 0, "outside Skopje is empty, not an error");
  protocols.clear();
  const old = await new Promise<boolean>(resolve => registerOfflineBasemap(maplibre, "file:///android_asset/offline-map/", serve({}), resolve));
  assert.equal(old, false); assert.equal(protocols.size, 0);
  assert.ok(opened.every(url => url.startsWith("file:///android_asset/offline-map/")));
});
