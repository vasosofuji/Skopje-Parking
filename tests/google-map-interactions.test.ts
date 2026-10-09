import { googleBasemapStyle } from "../src/domain/basemap-style";
import * as languageModule from "../src/domain/language";
import * as zoneInteraction from "../src/domain/zone-interaction";
import * as selectionCamera from "../src/domain/map-selection-camera";
import test from "node:test";
import { translate } from "../src/domain/language";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { groupParking } from "../src/domain/clusters";
import { parkingMarker } from "../src/domain/marker-appearance";
import { createOverlayTapGate } from "../src/domain/map-interactions";
import { SKOPJE } from "../src/domain/parking";
import type { ParkingMapProps } from "../src/components/mapTypes";
type Node = { type: string; props: Record<string, unknown>; children: (Node | Node[])[] };

function renderer() {
  const slots: unknown[] = [], effects: (() => void)[] = [];
  let cursor = 0;
  let motionChanged: ((value: boolean) => void) | undefined;
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const index = cursor++, previous = slots[index] as { deps: unknown[]; value: unknown } | undefined;
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) slots[index] = { deps, value: fn() };
    return (slots[index] as { value: unknown }).value;
  };
  const React = {
    createElement: (type: string, props: Record<string, unknown>, ...children: Node[]) => ({ type, props: props ?? {}, children }),
    useRef(value: unknown) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); },
    useState(value: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value; return [slots[index], (next: unknown) => { slots[index] = next; }]; },
    useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
    useEffect(fn: () => void, deps: unknown[]) { memo(() => { effects.push(fn); }, deps); },
  };
  const exports: { default?: (props: ParkingMapProps) => Node } = {};
  const source = ts.transpileModule(readFileSync("src/components/GoogleParkingMap.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(source, { exports, require(name: string) {
    if (name === "react") return { ...React, default: React, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "react-native") return { AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: (_name: string, callback: (value: boolean) => void) => { motionChanged = callback; return { remove() {} }; } }, StyleSheet: { create: (value: unknown) => value, absoluteFill: {} }, View: "View", Text: "Text" };
    if (name === "react-native-maps") return { __esModule: true, default: "MapView", Marker: "Marker", Polygon: "Polygon", Polyline: "Polyline", Circle: "Circle" };
    if (name.endsWith("basemap-style")) return { googleBasemapStyle };
    if (name.endsWith("zone-interaction")) return zoneInteraction;
    if (name.endsWith("map-selection-camera")) return selectionCamera;
    if (name.endsWith("clusters")) return { groupParking };
    if (name.endsWith("marker-appearance")) return { parkingMarker };
    if (name.endsWith("map-interactions")) return { createOverlayTapGate };
    if (name.endsWith("parking")) return { SKOPJE };
    throw new Error(name);
  } });
  const render = (props: ParkingMapProps, map: object) => {
    cursor = 0;
    const tree = exports.default!(props);
    (tree.props.ref as { current: object }).current = map;
    effects.splice(0).forEach(effect => effect());
    return tree;
  };
  return Object.assign(render, { motion: (value: boolean) => motionChanged?.(value) });
}
const base: ParkingMapProps = { now: Date.now(), places: [], selectedId: "a", selectedAnchor: SKOPJE, destination: SKOPJE, userLocation: null, picking: false, showZones: true, onSelect() {}, onPick() {}, language: "en" };

