import type { SignInfo } from "./types";
import { formatPayingHours, type PayingPeriod } from "./payment-hours";
import { normalizeZoneCode } from "./parking";

// Turns plain on-device OCR text of a Skopje parking sign into editable sign details, with no AI.
// ML Kit's Latin model reads Cyrillic as look-alike Latin letters ("Недела" -> "HEAEnA"), so every
// line is matched as an uppercase "shape" where Cyrillic letters become the Latin glyph they resemble.
// Everything here is a suggestion: readings stay below the auto-ready confidence and the driver
// confirms each field against the photo.
const SHAPES: Record<string, string> = {
  А: "A", Б: "6", В: "B", Г: "R", Д: "A", Ѓ: "R", Е: "E", Ж: "X", З: "3", Ѕ: "S", И: "N", Ј: "J", К: "K", Ќ: "K",
  Л: "N", Љ: "N", М: "M", Н: "H", Њ: "H", О: "O", П: "N", Р: "P", С: "C", Т: "T", У: "Y", Ф: "O", Х: "X", Ц: "U",
  Ч: "4", Џ: "U", Ш: "W", Ë: "E", Ç: "C",
};
const shape = (text: string) => text.toUpperCase().replace(/[Ѐ-ӿËÇ]/g, c => SHAPES[c] ?? c).replace(/[|!]/g, "I");

const DAY_WORDS = {
  daily: /SEKOJ DEN|CEKOJ AEH|DAILY|EVERY DAY|[CÇ]DO DIT|\b0?0[:.]?(?:00)?\s*[-–—]\s*24/,
  monSat: /\b(?:PON|[NLIMP]?OH|NON|MON|H[EË]N)\w*\.?\s*[-–—]\s*(?:E\s+)?(?:SAB|CA6|CAB|SAT|SHT|SUB)|\bI\s*[-–—]\s*VI\b/,
  monFri: /\b(?:PON|[NLIMP]?OH|NON|MON|H[EË]N)\w*\.?\s*[-–—]\s*(?:E\s+)?(?:[PNM]ET|FRI|PRE)|\bI\s*[-–—]\s*V\b|RABOT|PA6OT|PABOT|WORK\s*DAY|WEEKDAY|DIT[EË]\s*PUN/,
  sat: /\b(?:SAB|CA6|CAB|SAT|SHT|SUB)\w*|\bVI\b/,
  sun: /\b(?:NED|HE[AGQO]|SUN|DIE)\w*|\bVII\b/,
  holidays: /PRAZ|NPA3|NPAZ|HOLIDAY|FEST/,
  free: /BESPL|6ECN?NA|BECN?NA|FREE|FALAS|PA PAG/,
};
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];
function labelledDays(context: string): number[] | null {
  if (DAY_WORDS.daily.test(context)) return ALL_WEEK;
  if (DAY_WORDS.monSat.test(context)) return [0, 1, 2, 3, 4, 5];
  if (DAY_WORDS.monFri.test(context)) return [0, 1, 2, 3, 4];
  const sat = DAY_WORDS.sat.test(context), sun = DAY_WORDS.sun.test(context);
  return sat && sun ? [5, 6] : sat ? [5] : sun ? [6] : null;
}

