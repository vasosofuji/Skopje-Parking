export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type PayingPeriod = { days: number[]; from: string; to: string };
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const endTime = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** Strings remain the public API format. Only fully understood strings become controls. */
export function parsePayingHours(raw: string | null | undefined): PayingPeriod[] | null {
  if (!raw?.trim()) return [];
  const periods: PayingPeriod[] = [];
  for (const part of raw.split(";")) {
    const match = part.trim().match(/^(.*?)\s*(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})$/);
    if (!match) return null;
    const from = match[2].padStart(5, "0"), to = match[3].padStart(5, "0");
    if (!time.test(from) || !endTime.test(to) || from === to) return null;
    const labels = match[1].trim();
    let days: number[] = [];
    if (!labels || /^daily$/i.test(labels)) days = [0, 1, 2, 3, 4, 5, 6];
    else for (const label of labels.split(",")) {
      const range = label.trim().split(/[–—-]/).map(day => WEEKDAYS.findIndex(value => value.toLowerCase() === day.trim().toLowerCase()));
      if (range.some(day => day < 0) || range.length > 2) return null;
      if (range.length === 1) days.push(range[0]);
      else {
        let day = range[0];
        for (let count = 0; count < 7; count++, day = (day + 1) % 7) {
          days.push(day);
          if (day === range[1]) break;
        }
      }
    }
    days = [...new Set(days)].sort((a, b) => a - b);
    if (!days.length) return null;
    periods.push({ days, from, to });
  }
  return periods;
}

export function formatPayingHours(periods: PayingPeriod[]): string | null {
  return periods.filter(period => period.days.length).map(period => {
    if (!time.test(period.from) || !endTime.test(period.to) || period.from === period.to) throw new Error("Invalid paying hours");
    const days = [...new Set(period.days)].sort((a, b) => a - b);
    if (days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Invalid paying days");
    const groups: string[] = [];
    for (let index = 0; index < days.length; index++) {
      const start = days[index];
      let end = start;
      while (days[index + 1] === end + 1) end = days[++index];
      groups.push(start === end ? WEEKDAYS[start] : `${WEEKDAYS[start]}–${WEEKDAYS[end]}`);
    }
    return `${groups.join(",")} ${period.from}–${period.to}`;
  }).join("; ") || null;
}
