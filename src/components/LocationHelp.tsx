import React from "react";
import { Linking, Platform } from "react-native";
import { Button, Note, Sheet } from "./ui";
import { useParking } from "../state/ParkingContext";
import type { LocationIssue } from "../domain/locationWatch";
import { locationIssueAdvice, locationIssueTitle } from "../domain/locationIssue";
import { requestPreciseLocation } from "../services/location";
export default function LocationHelp({
  visible,
  issue,
  onClose,
  onRetry,
  permissions = false,
}: {
  visible: boolean;
  permissions?: boolean;
  issue: LocationIssue | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { t } = useParking();
  const message = locationIssueAdvice(issue, Platform.OS === "web", t);
  return (
    <Sheet
      visible={visible}
      title={permissions ? t("Location & notifications", "Локација и известувања") : locationIssueTitle(issue, t)}
      onClose={onClose}
      onBack={permissions ? onClose : undefined}
      backLabel={permissions ? t("Back", "Назад") : undefined}
    >
      <Note>{permissions ? Platform.OS === "web"
        ? t("Allow location in your browser’s site settings.", "Дозволете локација во поставките за страницата.")
        : t("Manage location and notifications in your phone’s app settings.", "Управувајте со локацијата и известувањата во поставките на апликацијата.") : message}</Note>
      {!permissions && issue?.detail ? <Note>{t("Provider details: ", "Детали од сервисот: ") + issue.detail}</Note> : null}
      {!permissions && issue?.code === "approximate" && Platform.OS !== "web" ? <Button
        title={t("Allow precise location", "Дозволи прецизна локација")}
        onPress={() => {
          // Without an upgrade dialog (declined twice), only the settings page can switch it.
          void requestPreciseLocation().then(precise => { if (!precise) return Linking.openSettings(); onClose(); onRetry(); }).catch(() => {});
        }}
      /> : null}
      {Platform.OS !== "web" ? (
        <Button
          title={t("Open settings", "Отвори поставки")}
          variant="secondary"
          onPress={() => {
            void Linking.openSettings().catch(() => {});
          }}
        />
      ) : null}
      <Button
        title={permissions ? t("Done", "Готово") : t("Try again", "Обиди се повторно")}
        onPress={() => {
          onClose();
          onRetry();
        }}
      />
    </Sheet>
  );
}
