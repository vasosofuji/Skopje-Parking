import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as SMS from "expo-sms";
import { smsDraftUri, validSmsDraft } from "../domain/license-plate";

export type SmsComposerResult = "opened" | "cancelled" | "unsupported" | "error";
/** Opens a reviewable composer only. None of these results confirm parking payment. */
export async function openSmsComposer(recipient: string, message: string, beforeOpen: () => boolean = () => true): Promise<SmsComposerResult> {
  if (!validSmsDraft(recipient, message)) return "error";
  try {
    if (Platform.OS === "web") {
      const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
      if (!/Android|iPhone|iPod/i.test(agent)) return "unsupported";
      const uri = smsDraftUri(recipient, message, /iPhone|iPod/i.test(agent));
      if (!uri || !beforeOpen()) return "cancelled";
      await Linking.openURL(uri);
      return "opened";
    }
    if (!await SMS.isAvailableAsync()) return "unsupported";
    if (!beforeOpen()) return "cancelled";
    const result = await SMS.sendSMSAsync(recipient, message);
    return result.result === "cancelled" ? "cancelled" : "opened";
  } catch { return "error"; }
}
