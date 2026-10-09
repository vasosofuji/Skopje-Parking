import React, { useRef, useState } from "react";
import {
  Modal,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { termsParagraphs } from "../domain/terms";
import ModalBackdrop from "./ModalBackdrop";
import { IconButton } from "./ui";
import LoadingIndicator from "./LoadingIndicator";
import StepActions from "./StepActions";
export default function TermsConsent({
  busy,
  error,
  onClose,
  onAccept,
}: {
  busy: boolean;
  error: string;
  onClose: () => void;
  onAccept: () => void;
}) {
  const { t } = useParking(),
    { colors } = useTheme(),
    { height } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const [read, setRead] = useState(false);
  const measurements = useRef({ viewport: 0, content: 0 });
  function measure() {
    const m = measurements.current;
    if (m.viewport && m.content && m.content <= m.viewport + 4) setRead(true);
  }
  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
          paddingTop: Math.max(16, insets.top),
          paddingBottom: Math.max(16, insets.bottom),
        }}
      >
        <ModalBackdrop />
        <View
          accessibilityViewIsModal
          style={{
            height: Math.min(680, height - insets.top - insets.bottom - 32),
            width: "100%",
            maxWidth: 520,
            backgroundColor: colors.paper,
            borderRadius: 22,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              padding: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{
                flex: 1,
                fontSize: 20,
                fontWeight: "700",
                color: colors.ink,
              }}
            >
              {t("Terms and conditions", "Услови за користење")}
            </Text>
            <IconButton
              name="x"
              label={t("Back", "Назад")}
              disabled={busy}
              onPress={() => {
                if (!busy) onClose();
              }}
            />
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 20, gap: 20 }}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onLayout={(event) => {
              measurements.current.viewport = event.nativeEvent.layout.height;
              measure();
            }}
            onContentSizeChange={(_, h) => {
              measurements.current.content = h;
              measure();
            }}
            onScroll={(event) => {
              const e = event.nativeEvent;
              if (
                e.contentOffset.y + e.layoutMeasurement.height >=
                e.contentSize.height - 12
              )
                setRead(true);
            }}
          >
            {termsParagraphs(t).map((paragraph, i) => (
              <Text
                key={i}
                style={{ color: colors.ink, fontSize: 15, lineHeight: 23 }}
              >
                {paragraph}
              </Text>
            ))}
          </ScrollView>
          <View
            style={{
              padding: 16,
              gap: 8,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            {!read ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {t(
                  "Scroll to the end to continue",
                  "Дојдете до крајот за да продолжите",
                )}
              </Text>
            ) : null}
            {error ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.red }}
              >
                {error}
              </Text>
            ) : null}
            {busy ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <LoadingIndicator size="small" label="" />
                <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: colors.muted, fontSize: 12 }}>
                  {t(
                    "Connecting and saving. The server may take up to a minute to wake up. One tap is enough.",
                    "Се поврзуваме и зачувуваме. На серверот може да му треба до една минута да се активира. Доволен е еден допир.",
                  )}
                </Text>
              </View>
            ) : null}
            <StepActions
              title={
                busy
                  ? t("Please wait…", "Почекајте…")
                  : t("I accept and continue", "Прифаќам и продолжувам")
              }
              disabled={!read || busy}
              backDisabled={busy}
              onBack={onClose}
              onContinue={onAccept}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
