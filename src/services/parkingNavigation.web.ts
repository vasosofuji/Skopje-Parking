import type { ParkingPlace } from "../domain/types";
import { directionUrls, type NavigationApp } from "../domain/navigation";
import { startDestinationAlerts, stopDestinationAlerts } from "./destinationAlerts";

export async function navigateToParking(place: ParkingPlace, language: "en" | "mk", preference: NavigationApp) {
  const url = directionUrls(preference, "web", place.coordinate)[0];
  // Reserve the navigation tab inside the click so permission/network awaits cannot block it.
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new Error("Allow pop-ups for Parking to open directions.");
  tab.opener = null;
  let notice = "";
  try { await startDestinationAlerts(place, language); }
  catch (error) { notice = error instanceof Error ? error.message : "Destination notifications could not be enabled."; }
  if (tab.closed) { await stopDestinationAlerts().catch(() => {}); throw new Error("The navigation tab was closed. Tap Go to try again."); }
  tab.location.href = url;
  return notice;
}
