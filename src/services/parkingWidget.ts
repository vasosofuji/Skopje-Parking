import Constants from "expo-constants";
import { updateParkingWidget } from "../../modules/skopje-parking-widget";
import type { Fix } from "../domain/arrival";
import type { Language } from "../domain/language";
import { createWidgetWriter, parkingWidgetState } from "../domain/parking-widget";
import type { ParkingPlace } from "../domain/types";

// Test builds register parkskopje-test://, so the widget links back into the same build.
const scheme = [Constants.expoConfig?.scheme ?? "parkskopje"].flat()[0];
const write = createWidgetWriter(state => { void updateParkingWidget(state); });

/** Called with every foreground and background fix; throttled and written only on change. */
export function showWidgetZone(fix: Fix, places: ParkingPlace[], language: Language, plate: string | null) {
  write(() => parkingWidgetState(fix, places, language, plate, scheme));
}
