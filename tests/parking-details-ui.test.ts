import test from "node:test";
import * as paymentHours from "../src/domain/payment-hours";
import * as languageModule from "../src/domain/language";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as parking from "../src/domain/parking";
import * as feedback from "../src/domain/report-feedback";
import type { ParkingPlace } from "../src/domain/types";

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
const now = Date.parse("2026-10-03T12:10:30Z");
const place: ParkingPlace = { id: "parking-one", name: "Test parking", kind: "surface", coordinate: { latitude: 42, longitude: 21 }, access: "public", verification: "community", zoneCode: "D8", operator: null, tariff: null, communityPrice: { firstHour: 25, nextHour: 25, reports: 1, observedAt: new Date(now - 1000).toISOString() }, capacity: 30, openingHours: null, source: { label: "Driver", url: "", retrievedAt: "" }, availability: { status: "spaces", source: "community", observedAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 840000).toISOString(), reports: 1 } };

function fixture() {
  const state: unknown[] = []; let cursor = 0;
  const react = {
    Fragment: "Fragment",
    createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(state[index]) : next; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
  };
  const context = { exports: {} as { default: (props: unknown) => Element }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "react-native") return { Platform: { OS: "android" }, Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: (styles: unknown) => styles } };
    if (name === "./ui") return { Sheet: "Sheet", RevealSection: "RevealSection", Button: "Button", Icon: "Icon", Note: "Note", useSheetReveal() { throw new Error("ParkingDetails cannot use the reveal hook before its Sheet provider exists"); } };
    if (name === "../domain/parking") return parking;
    if (name === "../domain/payment-hours") return paymentHours;
    if (name === "../domain/report-feedback") return feedback;
    if (name === "../services/api") return { api: { flagSign: async () => ({ flagged: true }) } };
    if (name === "../state/ParkingContext") return { useParking: () => ({ catalog: { places: [place] }, language: "en", t: (en: string) => en, now }) };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: {} }) };
    if (name === "./PaymentScheduleFields") return { weekendLabel: () => "Weekends" };
    if (["./SignScanner", "./SignReviewSheet", "./DigitalParkingSign", "./ManualParkingWizard", "./RemoveParking"].includes(name)) return { default: name, __esModule: true };
    throw new Error(`Unexpected dependency ${name}`);
  } };
  const source = ts.transpileModule(readFileSync("src/components/ParkingDetails.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(source, context);
  function nodes(value: unknown): Element[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("children" in value)) return []; const node = value as Element; return [node, ...node.children.flatMap(nodes)]; }
  function heading(tree: Element) { const node = nodes(tree).find(node => node.type === "Pressable" && nodes(node).some(child => child.type === "Text" && child.children.includes("Current parking details"))); assert.ok(node); return node; }
  const render = (visible = true) => { cursor = 0; return context.exports.default({ place, visible, minutes: 60, onClose() {} }); };
  return { render, nodes, heading };
}

test("parking details are open on arrival and revealing runs beneath the Sheet provider", () => {
  const view = fixture(), tree = view.render();
  const sheet = view.nodes(tree).find(node => node.type === "Sheet")!;
  const reveal = view.nodes(sheet).find(node => node.type === "RevealSection")!;
  assert.ok(reveal, "the section must be a child of Sheet to receive its reveal context");
  assert.equal(reveal.props.active, true);
  assert.equal(view.heading(tree).props["aria-expanded"], true);
  assert.ok(view.nodes(reveal).some(node => node.type === "Text" && node.children.includes("25 MKD / first hour")));
  const reportTime = feedback.availabilityReportTime(place.availability, "en", now)!;
  assert.ok(view.nodes(reveal).some(node => node.type === "Note" && node.children.some(child => typeof child === "string" && child.includes(reportTime))));
});

test("parking details toggle content and reveal state together, and reopen expanded", () => {
  const view = fixture(); let tree = view.render();
  view.heading(tree).props.onPress(); tree = view.render();
  assert.equal(view.heading(tree).props["aria-expanded"], false);
  assert.equal(view.nodes(tree).find(node => node.type === "RevealSection")!.props.active, false);
  assert.ok(!view.nodes(tree).some(node => node.type === "Text" && node.children.includes("25 MKD / first hour")));
  view.heading(tree).props.onPress(); tree = view.render();
  assert.equal(view.nodes(tree).find(node => node.type === "RevealSection")!.props.active, true);
  view.heading(tree).props.onPress(); tree = view.render(false);
  view.nodes(tree).find(node => node.type === "Sheet")!.props.onShow(); tree = view.render();
  assert.equal(view.heading(tree).props["aria-expanded"], true);
  assert.equal(view.nodes(tree).find(node => node.type === "RevealSection")!.props.active, true);
});
