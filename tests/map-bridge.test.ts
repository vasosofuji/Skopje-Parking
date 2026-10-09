import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mapHtml } from "../src/components/offlineMapHtml";

type Callback = (value?: unknown) => void;
function bridge(reducedMotion = false) {
  const messages: { type: string; sentAt: number; selectionId?: string; anchor?: number[]; point?: unknown }[] = [];
  const mapEvents = new Map<string, Callback>(), windowEvents = new Map<string, Callback>();
  const markers: { options: Record<string, unknown>; events: Map<string, Callback> }[] = [];
  const polygons: { options: Record<string, unknown>; events: Map<string, Callback> }[] = [];
  const panes = new Map<string, { style: { zIndex: string } }>();
  const invalidations: unknown[] = [];
  const transitions: { kind: string; point: number[]; zoom: number; options?: Record<string, unknown> }[] = [];
  let center = [42, 21], zoom = 15, stops = 0;
  let flight: { point: number[]; zoom: number } | null = null;
  let motionChanged: ((event: { matches: boolean }) => void) | undefined;
  const motion = { matches: reducedMotion, addEventListener(_event: string, callback: typeof motionChanged) { motionChanged = callback; } };
  let userDots = 0, moves = 0, clears = 0, doubleClickZoomEnabled = true;
  const doubleClickZoom = {
    enable() { doubleClickZoomEnabled = true; },
    disable() { doubleClickZoomEnabled = false; },
    enabled: () => doubleClickZoomEnabled,
  };
  const layer = () => {
    const events = new Map<string, Callback>();
    return { events, on(name: string, fn: Callback) { events.set(name, fn); return this; }, off() {}, addTo() { return this; }, remove() {}, bringToFront() {}, setLatLng() { moves++; return this; }, setRadius() { return this; }, setLatLngs() {}, bindTooltip() { return this; } };
  };
  const map = {
    createPane(name: string) { const pane = { style: { zIndex: "" } }; panes.set(name, pane); return pane; },
    doubleClickZoom, on(name: string, fn: Callback) { mapEvents.set(name, fn); return this; },
    stop() { stops++; const moving = Boolean(flight); flight = null; if (moving) mapEvents.get("moveend")?.(); return this; },
    setView(point: number[], nextZoom: number, options?: Record<string, unknown>) { transitions.push({ kind: "setView", point, zoom: nextZoom, options }); mapEvents.get("movestart")?.(); center = point; zoom = nextZoom; mapEvents.get("moveend")?.(); return this; },
    flyTo(point: number[], nextZoom: number, options?: Record<string, unknown>) { transitions.push({ kind: "flyTo", point, zoom: nextZoom, options }); flight = { point, zoom: nextZoom }; mapEvents.get("movestart")?.(); return this; },
    getZoom: () => zoom, getCenter: () => ({ lat: center[0], lng: center[1] }), latLngToContainerPoint: (p: number[]) => ({ x: p[1] * 10, y: p[0] * 10 }), invalidateSize(options: unknown) { invalidations.push(options); }, getBounds: () => ({ intersects: () => true }),
  };
  const window = { matchMedia: () => motion, ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) }, addEventListener: (name: string, fn: Callback) => windowEvents.set(name, fn) } as unknown as { renderParking: (next: object) => void; updateUserLocation: (point: number[] | null, accuracy: number | null) => void };
  const L = {
    map: () => map, tileLayer: layer, layerGroup: () => ({ ...layer(), getLayers: () => [], removeLayer() {}, clearLayers() { clears++; } }),
    marker: (_point: unknown, options: Record<string, unknown>) => { const next = layer(); markers.push({ options, events: next.events }); return next; },
    polygon: (_rings: unknown, options: Record<string, unknown>) => { const next = layer(); polygons.push({ options, events: next.events }); return next; }, polyline: layer, circle: layer, circleMarker: () => { userDots++; return layer(); }, divIcon: (value: unknown) => value, latLngBounds: () => ({}), DomEvent: { stopPropagation() {} },
  };
  const document = { getElementById: () => ({ classList: { toggle() {} } }), createElement: () => ({ textContent: "", style: { cssText: "" } }) };
  const script = mapHtml.split("</script><script>")[1].split("</script>")[0];
  vm.runInNewContext(script, { window, document, L });
  return { window, messages, markers, polygons, panes, mapEvents, windowEvents, invalidations, doubleClickZoom, transitions,
    setZoom(value: number) { zoom = value; mapEvents.get("zoomend")?.(); },
    finishFlight() { assert.ok(flight); center = flight.point; zoom = flight.zoom; flight = null; mapEvents.get("moveend")?.(); },
    motion(value: boolean) { motion.matches = value; motionChanged?.({ matches: value }); },
    counts: () => ({ userDots, moves, clears, stops, flying: Boolean(flight) }) };
}
const payload = { pins: [{ id: "one", point: [42, 21], title: "Parking", html: "<span>?</span>", selected: true }], zones: [], destination: [42, 21], selectedId: "one", selectedAnchor: [42, 21], picking: false, draft: [] };

