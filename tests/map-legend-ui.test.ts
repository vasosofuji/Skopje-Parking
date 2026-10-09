import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("legend parking types reveal is inside its Sheet provider and measures its header with expanded choices", () => {
  const source = ts.createSourceFile("MapScreen.tsx", readFileSync("src/screens/MapScreen.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements: ts.JsxElement[] = [];
  function visit(node: ts.Node) { if (ts.isJsxElement(node)) elements.push(node); ts.forEachChild(node, visit); }
  visit(source);
  const legend = elements.find(node => node.openingElement.tagName.getText(source) === "Sheet" && node.openingElement.attributes.getText(source).includes('"Map legend"'))!;
  assert.ok(legend);
  const reveal = legend.children.find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "RevealSection") as ts.JsxElement;
  assert.ok(reveal, "the reveal must be below Sheet, not a hook in MapScreen's provider-free scope");
  const active = reveal.openingElement.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(source) === "active") as ts.JsxAttribute;
  assert.equal(active.initializer?.getText(source), "{parkingTypesExpanded}");
  assert.ok(reveal.children.some(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "Pressable"), "measure the dropdown header together with its choices");
  assert.match(reveal.getText(source), /parkingTypesExpanded \? filterOptions\.slice\(5\)\.map\(renderFilter\) : null/);
  assert.match(legend.getText(source), /filterOptions\.slice\(0, 5\)\.map\(renderFilter\)/);
});
