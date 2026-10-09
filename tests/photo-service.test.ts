import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/services/photos.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function picker(options: { platform?: string; denied?: boolean; canceled?: boolean; empty?: boolean; renderError?: boolean; saveError?: boolean; oversized?: boolean; portrait?: boolean } = {}) {
  const calls: string[] = [];
  let resize: unknown;
  let captureOptions: unknown;
  const native = {
    requestCameraPermissionsAsync: async () => { calls.push("permission"); return { granted: !options.denied, canAskAgain: false }; },
    launchCameraAsync: async (value: unknown) => { calls.push("camera"); captureOptions = value; return result(); },
    launchImageLibraryAsync: async (value: unknown) => { calls.push("gallery"); captureOptions = value; return result(); },
  };
  function result() {
    return { canceled: Boolean(options.canceled), assets: options.empty ? [] : [{ uri: "file:///chosen.jpg", width: options.portrait ? 2400 : 4000, height: options.portrait ? 4000 : 2400 }] };
  }
  const context = {
    exports: {} as { chooseSignPhoto: (camera?: boolean) => Promise<{ uri: string; base64: string; mimeType: string } | null> },
    require(name: string) {
      if (name === "expo-image-picker") return native;
      if (name === "react-native") return { Platform: { OS: options.platform ?? "android" } };
      if (name === "expo-image-manipulator") return {
        SaveFormat: { JPEG: "jpeg" },
        ImageManipulator: { manipulate() {
          calls.push("manipulate");
          return {
            resize(value: unknown) { resize = value; },
            async renderAsync() {
              if (options.renderError) throw new Error("render failed");
              return {
                async saveAsync() {
                  if (options.saveError) throw new Error("save failed");
                  return { uri: "file:///safe.jpg", base64: options.oversized ? "a".repeat(2796201) : "safe-jpeg" };
                },
                release() { calls.push("release image"); },
              };
            },
            release() { calls.push("release context"); },
          };
        } },
      };
      throw new Error(`Photo capture must not need network or account modules: ${name}`);
    },
  };
  vm.runInNewContext(source, context);
  return { choose: context.exports.chooseSignPhoto, calls, resize: () => resize, captureOptions: () => captureOptions };
}

test("gallery cancellation returns without camera permission or image processing", async () => {
  const native = picker({ canceled: true });
  assert.equal(await native.choose(false), null);
  assert.deepEqual(native.calls, ["gallery"]);
});

test("camera denial stops before launch and exposes the blocked permission state", async () => {
  const native = picker({ denied: true });
  await assert.rejects(native.choose(true), (error: { name?: string; blocked?: boolean }) => error.name === "PhotoPermissionError" && error.blocked === true);
  assert.deepEqual(native.calls, ["permission"]);
});

test("local capture produces a resized JPEG and releases both native resources", async () => {
  for (const portrait of [false, true]) {
    const native = picker({ portrait });
    const photo = await native.choose(true);
    assert.equal(photo?.mimeType, "image/jpeg");
    assert.equal(photo?.base64, "safe-jpeg");
    assert.equal(JSON.stringify(native.resize()), JSON.stringify(portrait ? { height: 1600 } : { width: 1600 }));
    assert.equal(JSON.stringify(native.captureOptions()), JSON.stringify({ mediaTypes: ["images"], quality: 1, exif: false }));
    assert.deepEqual(native.calls, ["permission", "camera", "manipulate", "release image", "release context"]);
  }
});

test("rendering and saving failures release every created native resource", async () => {
  const render = picker({ renderError: true });
  await assert.rejects(render.choose(), /render failed/);
  assert.deepEqual(render.calls, ["gallery", "manipulate", "release context"]);
  const save = picker({ saveError: true });
  await assert.rejects(save.choose(), /save failed/);
  assert.deepEqual(save.calls, ["gallery", "manipulate", "release image", "release context"]);
});

test("empty results and oversized JPEGs fail safely", async () => {
  const empty = picker({ empty: true });
  await assert.rejects(empty.choose(), /No photo/);
  assert.deepEqual(empty.calls, ["gallery"]);
  const large = picker({ oversized: true });
  await assert.rejects(large.choose(), /smaller/);
  assert.deepEqual(large.calls, ["gallery", "manipulate", "release image", "release context"]);
});

test("web launch remains in the user action without an asynchronous permission request", async () => {
  const native = picker({ platform: "web", canceled: true });
  await native.choose(true);
  assert.deepEqual(native.calls, ["camera"]);
});

