import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as accountDomain from "../src/domain/account";

test("a guest can sign into an existing account without deleting guest data", async () => {
  type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
  const values: unknown[] = [];
  let cursor = 0;
  const loginCalls: unknown[][] = [];
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(value: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = value;
      return [values[index], (next: unknown) => { values[index] = next; }];
    },
    useEffect: () => {},
    useCallback: (value: unknown) => value,
  };
  const source = ts.transpileModule(readFileSync("src/app/account.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const context = {
    exports: {} as { default: () => Element },
    require(name: string) {
      if (name === "react") return { ...react, default: react, __esModule: true };
      if (name === "react-native") return { KeyboardAvoidingView: "KeyboardAvoidingView", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View", Platform: { OS: "android" } };
      if (name === "expo-router") return { router: { push: () => assert.fail("Sign in stays in the account flow") } };
      if (name === "../state/AccountContext") return { useAccount: () => ({
        profile: { id: "guest-session", guest: true, username: "", secured: false, points: 25 },
        refresh: async () => {},
        login: async (...args: unknown[]) => { loginCalls.push(args); },
        register: async () => assert.fail("Existing-account sign in must not create another account"),
        clear: async () => assert.fail("Guest data must not be deleted to sign in"),
      }) };
      if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en }) };
      if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: {} }) };
      if (name === "../services/api") return { api: {} };
      if (name === "../domain/account") return accountDomain;
      if (name === "../components/ui") return { Button: "Button", Note: "Note", FormScrollView: "FormScrollView", RevealSection: "RevealSection" };
      if (name === "../components/Page") return { default: "Page", __esModule: true };
      if (name === "../components/PasswordField") return { default: "PasswordField", __esModule: true };
      if (name === "../components/LoadingIndicator") return { default: "LoadingIndicator", __esModule: true };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(source, context);
  const render = () => { cursor = 0; return context.exports.default(); };
  function all(root: unknown): Element[] {
    if (Array.isArray(root)) return root.flatMap(all);
    if (!root || typeof root !== "object" || !("children" in root)) return [];
    const element = root as Element;
    return [element, ...element.children.flatMap(all)];
  }
  function button(tree: Element, title: string) {
    const element = all(tree).find(item => item.type === "Button" && item.props.title === title);
    assert.ok(element, `Missing ${title} action`);
    return element;
  }
  let tree = render();
  (button(tree, "Sign in to an existing account").props.onPress as () => void)();
  tree = render();
  const nodes = all(tree);
  assert.ok(nodes.some(item => item.type === "Note" && item.children.includes("Guest points won't transfer to an existing account.")));
  const username = nodes.find(item => item.props.accessibilityLabel === "Username")!;
  const password = nodes.find(item => item.type === "PasswordField")!;
  (username.props.onChangeText as (value: string) => void)("  Ｄriver_1 ");
  (password.props.onChange as (value: string) => void)("Kept password 123");
  tree = render();
  assert.equal(button(tree, "Sign in").props.disabled, false);
  (button(tree, "Sign in").props.onPress as () => void)();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loginCalls, [["Driver_1", "Kept password 123", true]]);
});