test("a rejected projection for the old Google selection cannot erase a newer popup", async () => {
  const render = renderer(), positions: unknown[] = [], pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  const map = { animateToRegion() {}, pointForCoordinate: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
  render({ ...base, onSelectedPosition: point => positions.push(point) }, map);
  render({ ...base, selectedId: "b", selectedAnchor: { ...SKOPJE, latitude: 42 }, onSelectedPosition: point => positions.push(point) }, map);
  pending[1].resolve({ x: 120, y: 250 }); await new Promise<void>(resolve => setImmediate(resolve));
  pending[0].reject(new Error("stale native request")); await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(positions, [{ x: 120, y: 250 }]);
});

test("a Google footprint tap picks its coordinate once while its paired map event is suppressed", () => {
  const picks: unknown[] = [], blanks: boolean[] = [];
  const place = { id: "p", name: "Parking", kind: "surface", coordinate: SKOPJE, geometry: { type: "Polygon", coordinates: [[[21.43, 41.99], [21.44, 41.99], [21.44, 42], [21.43, 41.99]]] }, access: "public", verification: "osm", zoneCode: null, operator: null, tariff: null, capacity: null, openingHours: null, source: { label: "OSM", url: "", retrievedAt: "" } } as ParkingMapProps["places"][number];
  const tree = renderer()({ ...base, places: [place], selectedId: "p", picking: true, selectionEnabled: false, onPick: point => picks.push(point), onBlankPress: () => blanks.push(true) }, { animateToRegion() {}, pointForCoordinate: async () => ({ x: 1, y: 1 }) });
  const find = (node: Node): Node | undefined => node.type === "Polygon" ? node : node.children.flat(Infinity).filter(Boolean).map(child => typeof child === "object" ? find(child as Node) : undefined).find(Boolean);
  const polygon = find(tree)!;
  const event = { nativeEvent: { coordinate: SKOPJE, action: "polygon-press" } };
  (polygon.props.onPress as (event: object) => void)(event);
  (tree.props.onPress as (event: object) => void)(event);
  assert.deepEqual(picks, [SKOPJE]); assert.equal(blanks.length, 0);
});

test("native camera waits for readiness, focuses the tapped anchor once, and respects reduced motion without zero-duration animation", async () => {
  const render = renderer(), animated: { target: object; duration: number }[] = [], immediate: object[] = [], positions: unknown[] = [];
  const map = { animateToRegion: (target: object, duration: number) => animated.push({ target, duration }), fitToCoordinates: (points: object[], options: { animated: boolean }) => { assert.equal(options.animated, false); immediate.push(points); }, pointForCoordinate: async () => ({ x: 120, y: 250 }) };
  let props = { ...base, selectedId: null, selectedAnchor: null, onSelectedPosition: (point: unknown) => positions.push(point) } as ParkingMapProps;
  let tree = render(props, map);
  assert.equal(immediate.length, 0); assert.equal(animated.length, 0);
  (tree.props.onMapReady as () => void)(); tree = render(props, map);
  assert.equal(immediate.length, 1, "initial framing is immediate after readiness");
  await new Promise<void>(resolve => setImmediate(resolve));
  props = { ...props, selectedId: "one", selectedAnchor: { latitude: 42.01, longitude: 21.44 } };
  tree = render(props, map);
  assert.equal(animated.length, 0); assert.equal(immediate.length, 2);
  assert.equal(positions.at(-1), null);
  render({ ...props, now: props.now + 30_000, userLocation: SKOPJE }, map);
  assert.equal(immediate.length, 2, "catalog clock and GPS cannot replay a camera command");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(positions.at(-1), { x: 120, y: 250 });
  render.motion(true);
  props = { ...props, selectedId: "two", selectedAnchor: { latitude: 42.02, longitude: 21.45 } };
  render(props, map);
  assert.equal(animated.length, 0); assert.equal(immediate.length, 3);
  render.motion(false);
  props = { ...props, selectedId: "three", selectedAnchor: { latitude: 42.03, longitude: 21.46 } };
  render(props, map); assert.equal(animated.length, 0); assert.equal(immediate.length, 4);
  props = { ...props, destination: { latitude: 42.1, longitude: 21.5 } };
  render(props, map); assert.equal(animated.length, 1);
  render({ ...props, drawing: true, picking: true }, map);
  assert.equal(immediate.length, 5, "entering drawing stops the flight without adding a new one");
});

test("native Near me applies the fixed close region repeatedly after a wider manual camera", async () => {
  const render = renderer(), targets: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }[] = [];
  const map = { animateToRegion: (target: typeof targets[number]) => targets.push(target), fitToCoordinates() {}, pointForCoordinate: async () => ({ x: 0, y: 0 }) };
  let props: ParkingMapProps = { ...base, selectedId: null, selectedAnchor: null };
  let tree = render(props, map);
  (tree.props.onMapReady as () => void)(); tree = render(props, map);
  await new Promise<void>(resolve => setImmediate(resolve));
  const fresh = { latitude: 42.015, longitude: 21.435 };
  props = { ...props, destination: fresh, cameraZoom: 18, cameraRevision: 1 };
  tree = render(props, map);
  assert.equal(targets.at(-1)?.latitude, fresh.latitude);
  assert.equal(targets.at(-1)?.longitude, fresh.longitude);
  assert.equal(targets.at(-1)?.latitudeDelta, 0.00275);
  assert.equal(targets.at(-1)?.longitudeDelta, 0.00275);
  (tree.props.onRegionChangeComplete as (region: object) => void)({ ...fresh, latitudeDelta: 0.08, longitudeDelta: 0.08 });
  render({ ...props, cameraRevision: 2 }, map);
  assert.equal(targets.length, 2);
  assert.equal(targets.at(-1)?.latitudeDelta, 0.00275);
  render({ ...props, cameraRevision: 2, now: props.now + 30_000 }, map);
  assert.equal(targets.length, 2, "routine catalog updates do not replay Near me");
});

