import type { Fix } from "./arrival";
import { placeName, translate, type Language } from "./language";
import { usableFix } from "./location";
import { parkingPrice } from "./parking";
import type { ParkingPlace } from "./types";
import { smsZoneChoices } from "./zone-payment";

export const WIDGET_CHECK_MS = 15_000;
// The widget hides a zone older than 30 minutes, so an unchanged zone is re-stamped well before that.
export const WIDGET_RESTAMP_MS = 10 * 60_000;
export type ParkingWidgetState = { zone: string | null; detail: string; url: string | null; pay: string; open: string; empty: string };

/**
 * The zone the app's quick pay would offer here (smsZoneChoices: never a street zone inside a parking lot,
 * nothing while moving). Several similarly close zones name none: they are listed and Pay opens the chooser.
 * Null without a usable fix.
 */
export function parkingWidgetState(fix: Fix, places: ParkingPlace[], language: Language, scheme: string, now = Date.now()): ParkingWidgetState | null {
  if (!usableFix(fix, now) || fix.accuracy! > 100) return null;
  const t = (en: string, mk: string) => translate(language, en, mk);
  const labels = { pay: t("Pay", "Плати"), open: t("Open", "Отвори"), empty: t("No paid zone nearby", "Нема платена зона во близина") };
  const choices = smsZoneChoices(fix, places, now), place = choices[0];
  if (choices.length > 1) return { zone: choices.map(choice => choice.zoneCode ?? choice.smsPayment!.zoneCode).join(" · "), detail: t("Which zone is on the sign?", "Која зона е на знакот?"), url: `${scheme}://pay`, ...labels };
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

/**
 * `<scheme>://pay?place=<id>` from the widget becomes the map's `pay` param; other links pass through.
 * `<scheme>://pay` without a place (several zones) becomes `pay=choose`, which no place matches: the chooser.
 */
export function widgetPayPath(path: string): string | null {
  if (!/^(?:[a-z][a-z\d+.-]*:\/\/\/?|\/)pay\/?(?:[?#]|$)/i.test(path)) return null;
  const place = /[?&]place=([^&#]*)/.exec(path);
  if (!place) return "/?pay=choose";
  try {
    const id = decodeURIComponent(place[1]);
    return id && id.length <= 200 ? `/?pay=${encodeURIComponent(id)}` : "/";
  } catch { return "/"; }
}
