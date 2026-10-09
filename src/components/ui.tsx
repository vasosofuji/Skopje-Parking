import React, { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  View,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useTheme, lightColors, type ThemeColors } from "../state/ThemeContext";
import { useTranslate } from "../state/ParkingContext";
import ModalBackdrop from "./ModalBackdrop";
import { formRevealOffset } from "../domain/form-reveal";
import { ContributionNotice } from "../state/ContributionFeedback";
type HeaderBackAction = { onPress: () => void; label: string; disabled?: boolean };
const SheetBackContext = createContext<((action: HeaderBackAction | null) => void) | null>(null);
type ContinueAction = { onPress: () => void; title: string; disabled?: boolean };
const SheetContinueContext = createContext<((action: ContinueAction | null) => void) | null>(null);
type RevealReason = "open" | "resize" | "close";
const SheetRevealContext = createContext<((node: View, reason?: RevealReason) => void) | null>(null);
/** Attach to an expanded section so its fields are brought into the sheet viewport. */
export function useSheetReveal(active: unknown) {
  const reveal = useContext(SheetRevealContext), ref = useRef<View>(null);
  const onLayout = useCallback(() => { if (active && ref.current) reveal?.(ref.current, "resize"); }, [active, reveal]);
  useLayoutEffect(() => {
    if (!active) return;
    const node = ref.current;
    const frame = requestAnimationFrame(() => { if (node) reveal?.(node, "open"); });
    return () => { cancelAnimationFrame(frame); if (node) reveal?.(node, "close"); };
  }, [active, reveal]);
  return { ref, onLayout };
}
export function RevealSection({ active, children, style }: { active: unknown; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reveal = useSheetReveal(active);
  return <View {...reveal} collapsable={false} style={style}>{children}</View>;
}
function useFormViewport() {
  const scroll = useRef<ScrollView>(null), content = useRef<View>(null);
  const metrics = useRef({ offset: 0, viewport: 0, height: 0 });
  const activeSection = useRef<View | null>(null);
  const reveal = useCallback((node: View, reason: RevealReason = "resize") => {
    if (reason === "close") { if (activeSection.current === node) activeSection.current = null; return; }
    if (reason === "open") activeSection.current = node;
    else if (activeSection.current !== node) return;
    if (!content.current || !scroll.current) return;
    node.measureLayout(content.current, (_x, top, _width, sectionHeight) => {
      if (activeSection.current !== node) return;
      const current = metrics.current;
      const y = formRevealOffset(top, sectionHeight, current.offset, current.viewport, current.height, reason === "open");
      if (Math.abs(y - current.offset) > 1) {
        current.offset = y;
        scroll.current?.scrollTo({ y, animated: true });
      }
    }, () => {});
  }, []);
  return { scroll, content, reveal, events: {
    scrollEventThrottle: 16,
    onScrollBeginDrag: () => { activeSection.current = null; },
    onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => { metrics.current.offset = event.nativeEvent.contentOffset.y; },
    onLayout: (event: { nativeEvent: { layout: { height: number } } }) => { metrics.current.viewport = event.nativeEvent.layout.height; if (activeSection.current) reveal(activeSection.current); },
    onContentSizeChange: (_width: number, height: number) => { metrics.current.height = height; if (activeSection.current) reveal(activeSection.current); },
  } };
}
/** Give standalone forms the same section-reveal behavior as sheets. */
export function FormScrollView({ children, contentContainerStyle, ...props }: React.ComponentProps<typeof ScrollView>) {
  const { scroll, content, reveal, events } = useFormViewport();
  return <SheetRevealContext.Provider value={reveal}>
    <ScrollView {...props} ref={scroll} {...events}>
      <View ref={content} collapsable={false} style={contentContainerStyle}>{children}</View>
    </ScrollView>
  </SheetRevealContext.Provider>;
}
/** Keep step actions outside the scrolling form, including above the keyboard. */
export function useSheetContinue(action: ContinueAction | null) {
  const register = useContext(SheetContinueContext), current = useRef(action);
  useLayoutEffect(() => { current.current = action; });
  const active = Boolean(action), title = action?.title, disabled = action?.disabled;
  useLayoutEffect(() => {
    register?.(active ? { onPress: () => current.current?.onPress(), title: title!, disabled } : null);
    return () => register?.(null);
  }, [register, active, title, disabled]);
  return Boolean(register);
}
/** Register the active form's Back action without moving it into the scrollable body. */
export function useSheetBack(action: HeaderBackAction) {
  const register = useContext(SheetBackContext), current = useRef(action);
  useLayoutEffect(() => { current.current = action; });
  useLayoutEffect(() => {
    register?.({ onPress: () => current.current.onPress(), label: action.label, disabled: action.disabled });
    return () => register?.(null);
  }, [register, action.label, action.disabled]);
}
export const colors = lightColors;
export type IconName = React.ComponentProps<typeof Feather>["name"];
export function Icon({
  name,
  size = 20,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const { colors } = useTheme();
  return <Feather name={name} size={size} color={color ?? colors.ink} />;
}
export function Button({
  title,
  onPress,
  icon,
  variant = "primary",
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const s = styles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === "primary"
          ? s.primary
          : variant === "danger"
            ? s.danger
            : s.secondary,
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          color={
            variant === "primary"
              ? "#fff"
              : variant === "danger"
                ? colors.red
                : colors.ink
          }
        />
      ) : null}
      <Text
        style={[
          s.buttonText,
          {
            color:
              variant === "primary"
                ? "#fff"
                : variant === "danger"
                  ? colors.red
                  : colors.ink,
          },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  name,
  label,
  onPress,
  disabled,
  compact = false,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const s = styles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      hitSlop={name === "x" || compact ? 6 : 2}
      style={[s.iconButton, (name === "x" || compact) && s.closeButton, disabled && { opacity: 0.45 }]}
    >
      <Icon name={name} size={name === "x" ? 16 : 20} />
    </Pressable>
  );
}
export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
  onDismiss,
  onShow,
  onBack,
  backLabel,
  backDisabled,
  fullPage = false,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onDismiss?: () => void;
  onShow?: () => void;
  onBack?: () => void;
  backLabel?: string;
  backDisabled?: boolean;
  fullPage?: boolean;
}) {
  const { colors } = useTheme();
  const t = useTranslate();
  const s = styles(colors);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [registeredBack, registerBack] = useState<HeaderBackAction | null>(null);
  const [registeredContinue, registerContinue] = useState<ContinueAction | null>(null);
  const { scroll, content, reveal, events } = useFormViewport();
  const back = registeredBack ?? (onBack ? { onPress: onBack, label: backLabel ?? t("Back", "Назад"), disabled: backDisabled } : null);
  return (
    <SheetBackContext.Provider value={registerBack}>
    <SheetContinueContext.Provider value={registerContinue}>
    <SheetRevealContext.Provider value={reveal}>
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={fullPage && back ? () => { if (!back.disabled) back.onPress(); } : onClose}
      onDismiss={onDismiss}
      onShow={onShow}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[
          s.overlay,
          {
            paddingTop: fullPage ? insets.top : Math.max(12, insets.top),
            paddingBottom: fullPage ? insets.bottom : Math.max(12, insets.bottom),
            ...(fullPage ? { paddingHorizontal: 0, paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: colors.paper } : {}),
          },
        ]}
      >
        {!fullPage ? <ModalBackdrop /> : null}
        {!fullPage ? <Pressable
          accessibilityLabel={t("Close dialog", "Затвори прозорец")}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        /> : null}
        <View
          accessibilityViewIsModal
          style={[
            s.sheet,
            {
              maxHeight:
                height - Math.max(12, insets.top) - Math.max(12, insets.bottom),
            },
            fullPage && { flex: 1, maxHeight: undefined, maxWidth: undefined, borderRadius: 0, borderWidth: 0 },
          ]}
        >
          <View style={s.sheetTop}>
            {fullPage ? <View style={{ width: 44 }}>{back ? <IconButton name="arrow-left" label={back.label} disabled={back.disabled} onPress={back.onPress} /> : null}</View> : null}
            <Text accessibilityRole="header" style={[s.sheetTitle, fullPage && { textAlign: "center" }]}>
              {title}
            </Text>
            {!fullPage && back && !registeredContinue ? <IconButton name="arrow-left" compact label={back.label} disabled={back.disabled} onPress={back.onPress} /> : null}
            <View style={fullPage ? { width: 44, alignItems: "center" } : undefined}><IconButton name="x" label={t("Close", "Затвори")} onPress={onClose} /></View>
          </View>
          <ScrollView
            ref={scroll}
            {...events}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            bounces={false}
            style={fullPage ? { flex: 1 } : { flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <View ref={content} collapsable={false} style={[s.sheetContent, fullPage && { width: "100%", maxWidth: 680, alignSelf: "center", gap: 20, paddingBottom: 28 }]}>{children}</View>
          </ScrollView>
          {registeredContinue ? <View style={[s.sheetFooter, { flexDirection: "row", gap: 12 }]}>
            {back ? <Button style={{ flex: 1, minHeight: 52 }} title={back.label} variant="secondary" disabled={back.disabled} onPress={back.onPress} /> : null}
            <Button style={{ flex: 1.6, minHeight: 52 }} title={registeredContinue.title} disabled={registeredContinue.disabled} onPress={registeredContinue.onPress} />
          </View> : footer ? <View style={s.sheetFooter}>{footer}</View> : null}
        </View>
        <ContributionNotice />
      </KeyboardAvoidingView>
    </Modal>
    </SheetRevealContext.Provider>
    </SheetContinueContext.Provider>
    </SheetBackContext.Provider>
  );
}
export function Note({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const s = styles(colors);
  return <Text style={s.note}>{children}</Text>;
}
const styles = (colors: ThemeColors) =>
  StyleSheet.create({
    button: {
      minWidth: 0,
      minHeight: 44,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    primary: { backgroundColor: colors.green },
    secondary: { backgroundColor: colors.mint },
    danger: { backgroundColor: "#FBEDEC" },
    buttonText: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "center" },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.mint,
      alignItems: "center",
      justifyContent: "center",
    },
    closeButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: "transparent" },
    overlay: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 16,
    },
    sheet: {
      backgroundColor: colors.paper,
      borderRadius: 18,
      width: "100%",
      maxWidth: 520,
      flexShrink: 1,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.line,
    },
    sheetTop: {
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    sheetTitle: { flex: 1, fontWeight: "700", fontSize: 18, color: colors.ink },
    sheetContent: { padding: 16, gap: 10 },
    sheetFooter: {
      padding: 12,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      gap: 6,
    },
    note: { fontSize: 13, lineHeight: 20, color: colors.muted },
  });
