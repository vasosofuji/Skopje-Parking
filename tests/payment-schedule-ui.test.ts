import test from "node:test";
import * as languageModule from "../src/domain/language";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as hours from "../src/domain/payment-hours";
import type { PaymentSchedule } from "../src/domain/types";
type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
const source = ts.transpileModule(readFileSync("src/components/PaymentScheduleFields.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
function form(initial: PaymentSchedule) {
  const state: unknown[] = []; let cursor = 0, value = initial;
  const react = { createElement: (type: unknown, props: Record<string, any>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }), useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [state[index], (next: unknown) => { state[index] = next; }]; } };
  const context = { exports: {} as { default: (props: unknown) => Element }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "react-native") return { View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", StyleSheet: { create: (styles: unknown) => styles } };
    if (name === "../domain/payment-hours") return hours;
    if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en }) };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: {} }) };
    if (name === "./ui") return { Icon: "Icon", Button: "Button", useSheetReveal: () => ({}) };
    throw new Error(`Unexpected dependency ${name}`);
  } };
  vm.runInNewContext(source, context);
  function nodes(tree: unknown): Element[] { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!tree || typeof tree !== "object" || !("children" in tree)) return []; const node = tree as Element; return [node, ...node.children.flatMap(nodes)]; }
  return { value: () => value, nodes, render() { cursor = 0; return context.exports.default({ value, onChange: (next: PaymentSchedule) => { value = next; }, showHeading: false }); }, tap(tree: Element, label: string) { const node = nodes(tree).find(node => node.props.title === label || node.props.accessibilityLabel === label || (node.type === "Pressable" && nodes(node).some(child => child.type === "Text" && child.children.includes(label)))); assert.ok(node, `Missing ${label}`); node.props.onPress(); } };
}
test("paying hours controls select days and append separate periods without text syntax", () => {
  const editor = form({ chargingHours: null, freeWeekends: null }); let tree = editor.render();
  assert.ok(!editor.nodes(tree).some(node => node.type === "TextInput"));
  editor.tap(tree, "Add hours"); tree = editor.render(); assert.equal(editor.value().chargingHours, "Mon-Fri 07:00-23:00");
  editor.tap(tree, "Wed"); tree = editor.render(); assert.equal(editor.value().chargingHours, "Mon-Tue,Thu-Fri 07:00-23:00");
  editor.tap(tree, "Add hours"); tree = editor.render(); assert.equal(editor.value().chargingHours, "Mon-Tue,Thu-Fri 07:00-23:00; Wed,Sat-Sun 07:00-23:00");
  editor.tap(tree, "Remove hours 1"); tree = editor.render(); assert.equal(editor.value().chargingHours, "Wed,Sat-Sun 07:00-23:00");
  editor.tap(tree, "Remove hours 1"); assert.equal(editor.value().chargingHours, null);
});
test("unrecognized sign hours remain exact when weekend preferences change", () => {
  const raw = "Пон-Пет 07ч-23ч, празници бесплатно";
  const editor = form({ chargingHours: raw, freeWeekends: null }); let tree = editor.render();
  assert.ok(editor.nodes(tree).some(node => node.type === "TextInput" && node.props.value === raw));
  editor.tap(tree, "Free on Sundays only"); tree = editor.render(); assert.equal(editor.value().chargingHours, raw); assert.equal(editor.value().freeWeekends, "sunday");
  editor.tap(tree, "Choose days and times"); tree = editor.render(); assert.equal(editor.value().chargingHours, "Mon-Fri 07:00-23:00");
  assert.ok(!editor.nodes(tree).some(node => node.type === "TextInput"));
});
test("switching off every day removes paying hours without changing free weekends", () => {
  const editor = form({ chargingHours: "Sat-Sun 08:15-12:30", freeWeekends: "neither" }); let tree = editor.render();
  editor.tap(tree, "Sat"); tree = editor.render(); editor.tap(tree, "Sun"); tree = editor.render();
  assert.equal(editor.value().chargingHours, null); assert.equal(editor.value().freeWeekends, "neither");
  editor.tap(tree, "Mon"); assert.equal(editor.value().chargingHours, "Mon 08:15-12:30");
});