test("the native Leaflet bridge tags projections and avoids automatic marker focus or resize panning", () => {
  const view = bridge();
  view.window.renderParking(payload);
  assert.equal(view.markers[0].options.autoPanOnFocus, false);
  assert.deepEqual(view.invalidations, []);
  const first = view.messages.at(-1)!;
  assert.equal(first.selectionId, "one"); assert.deepEqual(first.anchor, [42, 21]);
  view.window.renderParking({ ...payload, selectedId: "two", selectedAnchor: [42.01, 21.01] });
  assert.equal(view.messages.at(-1)?.selectionId, "two");
  assert.deepEqual(view.messages.at(-1)?.anchor, [42.01, 21.01]);
  view.windowEvents.get("resize")?.();
  assert.equal((view.invalidations[0] as { pan: boolean }).pan, false);
});

test("blank taps and boundary picks stay separate; one-second GPS updates move the dot without rebuilding parking", () => {
  const view = bridge();
  view.window.renderParking(payload);
  view.mapEvents.get("click")?.({ latlng: { lat: 42, lng: 21 } });
  assert.equal(view.messages.at(-1)?.type, "blank");
  view.window.renderParking({ ...payload, picking: true });
  view.mapEvents.get("click")?.({ latlng: { lat: 42, lng: 21 } });
  assert.equal(view.messages.at(-1)?.type, "pick");
  const clears = view.counts().clears;
  view.window.updateUserLocation([42, 21], 10);
  for (let i = 1; i < 10; i++) view.window.updateUserLocation([42 + i / 10000, 21], 10);
  assert.equal(view.counts().userDots, 1);
  assert.equal(view.counts().clears, clears);
  assert.equal(view.counts().moves, 18);
});

test("cluster and destination taps send explicit interaction events, while programmatic camera updates do not", () => {
  const view = bridge();
  view.window.renderParking({ ...payload, pins: [{ ...payload.pins[0], cluster: true }], destinationMarker: [42, 21] });
  assert.ok(!view.messages.some(message => message.type === "interaction"));
  view.markers[0].events.get("click")?.();
  assert.equal(view.messages.filter(message => message.type === "interaction").length, 1);
  assert.ok(view.messages.findIndex(message => message.type === "pan") < view.messages.findIndex(message => message.type === "interaction"), "cluster intent precedes native keyboard gating");
  assert.ok(Number.isFinite(view.messages.at(-1)?.sentAt));
  view.markers[1].events.get("click")?.();
  assert.equal(view.messages.filter(message => message.type === "interaction").length, 2);
});

