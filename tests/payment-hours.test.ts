import assert from "node:assert/strict";
import test from "node:test";
import { parsePayingHours, formatPayingHours, localHours } from "../src/domain/payment-hours";
test("structured paying hours round-trip different weekday and weekend periods", () => {
  const raw = "Mon-Fri 07:00-23:00; Sat 07:00-15:00";
  const periods = parsePayingHours(raw)!;
  assert.deepEqual(periods, [{ days: [0, 1, 2, 3, 4], from: "07:00", to: "23:00" }, { days: [5], from: "07:00", to: "15:00" }]);
  assert.equal(formatPayingHours(periods), raw);
});
test("unknown legacy schedules stay raw; times include overnight and midnight end", () => {
  for (const raw of ["Пон-Пет 07:00-23:00", "Mon-Fri 7-23", "Working hours change in summer", "Mon 25:00-27:00", "Mon 07:00-07:00"]) assert.equal(parsePayingHours(raw), null);
  assert.deepEqual(parsePayingHours("7:00-23:00"), [{ days: [0, 1, 2, 3, 4, 5, 6], from: "07:00", to: "23:00" }]);
  assert.equal(formatPayingHours([{ days: [5, 6], from: "22:15", to: "06:30" }]), "Sat-Sun 22:15-06:30");
  assert.equal(formatPayingHours([{ days: [0], from: "00:00", to: "24:00" }]), "Mon 00:00-24:00");
});
test("day controls handle sparse and wraparound days and preserve empty schedules", () => {
  assert.equal(formatPayingHours([{ days: [4, 0, 2, 2], from: "07:00", to: "15:00" }]), "Mon,Wed,Fri 07:00-15:00");
  assert.deepEqual(parsePayingHours("Fri-Mon 07:00-15:00")?.[0].days, [0, 4, 5, 6]);
  assert.equal(formatPayingHours([{ days: [], from: "07:00", to: "23:00" }]), null);
  assert.deepEqual(parsePayingHours(null), []);
  assert.throws(() => formatPayingHours([{ days: [0], from: "24:00", to: "07:00" }]));
  assert.throws(() => formatPayingHours([{ days: [8], from: "07:00", to: "23:00" }]));
});
test("hours show day names in the app language and lose old long dashes", () => {
  assert.equal(localHours("Mon–Fri 07:00–21:00; Sat 07:00-15:00", "mk"), "Пон-Пет 07:00-21:00; Саб 07:00-15:00");
  assert.equal(localHours("Sun 08:00-14:00", "tr"), "Paz 08:00-14:00");
  assert.equal(localHours("Mon-Fri 07:00-21:00", "en"), "Mon-Fri 07:00-21:00");
});
