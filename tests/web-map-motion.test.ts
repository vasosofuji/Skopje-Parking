import * as zoneInteraction from "../src/domain/zone-interaction";
import * as languageModule from "../src/domain/language";
import * as selectionCamera from "../src/domain/map-selection-camera";
import { createLayerCache } from "../src/domain/layer-cache";
import test from "node:test";
import { translate } from "../src/domain/language";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import type { ParkingMapProps } from "../src/components/mapTypes";
import { SKOPJE } from "../src/domain/parking";

test("web camera transitions run once per intent, hide moving projections, cancel for drawing and honor reduced motion", () => {
  const slots: unknown[] = [], effects: (() => void)[] = [], calls: string[] = [], positions: unknown[] = [];
  const cameraTargets: { point: number[]; zoom: number }[] = [];
  const events = new Map<string, () => void>();
  let cursor = 0, drawingZoom = true;
  let motionChanged: ((event: { matches: boolean }) => void) | undefined;
  const motion = { matches: false, addEventListener(_name: string, callback: typeof motionChanged) { motionChanged = callback; }, removeEventListener() {} };
  const layer = () => ({ addTo() { return this; }, getLayers: () => [], clearLayers() {}, setLatLngs() {}, off() {}, on() { return this; } });
  const map = {
    createPane() { return { style: {} }; },
    setView(point: number[], zoom: number) { cameraTargets.push({ point, zoom }); calls.push("immediate"); return this; }, flyTo(point: number[], zoom: number) { cameraTargets.push({ point, zoom }); calls.push("flight"); events.get("movestart")?.(); return this; }, stop() { calls.push("stop"); return this; },
    doubleClickZoom: { enable: () => { drawingZoom = true; }, disable: () => { drawingZoom = false; } },
    on(name: string, fn: () => void) { events.set(name, fn); return this; }, getZoom: () => 16, getCenter: () => ({ lat: 42, lng: 21 }),
    getBounds: () => ({ pad() { return this; }, contains: () => true }), latLngToContainerPoint: () => ({ x: 100, y: 200 }), invalidateSize() {}, remove() {},
  };
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
    useRef(value: unknown) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); },
    useState(value: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useEffect(fn: () => void, deps: unknown[]) { const index = cursor++, previous = slots[index] as unknown[] | undefined; if (!previous || deps.some((dep, i) => dep !== previous[i])) effects.push(fn); slots[index] = deps; },
  };
  const exports: { default?: (props: ParkingMapProps) => { props: { ref: { current: object | null } } } } = {};
  const source = ts.transpileModule(readFileSync("src/components/ParkingMap.web.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(source, { exports, process: { env: {} }, window: { matchMedia: () => motion }, ResizeObserver: class { observe() {} disconnect() {} }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "leaflet") return { __esModule: true, default: { map: () => map, tileLayer: layer, layerGroup: layer, polyline: layer, polygon: layer } };
    if (name.endsWith(".css")) return {};
    if (name.endsWith("parking")) return { SKOPJE };
    if (name.endsWith("layer-cache")) return { createLayerCache };
    if (name.endsWith("zone-interaction")) return zoneInteraction;
    if (name.endsWith("map-selection-camera")) return selectionCamera;
    if (name.endsWith("clusters")) return { groupParking: () => [] };
    if (name.endsWith("marker-appearance")) return {};
    throw new Error(name);
  } });
  const render = (props: ParkingMapProps) => { cursor = 0; const tree = exports.default!(props); tree.props.ref.current = {}; effects.splice(0).forEach(effect => effect()); };
  let props: ParkingMapProps = { now: 0, places: [], selectedId: null, destination: SKOPJE, destinationMarker: null, userLocation: null, picking: false, showZones: true, onSelect() {}, onPick() {}, onSelectedPosition: point => positions.push(point), language: "en" };
  render(props); assert.equal(calls.filter(call => call === "flight").length, 0);
  props = { ...props, selectedId: "one", selectedAnchor: SKOPJE }; render(props);
  assert.equal(calls.at(-1), "immediate");
  render({ ...props, now: 30_000, places: [] });
  assert.equal(calls.filter(call => call === "flight").length, 0);
  events.get("moveend")?.(); render(props);
  assert.equal((positions.at(-1) as { x: number }).x, 100);
  assert.equal((positions.at(-1) as { y: number }).y, 200);
  props = { ...props, selectedId: "two", selectedAnchor: { latitude: 42.1, longitude: 21.5 } }; render(props);
  render({ ...props, drawing: true, picking: true }); assert.equal(calls.at(-1), "stop"); assert.equal(drawingZoom, false);
  motion.matches = true; motionChanged?.({ matches: true });
  render({ ...props, selectedId: "three" });
  assert.equal(calls.at(-1), "immediate"); assert.equal(drawingZoom, true);
  props = { ...props, selectedId: null, selectedAnchor: null, destination: { latitude: 42.015, longitude: 21.435 }, cameraZoom: 18, cameraRevision: 1 };
  render(props);
  assert.equal(cameraTargets.at(-1)?.zoom, 18);
  assert.deepEqual(Array.from(cameraTargets.at(-1)!.point), [42.015, 21.435]);
  const count = cameraTargets.length;
  render({ ...props, now: 45_000 }); assert.equal(cameraTargets.length, count);
  render({ ...props, cameraRevision: 2 });
  assert.equal(cameraTargets.length, count + 1);
  assert.equal(cameraTargets.at(-1)?.zoom, 18, "repeated Near me intent is absolute, regardless of current zoom");
});