test("POC native overlays stay tappable after zoom alongside pins and coordinate picking", () => {
  const selected: string[] = [], picked: object[] = [];
  const sector = { id: "poc:zone:1:0", name: "POC sector", kind: "zone", operator: "poc", zoneCode: "POC 1", coordinate: SKOPJE, geometry: { type: "Polygon", coordinates: [[[21.43, 41.99], [21.44, 41.99], [21.44, 42], [21.43, 41.99]]] }, access: "public", verification: "official", tariff: null, capacity: null, openingHours: null, source: { label: "POC", url: "", retrievedAt: "" } } as ParkingMapProps["places"][number];
  const facility = { ...sector, id: "actual-parking", kind: "surface" as const };
  const render = renderer(), map = { pointForCoordinate: async () => ({ x: 1, y: 1 }) };
  const props = { ...base, selectedId: sector.id, selectedAnchor: sector.coordinate, places: [sector, facility], onSelect: (place: typeof sector) => selected.push(place.id), onPick: (point: object) => picked.push(point) };
  let tree = render(props, map);
  const all = (node: Node): Node[] => [node, ...node.children.flat(Infinity).filter(value => value && typeof value === "object").flatMap(value => all(value as Node))];
  const oldPolygon = all(tree).find(node => node.type === "Polygon" && node.props.key === sector.id)!;
  assert.equal(oldPolygon.props.tappable, true);
  const region = { ...SKOPJE, latitudeDelta: .011, longitudeDelta: .011 };
  (tree.props.onRegionChange as (value: object) => void)(region);
  (oldPolygon.props.onPress as (value: object) => void)({ nativeEvent: { coordinate: SKOPJE } });
  assert.equal(selected.length, 1, "tiny tariff areas remain selectable during zoom");
  (tree.props.onRegionChangeComplete as (value: object) => void)(region); tree = render(props, map);
  assert.equal(all(tree).find(node => node.type === "Polygon" && node.props.key === sector.id)!.props.tappable, true);
  const pin = all(tree).find(node => node.type === "Marker" && node.props.key === facility.id)!;
  (pin.props.onPress as () => void)(); assert.deepEqual(selected, [sector.id, facility.id]);
  tree = render({ ...props, picking: true }, map);
  const polygon = all(tree).find(node => node.type === "Polygon" && node.props.key === sector.id)!;
  assert.equal(polygon.props.tappable, true);
  (polygon.props.onPress as (value: object) => void)({ nativeEvent: { coordinate: SKOPJE } });
  assert.deepEqual(picked, [SKOPJE]);
});
test("Google POC selection slightly narrows overview framing and preserves an already close map", () => {
  const sector = { id: "poc:zone:0:0", name: "POC", kind: "zone", operator: "poc", zoneCode: "POC 0", coordinate: SKOPJE, access: "public", verification: "official", tariff: null, capacity: null, openingHours: null, source: { label: "POC", url: "", retrievedAt: "" } } as ParkingMapProps["places"][number];
  const targets: { latitude: number; longitude: number }[][] = [];
  const render = renderer(), map = { fitToCoordinates: (points: { latitude: number; longitude: number }[]) => targets.push(points), pointForCoordinate: async () => ({ x: 1, y: 1 }) };
  const props = { ...base, selectedId: null, selectedAnchor: null, places: [sector] };
  let tree = render(props, map); (tree.props.onMapReady as () => void)(); tree = render(props, map);
  const selected = { ...props, selectedId: sector.id, selectedAnchor: { latitude: 42.01, longitude: 21.5 } };
  tree = render(selected, map);
  const point = targets.at(-1)!;
  assert.ok(Math.abs((point[1].latitude - point[0].latitude) - 0.022 / Math.SQRT2) < 1e-10);
  assert.ok(Math.abs((point[1].latitude + point[0].latitude) / 2 - 42.01) < 1e-10);
  const count = targets.length;
  render({ ...selected, places: [...selected.places], now: props.now + 30000 }, map);
  assert.equal(targets.length, count);
  const close = { ...SKOPJE, latitudeDelta: 0.004, longitudeDelta: 0.007 };
  (tree.props.onRegionChangeComplete as (value: object) => void)(close);
  render({ ...selected, selectedId: sector.id, selectedAnchor: { latitude: 42.02, longitude: 21.5 } }, map);
  const closer = targets.at(-1)!;
  assert.ok(Math.abs((closer[1].latitude - closer[0].latitude) - 0.004) < 1e-10);
});
