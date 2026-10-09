import { useState } from "react";
import { UNUSUAL_HOURLY_PRICE } from "../domain/progressive-entry";

/** A price above anything Skopje parking costs needs a second tap: it is usually 400 typed for 40. */
export function usePriceCheck(t: (en: string, mk: string) => string) {
  const [confirmed, setConfirmed] = useState("");
  return (values: (number | null)[], warn: (message: string) => void) => {
    const highest = Math.max(0, ...values.filter((value): value is number => typeof value === "number"));
    const key = values.join("/");
    if (highest <= UNUSUAL_HOURLY_PRICE || confirmed === key) return true;
    setConfirmed(key);
    warn(t("{price} MKD per hour is unusually high for Skopje. Check it, then tap again to save.", "{price} денари за час е невообичаено висока цена за Скопје. Проверете ја, па притиснете повторно за да зачувате.").replace("{price}", String(highest)));
    return false;
  };
}