test("sign-photo controls remain usable when the catalog is offline", () => {
  type Element = { type: unknown; props: Record<string, any>; children: Element[] };
  const PhotoPicker = () => null;
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, ...children: Element[]): Element => ({ type, props, children }),
    useState: (value: unknown) => [value, () => {}],
    useEffect: () => {},
  };
  const component = ts.transpileModule(readFileSync("src/components/SignScanner.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const context = {
    exports: {} as { default: (props: { placeId: string; onReview: () => void }) => Element },
    require(name: string) {
      if (name === "react") return { ...react, default: react, __esModule: true };
      if (name === "react-native") return { View: "View" };
      if (name === "../services/signScan") return { scanSign: async () => { throw new Error("unused"); }, discardSignPhoto: async () => {} };
      if (name === "../services/signReader") return { useSignReader: () => null };
      if (name === "../services/signOcr") return { signOcrAvailable: false };
      if (name === "../state/ParkingContext") return { useParking: () => ({ connected: false, t: (en: string) => en, catalog: { places: [] } }) };
      if (name === "./ui") return { Button: "Button", Note: "Note" };
      if (name === "./PhotoPicker") return { default: PhotoPicker, __esModule: true };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(component, context);
  const tree = context.exports.default({ placeId: "parking-test", onReview() {} });
  const control = tree.children.find(child => child?.type === PhotoPicker);
  assert.ok(control);
  assert.equal(control.props.disabled, false);
});

test("a sign that cannot be read followed by manual entry updates the same saved parking", async () => {
  type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
  const values: unknown[] = [], savedPlace = { id: "photo-created", coordinate: { latitude: 42, longitude: 21.43 }, kind: "surface", zoneCode: null, capacity: null };
  let cursor = 0, created = 0;
  const react = {
    Fragment: "Fragment",
    createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [values[index], (next: unknown) => { values[index] = next; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
  };
  const component = ts.transpileModule(readFileSync("src/components/ProposalSheet.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const context = { exports: {} as { default: (props: Record<string, unknown>) => Element }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "react-native") return { Platform: { OS: "android" }, Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: (value: unknown) => value } };
    if (name === "expo-crypto") return { randomUUID: () => "photo-request" };
    if (name === "./ui") return { Button: "Button", Icon: "Icon", Note: "Note", Sheet: "Sheet" };
    if (name.startsWith("./")) return { default: name.slice(2), __esModule: true };
    if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en, refresh: async () => {}, catalog: { places: [] } }) };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: {} }) };
    if (name === "../services/api") return { api: { contribute: async () => { created++; return savedPlace; } } };
    if (name === "../services/signScan") return { scanSign: async () => { throw new Error("unreadable"); }, discardSignPhoto: async () => {} };
    throw new Error(`Unexpected proposal dependency: ${name}`);
  } };
  vm.runInNewContext(component, context);
  const props = { coordinate: savedPlace.coordinate, onClose() {}, onSubmitted() {} };
  const render = () => { cursor = 0; return context.exports.default(props); };
  function nodes(tree: unknown): Element[] { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!tree || typeof tree !== "object" || !("children" in tree)) return []; const node = tree as Element; return [node, ...node.children.flatMap(nodes), ...nodes(node.props.footer)]; }
  const find = (tree: Element, predicate: (node: Element) => boolean) => { const node = nodes(tree).find(predicate); assert.ok(node); return node; };
  let tree = render(); find(tree, node => node.props.accessibilityLabel === "Photograph a sign").props.onPress();
  tree = render(); find(tree, node => node.type === "PhotoPicker").props.onChange({ uri: "file:///test.jpg", base64: "jpeg", mimeType: "image/jpeg" });
  tree = render(); find(tree, node => node.props.title === "Read sign & review").props.onContinue();
  await new Promise<void>(resolve => setImmediate(resolve)); tree = render();
  assert.equal(created, 1);
  find(tree, node => node.type === "Sheet").props.onBack(); tree = render();
  find(tree, node => node.props.accessibilityLabel === "Enter manually").props.onPress(); tree = render();
  const manual = find(tree, node => node.type === "ManualParkingWizard");
  assert.equal(manual.props.place.id, "photo-created"); assert.equal(manual.props.existingPlaceId, "photo-created");
  assert.equal(manual.props.coordinate, savedPlace.coordinate); assert.equal(manual.props.kind, "surface");
  // The draft stays keyed to the added location, so creating the place mid-entry (e.g. after
  // drawing the perimeter) cannot remount the wizard and drop unsaved detailed fields.
  assert.equal(manual.props.entryKey, `surface:${savedPlace.coordinate.latitude.toFixed(6)}:${savedPlace.coordinate.longitude.toFixed(6)}`);
});
