import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type WidgetModule = { update(state: string): Promise<boolean> };
const native = Platform.OS === "android" ? requireOptionalNativeModule<WidgetModule>("SkopjeParkingWidget") : null;

/** Saves the home-screen widget state and redraws placed widgets. False without the native build. */
export async function updateParkingWidget(state: object): Promise<boolean> {
  if (!native) return false;
  try { return await native.update(JSON.stringify(state)); } catch { return false; }
}
