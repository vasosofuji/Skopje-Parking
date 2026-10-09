import type { ParkingPlace } from "./types";

export function isPocSector(place: Pick<ParkingPlace, "kind" | "id" | "operator" | "zoneCode">): boolean {
  const code = place.zoneCode?.trim() ?? "";
  return place.kind === "zone" && (place.id.startsWith("poc:zone:") || /^POC\s*(?:0|O|1|I|2|II|X)$/i.test(code) || place.operator?.trim().toLowerCase() === "poc" && (!code || /^(?:0|O|1|I|2|II|X)$/i.test(code)));
}

/** Tariff areas must remain selectable even when their tiny polygons need street zoom. */
export function canInteractWithZone(_place: Pick<ParkingPlace, "kind" | "id" | "operator" | "zoneCode">, _zoom: number, _picking = false): boolean {
  return true;
}

/** Native overview framing uses .022 latitude degrees for the same zoom-15 view. */
export function nativeRegionZoom(latitudeDelta: number): number {
  return 15 + Math.log2(0.022 / Math.max(latitudeDelta, 0.000001));
}
