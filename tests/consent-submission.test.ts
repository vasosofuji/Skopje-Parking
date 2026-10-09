import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

type Element = { type: string; props: Record<string, unknown>; children: unknown[] };
function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("children" in tree)) return [];
  const node = tree as Element;
  return [node, ...node.children.flatMap(elements)];
}

for (const screen of ["welcome", "consent"]) {
  test(`${screen}: rapid consent taps submit once and a failed request can be retried`, async () => {
    const values: unknown[] = [];
    let cursor = 0, calls = 0;
    let reject!: (error: Error) => void;
    const account = { guest: () => { calls++; return new Promise<void>((_, fail) => { reject = fail; }); } };
    const react = {
      createElement(type: string, props: Record<string, unknown>, ...children: unknown[]) { return { type, props: props ?? {}, children }; },
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in values)) values[index] = screen === "welcome" && index === 0 ? "account" : initial;
        return [values[index], (next: unknown) => { values[index] = next; }];
      },
      useRef(initial: unknown) { const index = cursor++; return values[index] ?? (values[index] = { current: initial }); },
      useEffect() {},
    };
    const exports: { default?: () => Element } = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(`src/app/${screen}.tsx`, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    }).outputText, { exports, Error, require(name: string) {
      if (name === "react") return { ...react, default: react, __esModule: true };
      if (name === "react-native") return { ...Object.fromEntries(["Text", "View", "KeyboardAvoidingView", "ScrollView", "TextInput"].map(type => [type, type])), Keyboard: { dismiss() {} }, Platform: { OS: "android" } };
      if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
      if (name === "../components/ui") return { Button: "Button" };
      if (name === "../state/AccountContext") return { useAccount: () => account };
      if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en }) };
      if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: {} }) };
      if (name === "../domain/onboarding") return { completeOnboarding: () => account.guest() };
      if (name === "../domain/account" || name === "../services/api") return {};
      if (name.startsWith("../components/")) return { __esModule: true, default: name.split("/").at(-1) };
      if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: {} };
      throw new Error(`Unexpected dependency: ${name}`);
    } });
    const render = () => { cursor = 0; return elements(exports.default!()); };
    if (screen === "welcome") {
      const guest = render().find(node => node.props.title === "Continue as guest")!;
      (guest.props.onContinue as () => void)();
    }
    const modal = () => render().find(node => node.type === "TermsConsent")!;
    const accept = modal().props.onAccept as () => void;
    accept(); accept(); accept();
    assert.equal(calls, 1);
    assert.equal(modal().props.busy, true);
    reject(new Error("Server error. Please try again."));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(modal().props.busy, false);
    assert.equal(modal().props.error, "Server error. Please try again.");
    (modal().props.onAccept as () => void)();
    assert.equal(calls, 2);
    reject(new Error("test cleanup"));
    await new Promise(resolve => setImmediate(resolve));
  });
}
