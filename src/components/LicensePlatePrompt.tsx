import React from "react";
import { useParking } from "../state/ParkingContext";
import { useLicensePlate } from "../state/LicensePlateContext";
import { Sheet } from "./ui";
import LicensePlateEditor from "./LicensePlateEditor";

export default function LicensePlatePrompt() {
  const { t } = useParking(), { dismissPrompt, ready, offerPlate, accountId } = useLicensePlate();
  if (!ready || !offerPlate) return null;
  return <Sheet visible title={t("License plate (optional)", "Регистарска табличка (незадолжително)")} onClose={() => { void dismissPrompt().catch(() => {}); }}>
    <LicensePlateEditor key={accountId} optional onDone={() => {}} />
  </Sheet>;
}