test("pin selection projects immediately while destination flights remain animated", () => {
  const view = bridge();
  view.window.renderParking({ ...payload, selectedId: null, selectedAnchor: null });
  view.window.renderParking(payload);
  assert.equal(view.transitions.at(-1)?.kind, "setView");
  assert.equal(view.transitions.at(-1)?.zoom, 16);
  assert.notEqual(view.messages.at(-1)?.point, null);
  const count = view.transitions.length;
  view.window.renderParking({ ...payload, dark: true }); view.window.updateUserLocation([42, 21], 5);
  assert.equal(view.transitions.length, count);
  view.window.renderParking({ ...payload, selectedId: "two", selectedAnchor: [42.01, 21.01] });
  assert.equal(view.transitions.length, count + 1);
  assert.equal(view.messages.at(-1)?.selectionId, "two");
  assert.notEqual(view.messages.at(-1)?.point, null);
  view.window.renderParking({ ...payload, selectedId: null, selectedAnchor: null, destination: [42.02, 21.02] });
  assert.equal(view.transitions.at(-1)?.kind, "flyTo");
  assert.equal(view.transitions.at(-1)?.zoom, 15);
});
test("POC bridge selection centers with a slight zoom and does not replay on refresh or zoom closer", () => {
  const view = bridge();
  view.window.renderParking({ ...payload, selectedId: null, selectedAnchor: null });
  const selected = { ...payload, selectedId: "poc:zone:0:0", selectedPocSector: true, selectedAnchor: [42.01, 21.01] };
  view.window.renderParking(selected);
  assert.equal(view.transitions.at(-1)?.zoom, 15.5);
  assert.deepEqual(view.transitions.at(-1)?.point, selected.selectedAnchor);
  const count = view.transitions.length;
  view.window.renderParking({ ...selected, dark: true });
  assert.equal(view.transitions.length, count);
  view.window.renderParking({ ...selected, selectedId: "poc:zone:1:0" });
  assert.equal(view.transitions.at(-1)?.zoom, 16);
  view.window.renderParking({ ...selected, selectedId: "poc:zone:2:0" });
  assert.equal(view.transitions.at(-1)?.zoom, 16);
  view.setZoom(18);
  view.window.renderParking({ ...selected, selectedId: "poc:zone:0:1" });
  assert.equal(view.transitions.at(-1)?.zoom, 18);
});

test("Near me bridge uses absolute street zoom on every request and restores it after manual zoom", () => {
  const view = bridge();
  const nearby = { ...payload, selectedId: null, selectedAnchor: null, destination: [42.015, 21.435], cameraZoom: 18, cameraRevision: 1 };
  view.window.renderParking(nearby);
  assert.equal(view.transitions.at(-1)?.zoom, 18);
  assert.deepEqual(view.transitions.at(-1)?.point, nearby.destination);
  view.setZoom(12);
  view.window.renderParking({ ...nearby, cameraRevision: 2 });
  assert.equal(view.transitions.at(-1)?.zoom, 18);
  view.finishFlight();
  view.setZoom(19);
  view.window.renderParking({ ...nearby, cameraRevision: 3 });
  assert.equal(view.transitions.at(-1)?.zoom, 18);
  const count = view.transitions.length;
  view.window.renderParking({ ...nearby, cameraRevision: 3, dark: true });
  view.window.updateUserLocation([42.016, 21.436], 5);
  assert.equal(view.transitions.length, count, "routine GPS and appearance updates do not repeat the close-up");
});

test("reduced motion uses immediate camera movement and entering drawing cancels a pending flight", () => {
  const view = bridge();
  view.window.renderParking({ ...payload, selectedId: null, selectedAnchor: null });
  view.window.renderParking({ ...payload, destination: [42.02, 21.02] }); assert.equal(view.counts().flying, true);
  view.window.renderParking({ ...payload, drawing: true, picking: true });
  assert.equal(view.counts().flying, false); assert.equal(view.doubleClickZoom.enabled(), false);
  const count = view.transitions.length;
  view.window.renderParking({ ...payload, drawing: true, picking: true, selectedAnchor: [42.01, 21.01] });
  assert.equal(view.transitions.length, count);
  view.motion(true);
  view.window.renderParking({ ...payload, selectedId: "new", selectedAnchor: [42.03, 21.03] });
  assert.equal(view.transitions.at(-1)?.kind, "setView");
  assert.equal(view.transitions.at(-1)?.options?.animate, false);
  assert.notEqual(view.messages.at(-1)?.point, null);
});

