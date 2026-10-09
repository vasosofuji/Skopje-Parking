import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useTheme } from "../state/ThemeContext";
import { useParking } from "../state/ParkingContext";
import DrawerHandle from "./DrawerHandle";
import { Button } from "./ui";
export default function MapDrawer({
  expandRequest = 0,
  onDestination,
  onAdd,
  onDraw,
  onHeightChange,
  children,
}: {
  expandRequest?: number;
  onDestination: () => void;
  onAdd: () => void;
  onDraw: () => void;
  onHeightChange?: (height: number) => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme(),
    { t } = useParking(),
    { height } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState(180);
  const lip = 32, actions = 94;
  const expanded = Math.min(470, height * 0.65, actions + contentHeight);
  const stops = [lip, actions, expanded];
  const [dragging, setDragging] = useState(false);
  const [level, setLevel] = useState(1);
  const [visible] = useState(() => new Animated.Value(actions));
  const [expandedHeight] = useState(() => new Animated.Value(expanded));
  // Keep one attached animation graph while catalog updates re-render the map.
  // Replacing a subtraction node mid-spring can leave the web drawer stranded.
  const translateY = useMemo(() => Animated.subtract(expandedHeight, visible), [expandedHeight, visible]);
  const previousExpanded = useRef(expanded);
  const locateVisible = useRef(true);
  useEffect(() => {
    expandedHeight.setValue(expanded);
    if (previousExpanded.current !== expanded && level === 2) {
      visible.setValue(expanded);
      onHeightChange?.(expanded);
    }
    previousExpanded.current = expanded;
  }, [expanded, expandedHeight, level, visible, onHeightChange]);
  const gesture = useRef({ start: actions, current: actions });
  const snap = useCallback(
    (value: number, nextLevel: number) => {
      setDragging(false);
      setLevel(nextLevel);
      locateVisible.current = value <= 100;
      onHeightChange?.(value);
      Animated.spring(visible, {
        toValue: value,
        useNativeDriver: Platform.OS !== "web",
        tension: 120,
        friction: 22,
      }).start();
    },
    [visible, onHeightChange],
  );
  const previousRequest = useRef(expandRequest);
  useEffect(() => {
    if (expandRequest !== previousRequest.current) { previousRequest.current = expandRequest; snap(expanded, 2); }
  }, [expandRequest, expanded, snap]);
  const startDrag = useCallback(() => {
    setDragging(true);
    visible.stopAnimation((value) => {
      gesture.current = { start: value, current: value };
    });
  }, [visible]);
  const drag = useCallback((dy: number) => {
    gesture.current.current = Math.max(lip, Math.min(expanded, gesture.current.start - dy));
    visible.setValue(gesture.current.current);
    // Animate each movement without rerendering the map. Notify it only when
    // the location control crosses the visibility threshold.
    const showLocate = gesture.current.current <= 100;
    if (showLocate !== locateVisible.current) {
      locateVisible.current = showLocate;
      onHeightChange?.(gesture.current.current);
    }
  }, [expanded, visible, onHeightChange]);
  const endDrag = useCallback((velocity: number) => {
    const snapPoints = [lip, actions, expanded];
    const projected = gesture.current.current - velocity * 160;
    const next = snapPoints.reduce((best, value, i) =>
      Math.abs(value - projected) < Math.abs(snapPoints[best] - projected) ? i : best, 0);
    snap(snapPoints[next], next);
  }, [expanded, snap]);
  return (
    <View nativeID="parking-drawer-frame" pointerEvents="box-none" style={[s.frame, { height: expanded }]}>
      <Animated.View
        style={[
          s.drawer,
          {
            height: expanded,
            backgroundColor: colors.paper,
            borderColor: colors.line,
            transform: [{ translateY }],
          },
        ]}
      >
        <DrawerHandle
          open={level === 2}
          color={colors.muted}
          label={
            level === 0
              ? t("Show menu", "Покажи мени")
              : level === 1
                ? t("Expand menu", "Прошири мени")
                : t("Hide menu", "Скриј мени")
          }
          onToggle={() => {
            const next = (level + 1) % 3;
            snap(stops[next], next);
          }}
          onStart={startDrag}
          onDrag={drag}
          onEnd={endDrag}
        />
        <View
          pointerEvents={level === 0 && !dragging ? "none" : "auto"}
          aria-hidden={level === 0}
          accessibilityElementsHidden={level === 0}
          importantForAccessibility={
            level === 0 ? "no-hide-descendants" : "auto"
          }
          style={[s.actions, { paddingBottom: level === 2 ? 8 : 20, opacity: level === 0 ? 0 : 1 }]}
        >
          <Button
            style={s.flex}
            icon="map-pin"
            title={t("Destination", "Дестинација")}
            onPress={() => {
              snap(actions, 1);
              onDestination();
            }}
          />
          <Button
            style={s.flex}
            icon="plus"
            title={t("Add parking", "Додај паркинг")}
            variant="secondary"
            onPress={() => {
              snap(actions, 1);
              onAdd();
            }}
          />
        </View>
        <ScrollView
          pointerEvents={level === 2 ? "auto" : "none"}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          aria-hidden={level !== 2}
          accessibilityElementsHidden={level !== 2}
          importantForAccessibility={
            level === 2 ? "auto" : "no-hide-descendants"
          }
          style={{ flex: 1 }}
          contentContainerStyle={s.content}
          onContentSizeChange={(_, measured) => setContentHeight(measured)}
          keyboardShouldPersistTaps="handled"
        >
          <Button
            title={t("Draw a tariff zone", "Нацртај паркинг зона")}
            icon="edit-3"
            variant="secondary"
            onPress={() => {
              snap(actions, 1);
              onDraw();
            }}
          />
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}
const s = StyleSheet.create({
  frame: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1100,
    maxWidth: 560,
    alignSelf: "center",
    marginHorizontal: "auto",
    overflow: "hidden",
  },
  drawer: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    boxShadow: "0 -3px 18px #00000012",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 20,
  },
  flex: { flex: 1 },
  content: { padding: 14, paddingTop: 4, paddingBottom: 24, gap: 8 },
});
