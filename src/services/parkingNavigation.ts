import type { ParkingPlace } from "../domain/types";
import { startDestinationAlerts, stopDestinationAlerts } from "./destinationAlerts";
import { openParkingDirections } from "./navigation";
import type { NavigationApp } from "../domain/navigation";

export async function navigateToParking(place: ParkingPlace, language: "en" | "mk", _preference: NavigationApp) {
  let notice = "";
  try { await startDestinationAlerts(place, language); }
  catch (error) { notice = error instanceof Error ? error.message : "Destination notifications could not be enabled."; }
  try { await openParkingDirections(place.coordinate); }
  catch (error) { await stopDestinationAlerts().catch(() => {}); throw error; }
  return notice;
}
