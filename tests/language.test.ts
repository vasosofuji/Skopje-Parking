import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { LANGUAGES, isLanguage, translate } from "../src/domain/language";
import translations from "../src/locales/translations.json";

test("every static UI message has Turkish and Albanian translations", () => {
  const keys = new Set<string>();
  function scan(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = `${path}/${entry.name}`;
      if (entry.isDirectory()) { scan(file); continue; }
      if (!/\.tsx?$/.test(file)) continue;
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const name = node.expression.getText(source);
          const key = node.arguments[name === "t" ? 0 : name === "translate" ? 1 : -1];
          if (key && ts.isStringLiteral(key)) keys.add(key.text);
          // An interpolated key never matches the dictionary; use a {placeholder} and replace().
          assert.ok(!key || !ts.isTemplateExpression(key), `Interpolated translation key in ${file}: ${key?.getText(source)}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan("src");
  const dictionary = translations as Record<string, { tr: string; sq: string }>;
  for (const key of keys) {
    assert.ok(dictionary[key]?.tr.trim(), `Missing Turkish: ${key}`);
    assert.ok(dictionary[key]?.sq.trim(), `Missing Albanian: ${key}`);
  }
  assert.ok(keys.size > 400);
});

test("language codes, bundled flags and translation fallback remain valid", () => {
  for (const { code, flag } of LANGUAGES) {
    assert.equal(isLanguage(code), true);
    const bytes = readFileSync(`assets/flags/${flag}.png`);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.ok(existsSync(`assets/flags/${flag}.png`));
  }
  assert.equal(isLanguage("al"), false);
  assert.equal(isLanguage(null), false);
  assert.equal(translate("mk", "Continue", "Продолжи"), "Продолжи");
  assert.equal(translate("en", "Continue", "Продолжи"), "Continue");
  assert.equal(translate("tr", "Continue", "Продолжи"), "Devam et");
  assert.equal(translate("sq", "Continue", "Продолжи"), "Vazhdo");
  assert.equal(translate("sq", "Future message", "Идна порака"), "Future message");
});

test("generated English parking names are translated for Turkish and Albanian drivers", async () => {
  const { placeName } = await import("../src/domain/language");
  const generated = { name: "Паркинг · до Финска", nameEn: "Parking near Финска" }, named = { name: "Рамстор", nameEn: "Ramstore carpark" };
  assert.equal(placeName(generated, "mk"), "Паркинг · до Финска");
  assert.equal(placeName(generated, "en"), "Parking near Финска");
  assert.equal(placeName(generated, "tr"), "Финска yakınında otopark");
  assert.equal(placeName(generated, "sq"), "Parking pranë Финска");
  assert.equal(placeName(named, "sq"), "Ramstore carpark");
  assert.equal(placeName({ name: "Средно Водно" }, "tr"), "Средно Водно");
});

test("prices above anything Skopje charges need a second tap with the same value", async () => {
  const state: unknown[] = [];
  let cursor = 0;
  const react = { useState: (value: unknown) => { const index = cursor++; if (!(index in state)) state[index] = value; return [state[index], (next: unknown) => { state[index] = next; }]; } };
  const exports = {} as { usePriceCheck: (t: (en: string) => string) => (values: (number | null)[], warn: (message: string) => void) => boolean };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/hooks/usePriceCheck.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: (name: string) => name === "react" ? react : name === "../domain/progressive-entry" ? { UNUSUAL_HOURLY_PRICE: 300 } : assert.fail(name) });
  const warnings: string[] = [];
  const check = () => { cursor = 0; return exports.usePriceCheck(en => en); };
  assert.equal(check()([40, 40], message => warnings.push(message)), true);
  assert.equal(check()([400, null], message => warnings.push(message)), false);
  assert.match(warnings[0], /^400 MKD per hour is unusually high/);
  assert.equal(check()([450, null], message => warnings.push(message)), false, "a different value asks again");
  assert.equal(check()([450, null], message => warnings.push(message)), true, "the same value is accepted on the second tap");
});
