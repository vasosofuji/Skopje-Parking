import { useEffect } from "react";
import { router, useRootNavigationState } from "expo-router";
import { listenForPlaceNotifications } from "../services/placeNotifications";
import { watchSpotOpenings } from "../services/spotOpenings";

/** Routes tapped destination and spot pushes to the map, and shares this driver's paid parking end. */
export function usePlaceNotifications(signedIn: boolean) {
  const navigation = useRootNavigationState();
  useEffect(() => {
    if (!signedIn || !navigation?.key) return;
    const stopRouting = listenForPlaceNotifications(placeId => router.navigate({ pathname: "/", params: { placeId } }));
    const stopSharing = watchSpotOpenings();
    return () => { stopRouting(); stopSharing(); };
  }, [signedIn, navigation?.key]);
}
