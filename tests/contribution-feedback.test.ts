import test from "node:test";
import * as languageModule from "../src/domain/language";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown>; children: Element[] };
type Feedback = { visible: boolean; thankYou: () => void; dismiss: () => void };
function fixture() {
  const slots: unknown[] = [], timers = new Map<number, () => void>();
  let index = 0, timerId = 0, cleanup: (() => void) | undefined;
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, ...children: Element[]): Element => ({ type, props: props ?? {}, children }),
    createContext: () => ({ Provider: "Provider" }),
    useContext: () => null,
    useState(initial: unknown) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], (next: unknown) => { slots[slot] = next; }]; },
    useRef(initial: unknown) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useCallback: (callback: unknown) => callback,
    useMemo: (callback: () => unknown) => callback(),
    useEffect: (callback: () => (() => void)) => { cleanup = callback(); },
  };
  const context = {
    exports: {} as { ContributionFeedbackProvider: (props: { children: null }) => Element },
    setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 3200); timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    require(name: string) {
      if (name === "react") return { ...react, default: react, __esModule: true };
      if (name === "../domain/language") return languageModule;
      if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
      if (name === "react-native") return { View: "View", Pressable: "Pressable", Text: "Text" };
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0 }) };
      if (name === "./ParkingContext") return { useParking: () => ({ t: (en: string) => en }) };
      if (name === "./ThemeContext") return { useTheme: () => ({ colors: { green: "green" } }) };
      throw new Error(name);
    },
  };
  const source = ts.transpileModule(readFileSync("src/state/ContributionFeedback.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(source, context);
  const render = () => { index = 0; return context.exports.ContributionFeedbackProvider({ children: null }).props.value as Feedback; };
  return { render, timers, unmount: () => cleanup?.() };
}

test("thank-you stays short, repeated submissions restart its timer, and dismiss clears it", () => {
  const view = fixture();
  assert.equal(view.render().visible, false);
  view.render().thankYou();
  assert.equal(view.render().visible, true); assert.equal(view.timers.size, 1);
  view.render().thankYou();
  assert.equal(view.timers.size, 1, "only one dismissal timer survives repeat contributions");
  view.render().dismiss();
  assert.equal(view.render().visible, false); assert.equal(view.timers.size, 0);
});

test("thank-you expires automatically and its timer is cleared on unmount", () => {
  const view = fixture(); view.render().thankYou();
  [...view.timers.values()][0]();
  assert.equal(view.render().visible, false);
  view.render().thankYou(); view.render(); view.unmount();
  assert.equal(view.timers.size, 0);
});
