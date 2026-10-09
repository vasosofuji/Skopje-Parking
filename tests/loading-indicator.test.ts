import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = ts.transpileModule(readFileSync("src/components/LoadingIndicator.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
function loader(platform = "android") {
  const values: unknown[] = [], effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0, effectCursor = 0, started = 0, stopped = 0, removed = 0;
  let motion!: (value: boolean) => void, appState!: (value: string) => void, resolveMotion!: (value: boolean) => void;
  let pending: (() => void)[] = [];
  const configs: Record<string, unknown>[] = [];
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [values[index], (next: unknown) => { values[index] = next; }]; },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = effectCursor++, previous = effects[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
    },
  };
  const context = {
    exports: {} as { default: (props: { active?: boolean; label?: string }) => Element },
    require(name: string) {
      if (name === "react") return { ...react, default: react, __esModule: true };
      if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: { accentText: "#962E2B", paper: "#FAF3E5", muted: "#796B5D", mint: "#EDE2D0", line: "#DCD0BC" } }) };
      if (name === "react-native") return {
        View: "View", Text: "Text", Platform: { OS: platform }, StyleSheet: { create: (value: unknown) => value, absoluteFill: {} }, Easing: { linear: "linear" },
        AccessibilityInfo: { isReduceMotionEnabled: () => new Promise<boolean>(resolve => { resolveMotion = resolve; }), addEventListener: (_name: string, listener: typeof motion) => { motion = listener; return { remove: () => { removed++; } }; } },
        AppState: { currentState: "active", addEventListener: (_name: string, listener: typeof appState) => { appState = listener; return { remove: () => { removed++; } }; } },
        Animated: { View: "AnimatedView", Value: class { setValue() {} stopAnimation() {} interpolate() { return "rotation"; } }, timing: (_value: unknown, config: Record<string, unknown>) => { configs.push(config); return {}; }, loop: () => ({ start: () => { started++; }, stop: () => { stopped++; } }) },
      };
      throw new Error(`Unexpected loading dependency: ${name}`);
    },
  };
  vm.runInNewContext(source, context);
  return {
    render(props: { active?: boolean; label?: string } = {}) { cursor = 0; effectCursor = 0; const tree = context.exports.default(props); const queued = pending; pending = []; queued.forEach(effect => effect()); return tree; },
    motion: (value: boolean) => motion(value), app: (value: string) => appState(value), resolve: (value: boolean) => resolveMotion(value),
    stats: () => ({ started, stopped, removed }), configs,
    unmount: () => effects.forEach(effect => effect.cleanup?.()),
  };
}
test("branded loading animation respects Reduce Motion, inactivity and unmount cleanup", async () => {
  const indicator = loader();
  const tree = indicator.render({ label: "Reading the sign" });
  assert.equal(tree.props.accessibilityRole, "progressbar"); assert.equal(tree.props.accessibilityLabel, "Reading the sign");
  assert.equal(indicator.stats().started, 0, "stay still until the accessibility setting is known");
  indicator.resolve(false); await flush(); indicator.render();
  assert.equal(indicator.stats().started, 1);
  assert.equal(indicator.configs[0].useNativeDriver, true); assert.equal(indicator.configs[0].isInteraction, false);
  indicator.motion(true); indicator.render(); assert.equal(indicator.stats().stopped, 1);
  indicator.app("background"); indicator.motion(false); indicator.render(); assert.equal(indicator.stats().started, 1);
  indicator.app("active"); indicator.render(); assert.equal(indicator.stats().started, 2);
  indicator.render({ active: false }); assert.equal(indicator.stats().stopped, 2);
  indicator.unmount(); assert.equal(indicator.stats().removed, 2);
});
test("late accessibility hydration never overrides a newer reduced-motion event", async () => {
  const indicator = loader(); indicator.render();
  indicator.motion(true); indicator.resolve(false); await flush(); indicator.render();
  assert.equal(indicator.stats().started, 0);
  indicator.unmount();
});
test("web loading uses the supported JS driver and hidden loaders remain static", async () => {
  const indicator = loader("web"); indicator.render({ active: false });
  indicator.resolve(false); await flush(); indicator.render({ active: false }); assert.equal(indicator.stats().started, 0);
  indicator.render({ active: true }); assert.equal(indicator.configs[0].useNativeDriver, false);
  indicator.unmount(); assert.equal(indicator.stats().stopped, 1);
});