// 07-21, 07:00 - 21:00, 7-21ч, 07.00-21.00h. A Cyrillic "ч" often reads as a trailing 4 ("07-214").
const RANGE = /(^|[^\d])(2[0-4]|[01]?\d)(?:[:.]([0-5]\d))?\s*(H(?![A-Z])|4(?!\d))?\s*[-–—]\s*(2[0-4]|[01]?\d)(?:[:.]([0-5]\d))?(\s*H(?![A-Z])|4(?!\d))?/g;
const PRICE_UNIT = /\s*(?:[ADGQ]EH|DEN|AEN|MKD|DENAR)/;
const DURATION_UNIT = /^\s*(?:4AC|ЧАС|HOUR|OR[EË]|MIN|MNH)/;
type Range = { from: string; to: string; index: number; end: number };
function ranges(line: string): Range[] {
  const out: Range[] = [];
  for (const match of line.matchAll(RANGE)) {
    const [whole, lead, fromH, fromM, fromSuffix, toH, toM, toSuffix] = match;
    const end = match.index! + whole.length, after = line.slice(end);
    // Prices ("20-25 ден") and durations ("1-2 часа") look like hour ranges.
    if (PRICE_UNIT.test(after.slice(0, 8)) || DURATION_UNIT.test(after)) continue;
    const from = Number(fromH) * 60 + Number(fromM ?? 0), to = Number(toH) * 60 + Number(toM ?? 0);
    const explicit = Boolean(fromM || toM || fromSuffix || toSuffix);
    if (from >= to || to > 24 * 60 || (!explicit && !(from === 0 && to === 24 * 60) && (Number(fromH) < 5 || Number(toH) < 12))) continue;
    const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    out.push({ from: clock(from), to: clock(to), index: match.index! + lead.length, end });
  }
  return out;
}

/** Paying hours in the app's "Mon-Fri 07:00-21:00; Sat 07:00-14:00" format, plus weekend rules. */
export function payingHoursFromText(lines: string[]): { chargingHours: string | null; freeWeekends: SignInfo["freeWeekends"] } {
  const shaped = lines.map(shape), periods: PayingPeriod[] = [], unlabelled: { from: string; to: string }[] = [];
  shaped.forEach((line, i) => {
    for (const range of ranges(line)) {
      // The day label sits before the times on the same line, or alone on the line above.
      const before = line.slice(0, range.index);
      const days = labelledDays(before) ?? (before.trim() ? null : i > 0 && !ranges(shaped[i - 1]).length ? labelledDays(shaped[i - 1]) : null);
      if (days) periods.push({ days, from: range.from, to: range.to });
      else unlabelled.push(range);
    }
  });
  // Skopje signs list weekdays first, then Saturday: unlabelled rows follow that order.
  const taken = new Set(periods.flatMap(period => period.days));
  const order = unlabelled.length === 1 ? [[0, 1, 2, 3, 4, 5]] : [[0, 1, 2, 3, 4], [5], [6]];
  unlabelled.forEach((range, i) => { const days = (order[i] ?? []).filter(day => !taken.has(day)); if (days.length) periods.push({ days, ...range }); });
  const freeLines = shaped.filter(line => DAY_WORDS.free.test(line));
  const freeSat = freeLines.some(line => DAY_WORDS.sat.test(line)), freeSun = freeLines.some(line => DAY_WORDS.sun.test(line) || DAY_WORDS.holidays.test(line));
  const paysSat = periods.some(period => period.days.includes(5)), paysSun = periods.some(period => period.days.includes(6));
  const freeWeekends = freeSat && freeSun && !paysSat ? "both" : freeSun && !paysSun ? paysSat ? "sunday" : null : paysSat && paysSun ? "neither" : null;
  // Rows with the same times (weekdays and Saturday 07-23) become one period, in weekday order.
  const merged = new Map<string, PayingPeriod>();
  for (const period of periods) {
    const key = `${period.from}-${period.to}`, existing = merged.get(key);
    merged.set(key, { ...period, days: [...new Set([...(existing?.days ?? []), ...period.days])].sort((a, b) => a - b) });
  }
  let chargingHours: string | null = null;
  try { chargingHours = merged.size ? formatPayingHours([...merged.values()].sort((a, b) => a.days[0] - b.days[0])) : null; } catch { chargingHours = null; }
  return { chargingHours, freeWeekends };
}