test("boundary drawing disables double-click zoom across corner updates and restores it when finished", () => {
  const view = bridge();
  view.window.renderParking(payload);
  assert.equal(view.doubleClickZoom.enabled(), true);
  view.window.renderParking({ ...payload, drawing: true, picking: true });
  assert.equal(view.doubleClickZoom.enabled(), false);
  const corners = [[42, 21], [42, 21.001], [42.001, 21.001], [42.001, 21]];
  corners.forEach((point, index) => {
    view.mapEvents.get("click")?.({ latlng: { lat: point[0], lng: point[1] } });
    assert.equal(view.messages.at(-1)?.type, "pick", "rapid corner clicks still dispatch picks");
    view.window.renderParking({ ...payload, drawing: true, picking: true, draft: corners.slice(0, index + 1) });
    assert.equal(view.doubleClickZoom.enabled(), false);
  });
  view.window.renderParking({ ...payload, drawing: false, picking: false });
  assert.equal(view.doubleClickZoom.enabled(), true);
  view.mapEvents.get("click")?.({ latlng: { lat: 42, lng: 21 } });
  assert.equal(view.messages.at(-1)?.type, "blank");
});

test("native map reuses unchanged marker instances while current interaction flags and appearance still update", () => {
  const view = bridge();
  view.window.renderParking(payload);
  const first = view.markers[0], count = view.markers.length;
  view.window.renderParking({ ...payload, pins: payload.pins.map(pin => ({ ...pin })), selectionEnabled: false });
  assert.equal(view.markers.length, count, "catalog refresh does not replace identical pins");
  const before = view.messages.filter(message => message.type === "select").length;
  first.events.get("click")?.();
  assert.equal(view.messages.filter(message => message.type === "select").length, before, "cached handler reads current selection gate");
  view.window.renderParking({ ...payload, pins: [{ ...payload.pins[0], html: "<span>Full</span>" }] });
  assert.equal(view.markers.length, count + 1, "report expiry/appearance changes replace only that marker");
});

test("POC bridge boundaries and 44px labels stay tappable at street zoom", () => {
  const view = bridge();
  const sector = { id: "poc:zone:1:0", pocSector: true, rings: [[[42, 21], [42, 21.1], [42.1, 21]]], point: [42, 21], title: "POC", label: "POC 1" };
  const next = { ...payload, selectedId: null, selectedAnchor: null, zones: [sector], zoneLabels: [sector] };
  view.window.renderParking(next);
  const oldPolygon = view.polygons[0], oldLabel = view.markers.find(marker => marker.options.title === "POC")!;
  assert.equal(oldPolygon.options.interactive, true);
  view.setZoom(16);
  oldPolygon.events.get("click")?.({ latlng: { lat: 42, lng: 21 } }); oldLabel.events.get("click")?.();
  assert.equal(view.messages.filter(message => message.type === "select").length, 2, "tiny tariff areas remain selectable at street zoom");
  view.window.renderParking(next);
  assert.equal(view.polygons.at(-1)!.options.interactive, true);
  assert.equal(view.markers.filter(marker => marker.options.title === "POC").at(-1)!.options.interactive, true);
  view.markers.find(marker => marker.options.title === "Parking")!.events.get("click")?.();
  assert.equal(view.messages.filter(message => message.type === "select").length, 3, "actual parking pins still work");
  view.window.renderParking({ ...next, picking: true });
  assert.equal(view.polygons.at(-1)!.options.interactive, true);
  view.polygons.at(-1)!.events.get("click")?.({ latlng: { lat: 42, lng: 21 } });
  assert.equal(view.messages.at(-1)!.type, "pick");
});


test("tariff region redraws cannot cover parking footprint tap targets", () => {
  const view = bridge();
  const area = { id: "parking", rings: [[[42,21],[42,21.1],[42.1,21]]] };
  const zone = { ...area, id: "tariff", pocSector: true };
  const next = { ...payload, footprints: [area], zones: [zone] };
  view.window.renderParking(next);
  view.window.renderParking({ ...next, zones: [{ ...zone, rings: [[[42,21],[42,21.2],[42.2,21]]] }] });
  const footprint = view.polygons[0], tariffs = view.polygons.slice(1);
  assert.equal(footprint.options.pane, undefined, "footprints retain Leaflet's default overlay pane at z-index400");
  assert.ok(tariffs.every(polygon => polygon.options.pane === "tariff-regions"));
  assert.equal(view.panes.get("tariff-regions")?.style.zIndex, "390", "tariffs remain below footprints regardless of redraw order");
});
