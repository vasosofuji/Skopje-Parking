import type { Fix } from "./arrival";
import { placeName, translate, type Language } from "./language";
import { usableFix } from "./location";
import { parkingPrice } from "./parking";
import type { ParkingPlace } from "./types";
import { eligibleSmsZone, payableZones } from "./zone-payment";

export const WIDGET_RADIUS_M = 150;
export const WIDGET_CHECK_MS = 15_000;
// The widget hides a zone older than 30 minutes, so an unchanged zone is re-stamped well before that.
export const WIDGET_RESTAMP_MS = 10 * 60_000;
export type ParkingWidgetState = { zone: string | null; detail: string; url: string | null; pay: string; open: string; empty: string };

/** The SMS zone the phone is in, else the nearest one a short walk away. Null without a usable fix. */
export function parkingWidgetState(fix: Fix, places: ParkingPlace[], language: Language, plate: string | null, scheme: string, now = Date.now()): ParkingWidgetState | null {
  if (!usableFix(fix, now) || fix.accuracy! > 100) return null;
  const t = (en: string, mk: string) => translate(language, en, mk);
  const labels = { pay: t("Pay", "Плати"), open: t("Open", "Отвори"), empty: t("No paid zone nearby", "Нема платена зона во близина") };
  // The dwell-checked zone settles overlaps; otherwise the nearest payable outline or point.
  const place = eligibleSmsZone(fix, places, plate, now) ?? payableZones(places, fix, now, 1, WIDGET_RADIUS_M)[0]?.place;
  if (!place?.smsPayment) return { zone: null, detail: "", url: null, ...labels };
  const price = parkingPrice(place, now);
  return {
    zone: place.zoneCode ?? place.smsPayment.zoneCode,
    detail: [placeName(place, language), price ? t("{price} MKD/h", "{price} MKD/ч").replace("{price}", String(price.firstHour)) : ""].filter(Boolean).join(" · "),
    url: `${scheme}://pay?place=${encodeURIComponent(place.id)}`,
    ...labels,
  };
}

/** Computes at most every 15 s and writes only a changed state (or a re-stamp of an old one). */
export function createWidgetWriter(write: (state: ParkingWidgetState & { at: number }) => void) {
  let last = "", writtenAt = -Infinity, checkedAt = -Infinity;
  return (compute: () => ParkingWidgetState | null, now = Date.now()) => {
    if (now - checkedAt < WIDGET_CHECK_MS) return false;
    checkedAt = now;
    const state = compute(), key = JSON.stringify(state);
    if (!state || (key === last && now - writtenAt < WIDGET_RESTAMP_MS)) return false;
    last = key; writtenAt = now;
    write({ ...state, at: now });
    return true;
  };
}

/** `<scheme>://pay?place=<id>` from the widget becomes the map's `pay` param; other links pass through. */
export function widgetPayPath(path: string): string | null {
  if (!/^(?:[a-z][a-z\d+.-]*:\/\/\/?|\/)pay\/?(?:[?#]|$)/i.test(path)) return null;
  try {
    const id = decodeURIComponent(/[?&]place=([^&#]*)/.exec(path)?.[1] ?? "");
    return id && id.length <= 200 ? `/?pay=${encodeURIComponent(id)}` : "/";
  } catch { return "/"; }
}
