import test from "node:test";
import assert from "node:assert/strict";
import { formRevealOffset } from "../src/domain/form-reveal";

test("expanded fields fit in the viewport without moving an already visible form", () => {
  assert.equal(formRevealOffset(150, 200, 100, 500, 1200), 100);
  assert.equal(formRevealOffset(550, 250, 100, 500, 1200), 312);
  assert.equal(formRevealOffset(80, 220, 300, 500, 1200), 68);
});
test("long sections show their heading and remain within the content bounds", () => {
  assert.equal(formRevealOffset(350, 800, 0, 500, 1200), 338);
  assert.equal(formRevealOffset(0, 800, 100, 500, 1200), 0);
  assert.equal(formRevealOffset(950, 200, 0, 500, 1100), 600);
  assert.equal(formRevealOffset(350, 200, 100, 0, 1200), 100);
  assert.equal(formRevealOffset(350, 800, 600, 500, 1200, false), 600);
});
