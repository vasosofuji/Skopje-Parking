import type { Fix } from "../domain/arrival";
import {
  startBrowserLocation,
  type LocationIssue,
} from "../domain/locationWatch";
export async function watchLocation(
  onFix: (fix: Fix) => void,
  onIssue: (issue: LocationIssue) => void,
  geolocation = globalThis.navigator?.geolocation,
) {
  return startBrowserLocation(
    geolocation,
    { onFix, onIssue },
    typeof window === "undefined" || window.isSecureContext,
  );
}

/** Browsers have no approximate-only permission to upgrade. */
export const requestPreciseLocation = async () => true;
