import * as Location from "expo-location";
import { Platform } from "react-native";
import {
  startNativeLocation,
  type LocationIssue,
} from "../domain/locationWatch";
import type { Fix } from "../domain/arrival";
// Google's "Location Accuracy" dialog may appear once per launch. GPS works without it, so a
// driver who declines must not see it again on every poll and watch restart.
let accuracyDialogOffered = false;
function offerAccuracyDialog() {
  const offer = !accuracyDialogOffered;
  accuracyDialogOffered = true;
  return offer;
}
/** Android 12+ shows its "use precise location" upgrade dialog for an app that has only approximate. */
export async function requestPreciseLocation() {
  const result = await Location.requestForegroundPermissionsAsync();
  return result.granted && result.android?.accuracy !== "coarse";
}
export async function watchLocation(
  onFix: (fix: Fix) => void,
  onIssue: (issue: LocationIssue) => void,
  onPrecision?: (precise: boolean) => void,
) {
  return startNativeLocation(
    {
      permission: Location.getForegroundPermissionsAsync,
      requestPermission: Location.requestForegroundPermissionsAsync,
      servicesEnabled: Location.hasServicesEnabledAsync,
      enableServices:
        Platform.OS === "android"
          ? Location.enableNetworkProviderAsync
          : undefined,
      cached: () =>
        Location.getLastKnownPositionAsync({
          maxAge: 15000,
          requiredAccuracy: 1000,
        }),
      current: () =>
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          mayShowUserSettingsDialog: offerAccuracyDialog(),
        }),
      watch: (success, failure) =>
        Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 1000,
            distanceInterval: 0,
            mayShowUserSettingsDialog: offerAccuracyDialog(),
          },
          success,
          failure,
        ),
    },
    { onFix, onIssue, onPrecision },
  );
}
