import { translate, placeName } from "../domain/language";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { SKOPJE } from "../domain/parking";
import { canInteractWithZone, isPocSector } from "../domain/zone-interaction";
import { groupParking } from "../domain/clusters";
import { parkingMarker, parkingMarkerHtml } from "../domain/marker-appearance";
import type { ParkingMapProps } from "./mapTypes";
import { mapHtml } from "./offlineMapHtml";
import { dismissMapKeyboard } from "../../modules/skopje-parking-map-keyboard";
// The asset base lets the page read the bundled streets (file:///android_asset/offline-map/).
const BASE_URL = "file:///android_asset/";
const SOURCE = { html: mapHtml, baseUrl: BASE_URL };
const ORIGINS = ["*"];
export default function OpenStreetParkingMap(props: ParkingMapProps) {
  const web = useRef<WebView>(null);
  const callbacks = useRef(props);
  const mounted = useRef(false);
  useLayoutEffect(() => { callbacks.current = props; });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(15);
  const liveZoom = useRef(15);
  const [failed, setFailed] = useState(false);
  // Android may kill the WebView renderer (low memory, e.g. while navigating in another app).
  // A new WebView repeats the ready handshake and receives the current map state again.
  const [generation, setGeneration] = useState(0);
  const restart = () => { setReady(false); setGeneration(value => value + 1); };
  const payload = useMemo(() => {
    const longitudeStep = zoom < 18 ? (120 * 360) / (256 * 2 ** zoom) : 0;
    const latitudeStep =
      longitudeStep * Math.cos((SKOPJE.latitude * Math.PI) / 180);
    const pins = groupParking(
      props.drawing ? [] : props.places.filter(p => props.showZones || p.kind !== "zone"),
      latitudeStep,
      longitudeStep,
      props.selectedId,
      props.now,
      props.filtered,
    ).map((members) => {
      const place = members[0];
      const cluster = members.length > 1;
      const appearance = parkingMarker(place, members.length, props.now);
      return {
        id: place.id,
        point: [place.coordinate.latitude, place.coordinate.longitude],
        title:
          placeName(place, props.language),
        html: parkingMarkerHtml(appearance),
        cluster,
        selected: place.id === props.selectedId,
        spaces: appearance.spaces,
      };
    });
    return {
      pins,
      dark: props.dark,
      drawing: props.drawing,
      destinationName:
        props.destinationName ??
        (translate(props.language, "Destination", "Дестинација")),
      cornerLabel: translate(props.language, "Corner ", "Агол "),
      draft: (props.draftCoordinates ?? []).map((p) => [
        p.latitude,
        p.longitude,
      ]),
      zoneLabels:
        props.showZones && !props.drawing
          ? props.places
              .filter(
                (p) =>
                  isPocSector(p) &&
                  (zoom >= 14 || p.id === props.selectedId),
              )
              .map((p) => ({
                id: p.id,
                pocSector: isPocSector(p),
                point: [p.coordinate.latitude, p.coordinate.longitude],
                label: p.zoneCode ?? p.name,
                title: p.name,
                approximate: !p.geometry,
              }))
          : [],
      destinationMarker:
        props.destinationMarker === undefined
          ? [props.destination.latitude, props.destination.longitude]
          : props.destinationMarker
            ? [
                props.destinationMarker.latitude,
                props.destinationMarker.longitude,
              ]
            : null,
      footprints: !props.drawing ? props.places.filter((p) => !isPocSector(p) && (props.showZones || p.kind !== "zone") && p.geometry && (zoom >= 17 || p.id === props.selectedId)).map((p) => ({
        id: p.id, selected: p.id === props.selectedId,
        rings: p.geometry!.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng])),
      })) : [],
      zones:
        props.showZones && !props.drawing
          ? props.places
              .filter((p) => isPocSector(p) && p.geometry)
              .map((p) => ({
                id: p.id,
                pocSector: isPocSector(p),
                rings: p.geometry!.coordinates.map((ring) =>
                  ring.map(([lng, lat]) => [lat, lng]),
                ),
              }))
          : [],
      destination: [props.destination.latitude, props.destination.longitude],
      cameraRevision: props.cameraRevision,
      cameraZoom: props.cameraZoom,
      selectedId: props.selectedId,
      selectedPocSector: props.places.some(place => place.id === props.selectedId && isPocSector(place)),
      selectedAnchor: props.selectedAnchor
        ? [props.selectedAnchor.latitude, props.selectedAnchor.longitude]
        : null,
      selectionEnabled: props.selectionEnabled,
      picking: props.picking,
    };
  }, [
    props.dark,
    props.now,
    props.drawing,
    props.destinationName,
    props.draftCoordinates,
    props.destinationMarker,
    props.places,
    props.filtered,
    props.selectedId,
    props.selectedAnchor,
    props.selectionEnabled,
    props.language,
    props.showZones,
    props.destination,
    props.cameraRevision,
    props.cameraZoom,
    props.picking,
    zoom,
  ]);
  useEffect(() => {
    if (!ready) return;
    const serialized = JSON.stringify(payload).replace(/</g, "\\u003c");
    web.current?.injectJavaScript(
      `window.renderParking && window.renderParking(${serialized});true;`,
    );
  }, [payload, ready]);
  useEffect(() => {
    if (!ready) return;
    const point = props.userLocation ? [props.userLocation.latitude, props.userLocation.longitude] : null;
    web.current?.injectJavaScript(`window.updateUserLocation && window.updateUserLocation(${JSON.stringify(point)},${JSON.stringify(props.userAccuracy ?? null)});true;`);
  }, [ready, props.userLocation, props.userAccuracy]);
  function receive(event: WebViewMessageEvent) {
    let message;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    const sentAt = message.sentAt;
    const isCurrent = () => mounted.current && Number.isFinite(sentAt) && callbacks.current.isInteractionCurrent?.(sentAt) !== false;
    const interact = (action: (current: ParkingMapProps) => void) => {
      if (!isCurrent()) return;
      void dismissMapKeyboard().then(accepted => {
        // Search can regain focus while the native guard is in flight. Keep its
        // text/keyboard intact instead of forwarding an obsolete blank tap.
        if (accepted && isCurrent()) action(callbacks.current);
      });
    };
    if (message.type === "ready") setReady(true);
    if (
      message.type === "zoom" &&
      Number.isFinite(message.zoom) &&
      message.zoom >= 3 &&
      message.zoom <= 19
    ) {
      liveZoom.current = message.zoom;
      setZoom(message.zoom);
    }
    // Dragging can retain RN search focus. Record camera intent immediately so
    // a late initial GPS fix cannot recenter; a drag need not dismiss that IME.
    if (message.type === "pan" && isCurrent()) callbacks.current.onPan?.();
    if (message.type === "blank") interact(current => current.onBlankPress?.());
    if (message.type === "interaction") interact(() => {});
    if (message.type === "position") {
      if (message.selectionId !== props.selectedId) return;
      if (props.selectedAnchor && (message.anchor?.[0] !== props.selectedAnchor.latitude || message.anchor?.[1] !== props.selectedAnchor.longitude)) return;
      if (message.point === null) props.onSelectedPosition?.(null);
      else if (
        Number.isFinite(message.point?.x) &&
        Number.isFinite(message.point?.y)
      )
        props.onSelectedPosition?.(message.point);
    }
    if (
      message.type === "center" &&
      Number.isFinite(message.latitude) &&
      Number.isFinite(message.longitude)
    )
      props.onCenterChange?.({
        latitude: message.latitude,
        longitude: message.longitude,
      });
    if (message.type === "select") {
      const place = props.places.find((p) => p.id === message.id);
      if (place && props.selectionEnabled !== false) {
        interact(current => {
          if (current.selectionEnabled === false) return;
          const latest = current.places.find(p => p.id === place.id);
          if (!latest || !canInteractWithZone(latest, liveZoom.current, current.picking)) return;
          current.onSelect(
            latest,
            Number.isFinite(message.latitude) && Number.isFinite(message.longitude)
              ? { latitude: message.latitude, longitude: message.longitude }
              : latest.coordinate,
          );
        });
      }
    }
    if (
      (message.type === "pick" || message.type === "vertex") &&
      props.picking &&
      Number.isFinite(message.latitude) &&
      Number.isFinite(message.longitude) &&
      Math.abs(message.latitude) <= 90 &&
      Math.abs(message.longitude) <= 180
    ) {
      const point = {
        latitude: message.latitude,
        longitude: message.longitude,
      };
      if (message.type === "pick") interact(current => { if (current.picking) current.onPick(point); });
      else if (
        props.drawing &&
        Number.isInteger(message.index) &&
        message.index >= 0 &&
        message.index < (props.draftCoordinates?.length ?? 0)
      )
        interact(current => { if (current.picking && current.drawing && message.index < (current.draftCoordinates?.length ?? 0)) current.onMoveVertex?.(message.index, point); });
    }
  }
  return (
    <View style={styles.container}>
      <WebView
        key={generation}
        ref={web}
        style={styles.container}
        source={SOURCE}
        originWhitelist={ORIGINS}
        onMessage={receive}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        applicationNameForUserAgent="ParkSkopje-local-preview/1.0"
        allowFileAccessFromFileURLs
        onShouldStartLoadWithRequest={(request) =>
          request.url === "about:blank" || request.url === BASE_URL ||
          request.url.startsWith("data:text/html")
        }
        onError={() => setFailed(true)}
        onRenderProcessGone={restart}
        onContentProcessDidTerminate={restart}
      />
      {failed ? (
        <View style={styles.error}>
          <Text>
            {translate(props.language, "The map could not load. Check your connection.", "Мапата не може да се отвори. Проверете ја врската.")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ede2d0" },
  error: {
    position: "absolute",
    top: 70,
    left: 20,
    right: 20,
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 12,
  },
});
