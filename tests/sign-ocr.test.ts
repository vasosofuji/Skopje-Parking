import test from "node:test";
import assert from "node:assert/strict";
import { payingHoursFromText, signFromText } from "../src/domain/sign-ocr";
import { parsePayingHours } from "../src/domain/payment-hours";

const ZONES = ["A3", "B2", "C8", "D4", "C17"];

test("a Cyrillic Gradski sign yields zone, operator, price, paying hours, Sunday rule and limit", () => {
  const info = signFromText(["ЗОНА A3", "ЈП ГРАДСКИ ПАРКИНГ", "40 ден./час", "Работно време:", "Понеделник - Петок 07:00 - 21:00", "Сабота 07:00 - 14:00",
    "Недела и празници - бесплатно", "Максимално време на паркирање 2 часа", "SMS: A3 SK1234AB на 144 144"], ZONES);
  assert.equal(info.zoneCode, "A3"); assert.equal(info.operator, "Gradski parking");
  assert.equal(info.firstHour, 40); assert.equal(info.nextHour, 40); assert.equal(info.currency, "MKD");
  assert.equal(info.chargingHours, "Mon–Fri 07:00–21:00; Sat 07:00–14:00");
  assert.equal(info.freeWeekends, "sunday"); assert.equal(info.maxStayMinutes, 120);
  assert.match(info.paymentInstructions!, /144 144/);
  assert.ok(info.isParkingSign && info.confidence < 0.85, "plain OCR always goes to careful review");
});

test("ML Kit's look-alike Latin reading of the same sign gives the same hours", () => {
  // What a Latin-only recognizer returns for Cyrillic glyphs.
  const info = signFromText(["3OHA A3", "JN RPAACKN NAPKNHR", "40 AeH./4ac", "Pa6oTHo BpeMe:", "NoHeAenHNK - NeTok 07:00 - 21:00", "Ca6oTa 07:00 - 14:00",
    "HeAena n npa3HNUN - 6ecnnaTHo", "MakcnmanHo BpeMe 2 4aca", "SMS: A3 SK1234AB Ha 144 144"], ZONES);
  assert.equal(info.zoneCode, "A3"); assert.equal(info.operator, "Gradski parking"); assert.equal(info.firstHour, 40);
  assert.equal(info.chargingHours, "Mon–Fri 07:00–21:00; Sat 07:00–14:00");
  assert.equal(info.freeWeekends, "sunday"); assert.equal(info.maxStayMinutes, 120);
});

test("Latin, Albanian, English and Roman-numeral sign rows", () => {
  assert.deepEqual(payingHoursFromText(["ZONA C8", "25 den/h", "Pon-Pet 07-21h", "Sab 07-15h", "Ned besplatno"]), { chargingHours: "Mon–Fri 07:00–21:00; Sat 07:00–15:00", freeWeekends: "sunday" });
  assert.deepEqual(payingHoursFromText(["Zona D4 25 MKD/orë", "E hënë - E premte 07-23", "E shtunë 07-23", "E diel falas"]).chargingHours, "Mon–Sat 07:00–23:00");
  assert.equal(payingHoursFromText(["Mon-Sat 07:00-23:00", "Sunday and holidays free"]).chargingHours, "Mon–Sat 07:00–23:00");
  assert.equal(payingHoursFromText(["I-V 07-21", "VI 07-14"]).chargingHours, "Mon–Fri 07:00–21:00; Sat 07:00–14:00");
  assert.equal(payingHoursFromText(["Секој ден 00-24"]).chargingHours, "Mon–Sun 00:00–24:00");
  assert.equal(payingHoursFromText(["Пон-Пет", "07-21ч", "Сабота", "07-14ч"]).chargingHours, "Mon–Fri 07:00–21:00; Sat 07:00–14:00", "label on the line above");
  assert.equal(payingHoursFromText(["07-214"]).chargingHours, "Mon–Sat 07:00–21:00", "a Cyrillic ч read as a trailing 4");
});

test("unlabelled rows follow the Skopje order (weekdays, then Saturday)", () => {
  assert.equal(payingHoursFromText(["Наплата", "07:00-21:00", "07:00-14:00"]).chargingHours, "Mon–Fri 07:00–21:00; Sat 07:00–14:00");
  assert.equal(payingHoursFromText(["07:00 - 23:00"]).chargingHours, "Mon–Sat 07:00–23:00");
});

test("prices, durations, SMS numbers, phones and dates are never read as paying hours", () => {
  for (const line of ["1-2 часа", "1 - 2 hours", "20-25 ден", "144-144", "SMS 141414", "+389 2 3215 566", "15.04.2026", "Зона 1-2", "3-5 мин"])
    assert.equal(payingHoursFromText([line]).chargingHours, null, line);
  // Every produced value is a schedule the app's own controls can edit.
  assert.ok(parsePayingHours(signFromText(["Пон-Пет 07-21", "Сабота 07-14"]).chargingHours)?.length);
});

test("first/next hour prices, POC zones, unknown zone tokens and non-signs", () => {
  const tiered = signFromText(["Прв час 50 ден", "Секој нареден час 30 ден", "Дневен билет 300 ден"]);
  assert.equal(tiered.firstHour, 50); assert.equal(tiered.nextHour, 30);
  const poc = signFromText(["ПОЦ Паркинзи на Општина Центар", "ЗОНА 1", "70 ден/час"]);
  assert.equal(poc.operator, "POC"); assert.equal(poc.zoneCode, "POC 1");
  assert.equal(signFromText(["Паркинг", "A9 B7"], ZONES).zoneCode, null, "codes outside the catalog are not guessed");
  assert.equal(signFromText(["Неограничено", "Максимално 2 часа"]).maxStayMinutes, null);
  const shop = signFromText(["КАФЕ БАР", "Отворено"]);
  assert.equal(shop.isParkingSign, false);
});

test("real ML Kit output from the emulator for the Cyrillic Gradski sign", () => {
  const info = signFromText(["P\n30HA A3\nJi rPAACKV NAPKUHr\n40 qeH.l4ac\nPaboTHOo BpeMe:\nloHegenHMK -MeTOK 07:00 -21:00\nCa6ota 07:00- 14:00\nHegena n npa3HMUM - 6ecnnaTHO\nMakcuManHO BpeMe Ha napkupabe 2 4aca\nSMS: A3 SK1234AB Ha 144 144"], ZONES);
  assert.deepEqual([info.zoneCode, info.operator, info.firstHour, info.chargingHours, info.freeWeekends, info.maxStayMinutes],
    ["A3", "Gradski parking", 40, "Mon–Fri 07:00–21:00; Sat 07:00–14:00", "sunday", 120]);
});