const ZONE_WORD = /\b(?:ZONA|[3Z][O0]HA|ZONE|ZON[EË])\s*[:.]?\s*([ABCDА-Д]?\s?\d{1,2})\b/;
const LISTED_ZONE = /\b([ABCD]\d{1,2})\b/g;
/** Reads OCR text blocks; `knownZones` (catalog zone codes) breaks ties between code-like tokens. */
export function signFromText(blocks: string[], knownZones: string[] = []): SignInfo {
  const raw = blocks.join("\n").replace(/\r/g, "").trim();
  const lines = raw.split("\n").map(line => line.trim()).filter(Boolean);
  const shaped = lines.map(shape), all = shaped.join("\n");
  const operator = /GRADSK|RPAACK|RPAAC/.test(all) ? "Gradski parking" : /\bPOC\b|\bNOU\b|OPSHTINA CENTAR|OPSTINA CENTAR|UEHTAP/.test(all) ? "POC" : null;
  const known = new Set(knownZones.map(normalizeZoneCode));
  let zoneCode: string | null = null;
  const labelled = all.match(ZONE_WORD)?.[1];
  if (labelled) {
    const code = normalizeZoneCode(labelled);
    zoneCode = /^\d$/.test(code) && operator === "POC" ? `POC ${code}` : /^\d+$/.test(code) && operator !== "POC" ? null : code;
  }
  if (!zoneCode) {
    const tokens = [...all.matchAll(LISTED_ZONE)].map(match => match[1]);
    zoneCode = tokens.find(token => known.has(token)) ?? (known.size ? null : tokens[0] ?? null);
  }
  // Hourly prices; daily/monthly tickets and fines are other tariffs.
  let firstHour: number | null = null, nextHour: number | null = null;
  const prices: number[] = [];
  shaped.forEach(line => {
    if (/AHEB|DNEV|DAILY|MECE4|MESE|MONTH|NPETN|PRETP|KA3H|KAZN|FINE|GJOB/.test(line)) return;
    for (const match of line.matchAll(/(\d{1,4})(?:[.,](\d{1,2}))?(?=\s*(?:[ADGQ]EH|DEN|AEN|MKD|DENAR))/g)) {
      const value = Number(match[1] + (match[2] ? `.${match[2]}` : ""));
      if (value <= 0 || value > 2000) continue;
      if (/NPB|PRV|FIRST|PAR[EË]/.test(line) && firstHour === null) firstHour = value;
      else if (/HAPEA|NARED|NEXT|SECIL|SEKOJ|CEKOJ|ADDITIONAL/.test(line) && nextHour === null) nextHour = value;
      else prices.push(value);
    }
  });
  if (firstHour === null && prices.length) firstHour = prices.shift()!;
  if (nextHour === null) nextHour = prices.length && firstHour !== null ? prices.shift()! : firstHour;
  if (/BESPLATEN PARK|6ECNNATEH NAPK|FREE PARKING|PARKIM FALAS/.test(all) && firstHour === null) firstHour = nextHour = 0;
  let maxStayMinutes: number | null = null;
  if (!/HEOR|NEOGR|UNLIMIT|PA KUFI/.test(all)) for (const line of shaped) {
    if (!/MAX|MAKC|MAKS|OGRAN|ORPAH|LIMIT|KUFI|AO\s|DO\s/.test(line)) continue;
    const hours = line.match(/(\d{1,2})\s*(?:4AC|ЧАС|HOURS?\b|H\b|OR[EË])/), minutes = line.match(/(\d{2,3})\s*(?:MIN|MNH)/);
    const value = minutes ? Number(minutes[1]) : hours ? Number(hours[1]) * 60 : null;
    if (value && value >= 15 && value <= 1440) { maxStayMinutes = value; break; }
  }
  const { chargingHours, freeWeekends } = payingHoursFromText(lines);
  const smsLine = lines.find((_, i) => /SMS|CMC|144\s*[- ]?\s*144|14\s*14\s*14|141414/.test(shaped[i]));
  const found = [zoneCode, firstHour, chargingHours, operator, maxStayMinutes].filter(value => value !== null).length;
  return {
    isParkingSign: found > 0 || /PARK|NAPK/.test(all),
    // Plain OCR is never trusted as ready: the driver compares every field with the photo.
    confidence: Math.min(0.8, 0.4 + found * 0.1),
    zoneCode, operator, currency: firstHour !== null ? "MKD" : null, firstHour, nextHour, maxStayMinutes,
    chargingHours, freeWeekends, paymentInstructions: smsLine?.slice(0, 600) ?? null, restrictions: null,
    rawText: raw.slice(0, 4000),
  };
}
