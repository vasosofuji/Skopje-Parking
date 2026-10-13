import { googleBasemapStyle } from "../domain/basemap-style";
import { translate, placeName } from "../domain/language";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View, Text } from "react-native";
import MapView, {
  Marker,
  Polygon,
  Polyline,
  Circle,
  type Region,
} from "react-native-maps";
import { canInteractWithZone, isPocSector, nativeRegionZoom } from "../domain/zone-interaction";
import { mapCameraDeltas, parkingSelectionDeltas } from "../domain/map-selection-camera";
import { groupParking } from "../domain/clusters";
import { MARKER_COLORS, parkingMarker } from "../domain/marker-appearance";
import { createOverlayTapGate } from "../domain/map-interactions";
import type { ParkingMapProps } from "./mapTypes";
export default function ParkingMap(props: ParkingMapProps) {
  const map = useRef<MapView>(null);
  const [overlayTaps] = useState(() => createOverlayTapGate());
  const callbacks = useRef(props);
  useEffect(() => {
    callbacks.current = props;
  }, [props]);
  const projectionVersion = useRef(0);
  const cameraMoving = useRef(false), reduceMotion = useRef(true);
  const [mapReady, setMapReady] = useState(false);
  const destinationKey = useRef(""), selectionKey = useRef("");
  const projectSelection = React.useCallback(async () => {
    const p = callbacks.current,
      revision = ++projectionVersion.current;
    if (!p.selectedId || !p.selectedAnchor || !map.current || cameraMoving.current) {
      p.onSelectedPosition?.(null);
      return;
    }
    try {
      const point = await map.current.pointForCoordinate(p.selectedAnchor);
      if (revision === projectionVersion.current && p.selectedId === callbacks.current.selectedId)
        callbacks.current.onSelectedPosition?.(point);
    } catch {
      if (revision === projectionVersion.current && p.selectedId === callbacks.current.selectedId)
        callbacks.current.onSelectedPosition?.(null);
    }
  }, []);
  const [region, setRegion] = useState<Region>({
    ...props.destination,
    ...mapCameraDeltas(props.cameraZoom),
  });
  const currentRegion = useRef(region);
  const moveCamera = React.useCallback((target: Region, animate = true) => {
    if (!map.current) return;
    projectionVersion.current++;
    callbacks.current.onSelectedPosition?.(null);
    const animated = animate && !reduceMotion.current;
    cameraMoving.current = animated;
    if (animated) map.current.animateToRegion(target, 450);
    else {
      // animateToRegion duration is ignored on iOS. This API explicitly skips
      // animation on both native providers and runs only after onMapReady.
      map.current.fitToCoordinates([
        { latitude: target.latitude - target.latitudeDelta / 2, longitude: target.longitude - target.longitudeDelta / 2 },
        { latitude: target.latitude + target.latitudeDelta / 2, longitude: target.longitude + target.longitudeDelta / 2 },
      ], { animated: false, edgePadding: { top: 0, right: 0, bottom: 0, left: 0 } });
      void projectSelection();
    }
  }, [projectSelection]);
  useEffect(() => {
    let active = true, changed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active && !changed) reduceMotion.current = value; }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => {
      changed = true; reduceMotion.current = value;
      if (value && cameraMoving.current) moveCamera(currentRegion.current, false);
    });
    return () => { active = false; subscription.remove(); };
  }, [moveCamera]);
  useEffect(() => {
    if (!mapReady) return;
    const key = `${props.destination.latitude},${props.destination.longitude}:${props.cameraRevision ?? 0}:${props.cameraZoom ?? 15}`;
    const selected = props.selectedId && props.selectedAnchor ? `${props.selectedId}:${props.selectedAnchor.latitude},${props.selectedAnchor.longitude}` : "";
    if (props.drawing && cameraMoving.current) moveCamera(currentRegion.current, false);
    if (key !== destinationKey.current) {
      const initial = !destinationKey.current;
      destinationKey.current = key;
      moveCamera({ ...props.destination, ...mapCameraDeltas(props.cameraZoom) }, !initial && !props.drawing);
    } else if (selected && selected !== selectionKey.current && !props.picking && !props.drawing) {
      const place = props.places.find(place => place.id === props.selectedId);
      const { latitudeDelta, longitudeDelta } = currentRegion.current;
      moveCamera({ ...props.selectedAnchor!, ...parkingSelectionDeltas(latitudeDelta, longitudeDelta, Boolean(place && isPocSector(place))) }, false);
    }
    selectionKey.current = selected;
  }, [
    props.destination,
    props.cameraRevision,
    props.cameraZoom,
    props.selectedId,
    props.selectedAnchor,
    props.places,
    props.drawing,
    props.picking,
    mapReady,
    moveCamera,
  ]);
  useEffect(() => {
    void projectSelection();
  }, [props.selectedId, props.selectedAnchor, projectSelection]);
  const visible = props.places.filter(
    (p) =>
      !isPocSector(p) && (props.showZones || p.kind !== "zone") &&
      Math.abs(p.coordinate.latitude - region.latitude) <
        region.latitudeDelta / 1.5 &&
      Math.abs(p.coordinate.longitude - region.longitude) <
        region.longitudeDelta / 1.5,
  );
  // Group dense pins into spatial cells; every facility stays reachable by zoom or the list.
  const step = region.latitudeDelta > 0.003 ? region.latitudeDelta / 5 : 0;
  const groups = groupParking(
    props.drawing ? [] : visible,
    step,
    step,
    props.selectedId,
    props.now,
    props.filtered,
  );
  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      initialRegion={region}
      onMapReady={() => setMapReady(true)}
      userInterfaceStyle={props.dark ? "dark" : "light"}
      mapPadding={{ bottom: 0, top: 0, left: 0, right: 0 }}
      moveOnMarkerPress={false}
      onRegionChange={(next) => {
        currentRegion.current = next;
        cameraMoving.current = true;
        projectionVersion.current++;
        props.onSelectedPosition?.(null);
      }}
      onRegionChangeComplete={(next) => {
        currentRegion.current = next;
        cameraMoving.current = false;
        setRegion(next);
        props.onCenterChange?.({
          latitude: next.latitude,
          longitude: next.longitude,
        });
        void projectSelection();
      }}
      onPanDrag={props.onPan}
      zoomControlEnabled={false}
      showsPointsOfInterests
      pointsOfInterestFilter={["cafe", "restaurant", "store", "bakery", "foodMarket"]}
      customMapStyle={googleBasemapStyle(Boolean(props.dark))}
      onPress={(event) => {
        if (overlayTaps.consume(event.nativeEvent.action, event.nativeEvent.coordinate)) return;
        if (props.picking) props.onPick(event.nativeEvent.coordinate);
        else props.onBlankPress?.();
      }}
    >
      {!props.drawing ? visible.filter((p) => p.geometry && (region.latitudeDelta < 0.007 || p.id === props.selectedId)).map((place) => (
        <Polygon key={"area:" + place.id}
          zIndex={1}
          coordinates={place.geometry!.coordinates[0].map(([longitude, latitude]) => ({ latitude, longitude }))}
          holes={place.geometry!.coordinates.slice(1).map((ring) => ring.map(([longitude, latitude]) => ({ latitude, longitude })))}
          strokeColor="#962E2B" fillColor={place.id === props.selectedId ? "#962E2B20" : "#962E2B0B"} strokeWidth={place.id === props.selectedId ? 2.5 : 1.5}
          tappable onPress={(event) => { const point = event.nativeEvent.coordinate ?? place.coordinate; overlayTaps.record(point); if (props.picking) props.onPick(point); else if (props.selectionEnabled !== false) props.onSelect(place, point); }}
        />
      )) : null}
      {props.showZones && !props.drawing
        ? props.places
            .filter((p) => isPocSector(p) && p.geometry)
            .map((place) => (
              <Polygon
                key={place.id}
                coordinates={place.geometry!.coordinates[0].map(
                  ([longitude, latitude]) => ({ latitude, longitude }),
                )}
                strokeColor="#527FBA"
                fillColor="rgba(82,127,186,0.035)"
                strokeWidth={1}
                lineDashPattern={[5, 5]}
                tappable={canInteractWithZone(place, nativeRegionZoom(region.latitudeDelta), props.picking)}
                onPress={(event) => {
                  if (!canInteractWithZone(place, nativeRegionZoom(currentRegion.current.latitudeDelta), callbacks.current.picking)) return;
                  overlayTaps.record(event.nativeEvent.coordinate ?? place.coordinate);
                  if (props.picking) {
                    if (event.nativeEvent.coordinate)
                      props.onPick(event.nativeEvent.coordinate);
                  } else if (props.selectionEnabled !== false)
                    props.onSelect(
                      place,
                      event.nativeEvent.coordinate ?? place.coordinate,
                    );
                }}
              />
            ))
        : null}
      {props.showZones && !props.drawing
        ? props.places
            .filter(
              (p) =>
                isPocSector(p) &&
                (region.latitudeDelta <= 0.044 || p.id === props.selectedId),
            )
            .map((p) => (
              <Marker
                key={"label:" + p.id}
                zIndex={p.id === props.selectedId ? 1100 : -500}
                coordinate={p.coordinate}
                accessibilityLabel={p.name}
                tappable={canInteractWithZone(p, nativeRegionZoom(region.latitudeDelta), props.picking)}
                onPress={() =>
                  props.picking
                    ? props.onPick(p.coordinate)
                    : props.selectionEnabled !== false && canInteractWithZone(p, nativeRegionZoom(currentRegion.current.latitudeDelta)) && props.onSelect(p)
                }
              >
                <View
                  style={[
                    s.pin,
                    { minHeight: 44, minWidth: 60, backgroundColor: "#fff", borderColor: "#527FBA" },
                  ]}
                >
                  <Text style={{ color: "#392c25", fontWeight: "700" }}>
                    {p.zoneCode}
                  </Text>
                </View>
              </Marker>
            ))
        : null}
      {groups.map((group) => {
        const key = group[0].id;
        const place = group.find((p) => p.id === props.selectedId) ?? group[0];
        const appearance = parkingMarker(place, group.length, props.now);
        return (
          <Marker
            key={key}
            coordinate={place.coordinate}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={
              place.id === props.selectedId
                ? 1000
                : appearance.spaces
                  ? 800
                  : 0
            }
            accessibilityLabel={placeName(place, props.language)}
            onPress={() => {
              if (props.picking) props.onPick(place.coordinate);
              else if (props.selectionEnabled === false) return;
              else if (
                group.length > 1 &&
                !group.some((p) => p.id === props.selectedId)
              ) {
                props.onPan?.();
                moveCamera(
                  {
                    ...place.coordinate,
                    latitudeDelta: region.latitudeDelta / 2,
                    longitudeDelta: region.longitudeDelta / 2,
                  },
                );
              } else props.onSelect(place);
            }}
          >
            <View style={s.markerFrame}>
              {appearance.spaces ? <View style={[s.halo, { backgroundColor: appearance.state }]} /> : null}
              {place.id === props.selectedId ? <View style={[s.ring, appearance.round ? { borderRadius: 22 } : null]} /> : null}
              <View
                style={[
                  s.face,
                  { backgroundColor: appearance.fill, borderColor: appearance.border },
                  appearance.hollow ? s.hollow : null,
                  appearance.round ? s.round : null,
                  appearance.spaces ? s.spaces : null,
                  appearance.cluster ? s.cluster : null,
                  place.id === props.selectedId ? s.selected : null,
                ]}
              >
                <Text style={[s.pinText, { color: appearance.text }, appearance.hollow ? { fontWeight: "700" } : null]}>
                  {appearance.label}
                </Text>
                {appearance.badge ? <View style={s.freeBadge}><Text style={s.freeBadgeText}>0</Text></View> : null}
              </View>
            </View>
          </Marker>
        );
      })}
      {(props.draftCoordinates?.length ?? 0) > 1 ? (
        <Polyline
          coordinates={props.draftCoordinates!}
          strokeColor="#962e2b"
          strokeWidth={3}
        />
      ) : null}
      {(props.draftCoordinates?.length ?? 0) > 2 ? (
        <Polygon
          coordinates={props.draftCoordinates!}
          strokeColor="#962e2b"
          fillColor="rgba(0,107,87,0.15)"
        />
      ) : null}
      {props.draftCoordinates?.map((point, i) => (
        <Marker
          key={"draft:" + i}
          coordinate={point}
          anchor={{ x: 0.5, y: 0.5 }}
          draggable={props.drawing}
          zIndex={3000}
          title={(translate(props.language, "Corner ", "Агол ")) + (i + 1)}
          onDragEnd={(event) =>
            props.onMoveVertex?.(i, event.nativeEvent.coordinate)
          }
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: "#962e2b",
              borderWidth: 2,
              borderColor: "#fff",
            }}
          />
        </Marker>
      ))}
      {!props.drawing &&
      (props.destinationMarker === undefined || props.destinationMarker) ? (
        <Marker
          coordinate={props.destinationMarker ?? props.destination}
          anchor={{ x: 0.5, y: 1 }}
          zIndex={2000}
          title={
            props.destinationName ??
            (translate(props.language, "Destination", "Дестинација"))
          }
        >
          <View style={s.destination}>
            <Text numberOfLines={1} style={s.destinationText}>
              {props.destinationName ??
                (translate(props.language, "Destination", "Дестинација"))}
            </Text>
            <View style={s.destinationDot} />
            <View style={s.destinationTip} />
          </View>
        </Marker>
      ) : null}
      {props.userLocation ? (
        <>
          {props.userAccuracy ? (
            <Circle
              center={props.userLocation}
              radius={props.userAccuracy}
              strokeColor="#3977D5"
              strokeWidth={1}
              fillColor="rgba(57,119,213,0.08)"
            />
          ) : null}
          <Marker
            coordinate={props.userLocation}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={1500}
          >
            <View style={s.userDot} />
          </Marker>
        </>
      ) : null}
    </MapView>
  );
}
const s = StyleSheet.create({
  markerFrame: { width: 60, height: 48, alignItems: "center", justifyContent: "center" },
  // Mirrors PARKING_PIN_CSS in marker-appearance.ts.
  face: { width: 28, height: 28, borderWidth: 2, borderRadius: 9, alignItems: "center", justifyContent: "center", shadowColor: "#1D1613", shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  hollow: { borderWidth: 1.5, shadowOpacity: 0.14 },
  round: { borderRadius: 16 },
  spaces: { width: 32, height: 32 },
  cluster: { width: undefined, minWidth: 30, height: 30, paddingHorizontal: 8, borderWidth: 1, borderRadius: 15 },
  selected: { transform: [{ scale: 1.18 }], shadowOpacity: 0.4 },
  ring: { position: "absolute", width: 42, height: 42, borderRadius: 14, borderWidth: 2.5, borderColor: "#1D1613" },
  halo: { position: "absolute", width: 44, height: 44, borderRadius: 22, opacity: 0.2 },
  freeBadge: { position: "absolute", right: -8, top: -7, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 2 },
  freeBadgeText: { color: MARKER_COLORS.free, fontSize: 10, fontWeight: "800" },
  pin: {
    minWidth: 28,
    height: 28,
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  pinText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  userDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#3977D5",
    borderColor: "#fff",
    borderWidth: 3,
  },
  destination: { alignItems: "center", maxWidth: 210 },
  destinationText: {
    color: "#8e1822",
    fontWeight: "700",
    fontSize: 12,
    backgroundColor: "#fff",
    padding: 7,
    borderRadius: 8,
    marginBottom: 4,
  },
  destinationDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#ce383e",
    borderWidth: 3,
    borderColor: "#fff",
  },
  destinationTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#ce383e",
    marginTop: -4,
  },
});
