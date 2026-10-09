import test from "node:test";
import * as languageModule from "../src/domain/language";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
type Node = { type: string; props: Record<string, any>; children: Node[] };

test("drawer keeps its animated transform attached across collapse and catalog measurement updates", () => {
  let cursor = 0;
  const slots: any[] = [], effects: (() => void)[] = [], springs: { value: Value; config: any }[] = [];
  class Value {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value; }
    stopAnimation(callback?: (value: number) => void) { callback?.(this.value); }
  }
  const memo = (create: () => any, deps: any[]) => {
    const index = cursor++, old = slots[index];
    if (!old || deps.some((dep, i) => dep !== old.deps[i])) slots[index] = { deps, value: create() };
    return slots[index].value;
  };
  const react = {
    createElement: (type: string, props: any, ...children: Node[]) => ({ type, props: props ?? {}, children }),
    useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial: any) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useMemo: memo,
    useCallback: (fn: () => void, deps: any[]) => memo(() => fn, deps),
    useEffect(effect: () => void, deps: any[]) { memo(() => effects.push(effect), deps); },
  };
  const exports = {} as { default: (props: any) => Node };
  const source = ts.transpileModule(readFileSync("src/components/MapDrawer.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(source, { exports, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "react-native") return { View: "View", ScrollView: "ScrollView", Platform: { OS: "web" }, useWindowDimensions: () => ({ height: 844 }), StyleSheet: { create: (styles: any) => styles }, Animated: { View: "AnimatedView", Value, subtract: (a: Value, b: Value) => ({ a, b }), spring: (value: Value, config: any) => ({ start: () => springs.push({ value, config }) }) } };
    if (name.endsWith("ThemeContext")) return { useTheme: () => ({ colors: {} }) };
    if (name.endsWith("ParkingContext")) return { useParking: () => ({ t: (en: string) => en }) };
    if (name === "./DrawerHandle") return { __esModule: true, default: "DrawerHandle" };
    if (name === "./ui") return { Button: "Button" };
    throw new Error(name);
  } });
  let expandRequest = 0;
  const render = () => { cursor = 0; const tree = exports.default({ expandRequest, onHeightChange() {}, onAdd() {}, onDraw() {}, onDestination() {} }); effects.splice(0).forEach(effect => effect()); return tree; };
  const drawer = (tree: Node) => tree.children[0];
  const graph = (tree: Node) => drawer(tree).props.style[1].transform[0].translateY as { a: Value; b: Value };
  const finishSpring = () => { const spring = springs.at(-1)!; assert.equal(spring.config.useNativeDriver, false); spring.value.setValue(spring.config.toValue); };
  let tree = render(); const initialGraph = graph(tree);
  assert.equal(tree.props.nativeID, "parking-drawer-frame");
  assert.match(readFileSync("src/components/global.css", "utf8"), /#parking-drawer-frame\s*\{\s*overflow:\s*clip\s*!important;/);
  expandRequest++; tree = render(); finishSpring(); tree = render();
  assert.equal(drawer(tree).children[0].props.label, "Hide menu");
  drawer(tree).children[0].props.onToggle(); tree = render();
  // A live catalog update changes content size while the collapse spring runs.
  drawer(tree).children[2].props.onContentSizeChange(390, 650); tree = render();
  assert.equal(graph(tree), initialGraph);
  finishSpring(); tree = render();
  assert.equal(graph(tree).a.value - graph(tree).b.value, 470 - 32);
  drawer(tree).children[0].props.onToggle(); tree = render(); finishSpring(); tree = render();
  assert.equal(drawer(tree).children[0].props.label, "Expand menu");
  assert.equal(graph(tree).a.value - graph(tree).b.value, 470 - 94);
  assert.equal(drawer(tree).children[2].props.pointerEvents, "none");
});

test("web drawer handle holds without starting a drag and cancels only a real drag", () => {
  const refs: any[] = []; let cursor = 0, starts = 0, ends = 0, toggles = 0, clock = 1000;
  const react = { createElement: (type: string, props: any) => ({ type, props }), useRef(value: any) { const index = cursor++; return refs[index] ?? (refs[index] = { current: value }); } };
  const exports = {} as { default: (props: any) => Node };
  const source = ts.transpileModule(readFileSync("src/components/DrawerHandle.web.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(source, { exports, Date: { now: () => clock }, require: () => ({ ...react, default: react, __esModule: true }) });
  const tree = exports.default({ onStart: () => starts++, onEnd: () => ends++, onDrag() {}, onToggle: () => toggles++ });
  const event = (y: number) => ({ clientY: y, pointerId: 1, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} } });
  tree.props.onPointerDown(event(100)); assert.equal(starts, 0);
  tree.props.onPointerMove(event(101)); assert.equal(starts, 0);
  tree.props.onPointerUp(event(101)); assert.equal(ends, 0);
  tree.props.onClick(); assert.equal(toggles, 1);
  tree.props.onPointerDown(event(100)); clock += 500;
  tree.props.onPointerUp(event(100)); tree.props.onClick();
  assert.equal(toggles, 1, "long hold must not synthesize an expansion click");
  assert.equal(starts, 0); assert.equal(ends, 0);
  tree.props.onClick(); assert.equal(toggles, 2, "keyboard click remains available");
  tree.props.onPointerDown(event(100)); tree.props.onPointerMove(event(90)); assert.equal(starts, 1);
  tree.props.onPointerCancel(); assert.equal(ends, 1);
  tree.props.onClick(); assert.equal(toggles, 2);
});

test("native drawer long hold stays closed while a new short press still opens", () => {
  let toggles = 0;
  const react = { createElement: (type: string, props: any, ...children: Node[]) => ({ type, props, children }), useRef: (value: any) => ({ current: value }), useMemo: (fn: () => any) => fn() };
  const exports = {} as { default: (props: any) => Node };
  const source = ts.transpileModule(readFileSync("src/components/DrawerHandle.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(source, { exports, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    return { View: "View", Pressable: "Pressable", PanResponder: { create: () => ({ panHandlers: {} }) } };
  } });
  const tree = exports.default({ onToggle: () => toggles++ });
  const press = tree.children[0].props;
  assert.equal(press.delayLongPress, 400);
  press.onPressIn(); press.onLongPress(); press.onPress(); assert.equal(toggles, 0);
  press.onPressIn(); press.onPress(); assert.equal(toggles, 1);
});
