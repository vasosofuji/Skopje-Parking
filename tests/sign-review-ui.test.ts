import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { hasSignDetails } from "../src/domain/report-feedback";
import type { SignInfo } from "../src/domain/types";
import type { SignDraft } from "../src/services/signScan";

type Element = { type: string; props: Record<string, any>; children: unknown[] };
const nodes = (value: unknown): Element[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "children" in value ? [value as Element, ...(value as Element).children.flatMap(nodes)] : [];
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const info: SignInfo = { isParkingSign: true, confidence: 0.8, zoneCode: "D8", operator: null, currency: "MKD", firstHour: 25, nextHour: 25, maxStayMinutes: null, chargingHours: "Mon-Sat 07:00-23:00", paymentInstructions: null, restrictions: null, rawText: "ЗОНА D8" };

function renderReview(draft: SignDraft) {
  const sent: [string, SignInfo, string][] = [], discarded: string[] = [], cleanups: (() => void)[] = [];
  let confirmed = 0;
  const react = { createElement: (type: string, props: Record<string, any>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }), useState: (value: any) => [typeof value === "function" ? value() : value, () => {}], useEffect(fn: () => (() => void) | void) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } };
  const context = { exports: {} as { default: (props: unknown) => Element }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "react-native") return { Image: "Image", Text: "Text", TextInput: "TextInput", View: "View" };
    if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en, refresh: async () => {} }) };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: {} }) };
    if (name === "../state/ContributionFeedback") return { useContributionFeedback: () => ({ thankYou() {} }) };
    if (name === "../domain/report-feedback") return { hasSignDetails };
    if (name === "expo-router") return { router: { push() {} } };
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "../services/signReader") return { useSignReader: () => null };
    if (name === "../services/signScan") return { discardSignPhoto: async (uri: string) => { discarded.push(uri); } };
    if (name === "./ui") return { Button: "Button", Note: "Note", Sheet: "Sheet" };
    if (["./DigitalParkingSign", "./PaymentScheduleFields", "./StepActions"].includes(name)) return { default: name, __esModule: true };
    if (name === "../services/api") return { api: { addSignReading: async (placeId: string, value: SignInfo, model: string) => { sent.push([placeId, value, model]); return { id: "r1", placeId }; } } };
    throw new Error(name);
  } };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/components/SignReviewSheet.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context);
  const tree = context.exports.default({ draft, onClose() {}, onConfirmed() { confirmed++; } });
  return { tree, sent, discarded, unmount: () => cleanups.forEach(cleanup => cleanup()), confirmed: () => confirmed };
}

test("a phone reading shows the local photo, uploads only the confirmed details, then deletes the photo", async () => {
  const view = renderReview({ placeId: "zone", imageUri: "file:///cache/sign.jpg", info, model: "ocr:mlkit-text-v2", problem: null });
  assert.ok(nodes(view.tree).some(node => node.type === "Image" && node.props.source.uri === "file:///cache/sign.jpg"), "the photo never leaves the phone");
  view.tree.props.footer.props.onContinue(); await flush();
  assert.deepEqual(view.sent, [["zone", info, "ocr:mlkit-text-v2"]]);
  assert.equal(view.confirmed(), 1);
  view.unmount();
  assert.deepEqual(view.discarded, ["file:///cache/sign.jpg"]);
});

test("an unreadable photo opens manual entry with a hint and the AI key option", () => {
  const view = renderReview({ placeId: "zone", imageUri: "file:///cache/sign.jpg", info: null, model: "manual", problem: "unread" });
  assert.ok(nodes(view.tree).some(node => node.type === "Note" && node.children.some(child => typeof child === "string" && child.startsWith("The phone could not read this sign."))));
  assert.ok(nodes(view.tree).some(node => node.type === "Button" && node.props.title === "Add an AI key"));
  assert.ok(nodes(view.tree).some(node => node.type === "TextInput" && node.props.accessibilityLabel === "Zone"), "fields are editable");
  assert.equal(view.sent.length, 0);
});
