import { matchesParkingFilter, matchesParkingFilters, toggleParkingFilter, filteredParkingRows, type ActiveParkingFilter } from "../domain/parking-filters";
import { placeName } from "../domain/language";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ParkingMap from "../components/ParkingMap";
import MapCredit from "../components/MapCredit";
import MapDrawer from "../components/MapDrawer";
import LocationHelp from "../components/LocationHelp";
import LoadingIndicator from "../components/LoadingIndicator";
import ParkingPreview from "../components/ParkingPreview";
import { router, useIsFocused } from "expo-router";
import { useMapSettingsLocation } from "../state/SettingsLocationContext";
import { useLicensePlate } from "../state/LicensePlateContext";
import { useZonePayment } from "../hooks/useZonePayment";
import { usePriceCheck } from "../hooks/usePriceCheck";
import ZonePaymentSheet, { ParkingSmsStopSheet, PayParkingChooser } from "../components/ZonePaymentSheet";
import { useTheme, type ThemeColors } from "../state/ThemeContext";
import { zoneGeometry, validZone, MAX_BOUNDARY_VERTICES } from "../domain/geometry";
import { containsParkingFix, distanceToParkingBoundary, insidePolygon } from "../domain/arrival";
import { canAddAtLocation, nearbyOrigin, usableFix } from "../domain/location";
import ParkingRow from "../components/ParkingRow";
import ParkingDetails from "../components/ParkingDetails";
import ProposalSheet from "../components/ProposalSheet";
import { Button, Icon, IconButton, Note, RevealSection, Sheet } from "../components/ui";
import {
  distanceMeters,
  normalizeZoneCode,
  rankParking,
  searchText,
  SKOPJE,
} from "../domain/parking";
import type {
  Coordinate,
  Destination,
  ParkingPlace,
  Geometry,
  ParkingKind,
} from "../domain/types";
import { useParking } from "../state/ParkingContext";
import { useArrival } from "../hooks/useArrival";
import { useMapNavigationState } from "../hooks/useMapNavigationState";
import { locationIssueTitle } from "../domain/locationIssue";
import { api } from "../services/api";
import { MARKER_COLORS } from "../domain/marker-appearance";
import { arrivalQuestion } from "../domain/report-feedback";
import { useContributionFeedback } from "../state/ContributionFeedback";
import { usePocCards } from "../hooks/usePocCards";
import { eligibleSmsZone, payableZones } from "../domain/zone-payment";
import { isVerifiedSmsPayment, smsZoneMatches } from "../domain/sms-payment";
import { CURRENT_LOCATION_ZOOM } from "../domain/map-selection-camera";
import PocCardSuggestion from "../components/PocCardSuggestion";

type NewParking = {
  coordinate: Coordinate;
  geometry?: Geometry;
  accuracy?: number;
  zoneCode?: string;
  kind?: ParkingKind;
};
function payablePlace(id: string, places: ParkingPlace[]) {
  const place = places.find(value => value.id === id);
  return place?.smsPayment && place.access !== "restricted" && isVerifiedSmsPayment(place.smsPayment) && smsZoneMatches(place.zoneCode, place.smsPayment.zoneCode) ? place : null;
}
export default function MapScreen() {
  const { colors, dark } = useTheme(),
    s = styles(colors);
  const { catalog, connected, language, t, refresh, now } = useParking();
  const { thankYou } = useContributionFeedback();
  const focused = useIsFocused();
  const licensePlate = useLicensePlate();
  const gps = useArrival(catalog.places, licensePlate.accountId);
  const pocCards = usePocCards(licensePlate.accountId, catalog.places, gps.location, focused);
  const [stopSms, setStopSms] = useState(false);
  const checkPrice = usePriceCheck(t);
  const [payChooser, setPayChooser] = useState<Coordinate | null>(null), [manualPayId, setManualPayId] = useState<string | null>(null);
  const navigationState = useMapNavigationState(licensePlate.accountId);
  const { sort, setSort, destination, setDestination, center, setCenter, selected: savedSelected, setSelected, anchor, setAnchor, parkingFilters, setParkingFilters, rememberViewport } = navigationState;
  const selected = catalog.places.some(place => place.id === savedSelected) ? savedSelected : null;
  const [cameraRevision, setCameraRevision] = useState(0);
  const [cameraZoom, setCameraZoom] = useState(15);
  const pendingNearMe = useRef(false);
  const viewport = useRef<Coordinate>(SKOPJE),
    cameraMoved = useRef(false);
  const cameraSession = useRef({ accountId: licensePlate.accountId, hydrated: false });
  const [draft, setDraft] = useState<Coordinate[]>([]);
  const [editingBoundary, setEditingBoundary] = useState<string | null>(null);
  const editingPerimeter = Boolean(editingBoundary && catalog.places.find((p) => p.id === editingBoundary)?.kind !== "zone");
  const [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false);
  const searchInput = useRef<TextInput>(null);
  const latestSearchFocus = useRef(0);
  const [remote, setRemote] = useState<Destination[]>([]),
    searchVersion = useRef(0);
  const [selectedPoint, setSelectedPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [detailsGeometry, setDetailsGeometry] = useState<{ id: string; geometry: Geometry } | null>(null);
  const [detailsEditing, setDetailsEditing] = useState(false);
  const [locationHelp, setLocationHelp] = useState(false);
  const [parkingTypesExpanded, setParkingTypesExpanded] = useState(false);
  const hasFilters = parkingFilters.length > 0;
  const [visibleMatches, setVisibleMatches] = useState(30);
  const [expandResults, setExpandResults] = useState(0);
  const [legend, setLegend] = useState(false);
  const [picking, setPicking] = useState<"destination" | "zone" | null>(null);
  const [proposal, setProposal] = useState<NewParking | null>(null);
  const [message, setMessage] = useState(""),
    [sending, setSending] = useState(false);
  const [locationDismissed, setLocationDismissed] = useState<string | null>(
      null,
    ),
    [locationRequest, setLocationRequest] = useState("");
  const [mapHeight, setMapHeight] = useState(700),
    [drawerHeight, setDrawerHeight] = useState(94);
  const [drawerRevision, setDrawerRevision] = useState(0);
  const [followupId, setFollowupId] = useState<string | null>(null);
  const [followupFromNotification, setFollowupFromNotification] = useState(false);
  const [notificationClosing, setNotificationClosing] = useState(false);
  const [arrivalPaid, setArrivalPaid] = useState(false),
    [arrivalPrice, setArrivalPrice] = useState("");
  const target = nearbyOrigin(
    destination?.coordinate ?? null,
    gps.location,
    Math.max(now, gps.location?.timestamp ?? now),
  );
  const filterOptions: { id: ActiveParkingFilter; color: string; symbol: string; label: string }[] = [
    { id: "free", color: MARKER_COLORS.free, symbol: "0", label: t("Free of charge", "Бесплатно") },
    { id: "reviewed", color: MARKER_COLORS.normal, symbol: "P", label: t("Reviewed parking", "Проверени паркинзи") },
    { id: "unreviewed", color: MARKER_COLORS.needsInfo, symbol: "?", label: t("Unreviewed parking", "Непроверени паркинзи") },
    { id: "spaces", color: MARKER_COLORS.spaces, symbol: "✓", label: t("Spaces recently reported", "Неодамна пријавени слободни места") },
    { id: "full", color: MARKER_COLORS.full, symbol: "×", label: t("Recently reported full", "Неодамна пријавен полн паркинг") },
    { id: "surface", color: MARKER_COLORS.normal, symbol: "P", label: t("Surface parking", "Отворен паркинг") },
    { id: "garage", color: MARKER_COLORS.normal, symbol: "G", label: t("Garages", "Катни гаражи") },
    { id: "underground", color: MARKER_COLORS.normal, symbol: "U", label: t("Underground parking", "Подземен паркинг") },
    { id: "street", color: MARKER_COLORS.normal, symbol: "S", label: t("Street parking", "Уличен паркинг") },
    { id: "zone", color: MARKER_COLORS.normal, symbol: "Z", label: t("Parking zones", "Паркинг зони") },
  ];
  const filteredPlaces = useMemo(() => catalog.places.filter(place => matchesParkingFilters(place, parkingFilters, now)), [catalog.places, parkingFilters, now]);
  const filterCounts = useMemo(() => Object.fromEntries((["all", "free", "reviewed", "unreviewed", "spaces", "full", "surface", "garage", "underground", "street", "zone"] as const).map(filter => [filter, catalog.places.filter(place => matchesParkingFilter(place, filter, now)).length])), [catalog.places, now]);
  const rows = useMemo(
    () =>
      hasFilters ? filteredParkingRows(filteredPlaces, target ?? center, now) : target ? rankParking(catalog.places, target, 60, 1500, sort, now) : [],
    [catalog.places, filteredPlaces, hasFilters, target, center, sort, now],
  );
  const selectedPlace = catalog.places.find((place) => place.id === selected);
  // Drivers who find a lot full usually leave before the 10-second arrival prompt, so a
  // precise fix at the parking also allows a direct report from its popup.
  const fix = gps.location;
  // GPS fades underground and inside garages just as drivers arrive, so there a precise fix
  // from the last 10 minutes still places them at the parking.
  const reportFix = fix && fix.accuracy !== null && fix.accuracy <= 50 ? fix
    : (selectedPlace?.kind === "underground" || selectedPlace?.kind === "garage") && gps.lastPrecise && now - gps.lastPrecise.timestamp <= 10 * 60_000 ? gps.lastPrecise : null;
  const atSelected = Boolean(selectedPlace && reportFix && selectedPlace.kind !== "zone" && selectedPlace.access !== "restricted" &&
    selectedPlace.capacity !== 0 &&
    (selectedPlace.geometry ? insidePolygon(reportFix, selectedPlace.geometry) || distanceToParkingBoundary(reportFix, selectedPlace.geometry) <= 150
      : distanceMeters(reportFix, selectedPlace.coordinate) <= 150));
  const followupPlace = catalog.places.find((place) => place.id === followupId);
  // GPS may hold a snapshot from before the driver or someone else added a tariff.
  const arrivalPlace = followupPlace ?? (gps.arrival ? catalog.places.find(place => place.id === gps.arrival!.id) ?? gps.arrival : null);
  const question = arrivalQuestion(arrivalPlace, Boolean(followupPlace), now);
  const notificationPriority = gps.arrivalFromNotification || followupFromNotification;
  const suspendSheets = !focused || licensePlate.offerPlate || notificationPriority || notificationClosing;
  const arrivalVisible = focused && !licensePlate.offerPlate && Boolean(question) && (notificationPriority || (!selected && !detailsId && !legend && !proposal && !picking && !locationHelp));
  const paymentBlocked = !licensePlate.ready || licensePlate.offerPlate || Boolean(arrivalPlace) || notificationClosing || notificationPriority || sending || Boolean(selected || detailsId || legend || proposal || picking || locationHelp || stopSms || licensePlate.pendingStop || payChooser || manualPayId);
  const payment = useZonePayment({ places: catalog.places, fix: gps.location, plate: licensePlate.savedPlate, scope: licensePlate.accountId, focused, blocked: paymentBlocked });
  const mapBlockedBySheet = suspendSheets || arrivalVisible || Boolean(payment.place || payChooser || manualPayId) || stopSms || legend || locationHelp || (!picking && Boolean(detailsId || proposal));
  // The driver picks the zone from the sign, so manual payment needs no GPS dwell; the
  // protocol must still be verified and unchanged at send time.
  const latestPlaces = useRef(catalog.places);
  useLayoutEffect(() => { latestPlaces.current = catalog.places; });
  const manualValidate = useCallback((id: string, places?: ParkingPlace[]) => payablePlace(id, places ?? latestPlaces.current), []);
  // The context clock ticks slowly; a fix newer than it is still fresh.
  const payOrigin = fix && usableFix(fix, Math.max(now, fix.timestamp)) && fix.accuracy! <= 100 ? fix : center;
  const payNearby = useMemo(() => payableZones(catalog.places, payOrigin, now, 1, 1500).length > 0, [catalog.places, payOrigin, now]);
  const clearSelection = useCallback(() => {
    setSelected(null);
    setAnchor(null);
    setSelectedPoint(null);
  }, [setSelected, setAnchor]);
  const select = useCallback((place: ParkingPlace, coordinate?: Coordinate) => {
    pendingNearMe.current = false;
    cameraMoved.current = true;
    searchInput.current?.blur();
    Keyboard.dismiss();
    searchVersion.current++;
    setQuery(""); setRemote([]); setSearching(false);
    const nextAnchor = coordinate ?? place.coordinate;
    if (place.id !== selected || anchor?.latitude !== nextAnchor.latitude || anchor?.longitude !== nextAnchor.longitude) setSelectedPoint(null);
    setSelected(place.id);
    setAnchor(nextAnchor);
  }, [selected, anchor, setSelected, setAnchor]);
  function blankMap() {
    searchInput.current?.blur();
    Keyboard.dismiss();
    clearSearch();
    clearSelection();
  }
  const projectSelection = useCallback(
    (point: { x: number; y: number } | null) => {
      setSelectedPoint((previous) =>
        previous?.x === point?.x && previous?.y === point?.y ? previous : point,
      );
    },
    [],
  );
  const centerChanged = useCallback((point: Coordinate) => {
    viewport.current = point;
    if (cameraMoved.current) rememberViewport(point);
  }, [rememberViewport]);
  const pan = useCallback(() => {
    pendingNearMe.current = false;
    cameraMoved.current = true;
  }, []);
  useEffect(() => {
    if (cameraSession.current.accountId !== licensePlate.accountId) {
      cameraSession.current = { accountId: licensePlate.accountId, hydrated: false };
      cameraMoved.current = false;
      pendingNearMe.current = false;
      setCameraZoom(15);
      viewport.current = SKOPJE;
    }
    if (navigationState.ready && !cameraSession.current.hydrated) {
      cameraSession.current.hydrated = true;
      if (navigationState.restored) {
        cameraMoved.current = true;
        viewport.current = navigationState.viewport;
      }
    }
  }, [licensePlate.accountId, navigationState.ready, navigationState.restored, navigationState.viewport]);
  useEffect(() => {
    if (navigationState.ready && gps.initialLocation && !cameraMoved.current) {
      setCenter(gps.initialLocation);
      viewport.current = gps.initialLocation;
    }
  }, [gps.initialLocation, navigationState.ready, setCenter]);
  useEffect(() => {
    if (!pendingNearMe.current || !navigationState.ready) return;
    const point = nearbyOrigin(null, gps.location);
    if (!point) return;
    const timer = setTimeout(() => {
      if (!pendingNearMe.current) return;
      pendingNearMe.current = false;
      cameraMoved.current = true;
      setCameraZoom(CURRENT_LOCATION_ZOOM);
      setCameraRevision(value => value + 1);
      setCenter({ latitude: point.latitude, longitude: point.longitude });
      viewport.current = point;
    }, 0);
    return () => clearTimeout(timer);
  }, [gps.location, navigationState.ready, setCenter]);

  const locationStatus =
    gps.status === "loading"
      ? t("Finding your location…", "Се бара вашата локација…")
      : gps.status === "ready"
        ? t("Location active", "Локацијата е активна") +
          " · ±" +
          Math.ceil(gps.accuracy ?? 0) +
          " m"
        : gps.status === "approximate"
          ? (gps.approximatePermission ? t("Precise location is off", "Прецизната локација е исклучена") : t("Location is approximate", "Локацијата е приближна")) +
            " · ±" +
            Math.ceil(gps.accuracy ?? 0) +
            " m"
          : locationIssueTitle(gps.issue, t);
  const locationWarning =
    (locationRequest &&
    (!canAddAtLocation(gps.location) || !inSkopje(gps.location!))
      ? locationRequest
      : "") || (gps.status !== "ready" ? locationStatus : "");
  const locationWarningKey =
    gps.status + ":" + (gps.issue?.code ?? "") + ":" + locationWarning;
  function retryLocation() {
    setLocationRequest("");
    setLocationDismissed(null);
    gps.retry();
  }
  useMapSettingsLocation({ locationStatus, issue: gps.issue, onRefreshLocation: retryLocation });
  function nearMe() {
    setLocationDismissed(null);
    setDestination(null);
    clearSearch();
    clearSelection();
    cameraMoved.current = true;
    const point = nearbyOrigin(null, gps.location);
    if (point) {
      pendingNearMe.current = false;
      setCameraZoom(CURRENT_LOCATION_ZOOM);
      setCameraRevision((value) => value + 1);
      setCenter({ latitude: point.latitude, longitude: point.longitude });
      viewport.current = point;
    } else {
      pendingNearMe.current = true;
      retryLocation();
    }
  }
  function addParking() {
    pendingNearMe.current = false;
    clearSearch();
    clearSelection();
    setLocationDismissed(null);
    if (!canAddAtLocation(gps.location)) {
      setLocationRequest(
        gps.location
          ? t(
              "Wait for a precise location before adding parking.",
              "Почекајте прецизна локација за да додадете паркинг.",
            )
          : t(
              "Your location is unavailable. Enable GPS to add parking.",
              "Вашата локација е недостапна. Вклучете GPS за да додадете паркинг.",
            ),
      );
      if (gps.status !== "loading") gps.retry();
      return;
    }
    const point = gps.location!;
    if (!inSkopje(point)) {
      setLocationRequest(
        t(
          "Your location is outside Skopje.",
          "Вашата локација е надвор од Скопје.",
        ),
      );
      return;
    }
    const zone = catalog.places.find(
      (place) =>
        place.kind === "zone" &&
        place.geometry &&
        containsParkingFix(point, place),
    );
    setProposal({
      coordinate: { latitude: point.latitude, longitude: point.longitude },
      accuracy: point.accuracy!,
      zoneCode: zone?.zoneCode ?? undefined,
    });
  }
  function clearSearch() {
    searchVersion.current++;
    setQuery("");
    setRemote([]);
    setSearching(false);
  }
  function startDestination() {
    pendingNearMe.current = false;
    Keyboard.dismiss();
    clearSearch();
    clearSelection();
    cameraMoved.current = true;
    setMessage("");
    setPicking("destination");
  }
  function choose(value: Destination, move = true) {
    pendingNearMe.current = false;
    clearSearch();
    clearSelection();
    cameraMoved.current = true;
    setDestination(value);
    if (move) {
      setCameraZoom(15);
      setCameraRevision((value) => value + 1);
      setCenter(value.coordinate);
      viewport.current = value.coordinate;
    }
    setMessage("");
    Keyboard.dismiss();
  }
  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const text = searchText(query.trim()),
      code = normalizeZoneCode(query);
    const local = [
      ...catalog.destinations,
      ...catalog.places
        .filter(
          (place) =>
            (place.zoneCode &&
              normalizeZoneCode(place.zoneCode).startsWith(code)) ||
            searchText(place.name + " " + (place.nameEn ?? "")).includes(text),
        )
        .map((place) => ({
          id: place.id,
          name:
            (place.zoneCode ? place.zoneCode + " · " : "") +
            placeName(place, language),
          coordinate: place.coordinate,
        })),
    ].filter(
      (value) =>
        searchText(value.name).includes(text) ||
        normalizeZoneCode(value.name).startsWith(code),
    );
    return [...remote, ...local]
      .filter(
        (value, index, all) =>
          all.findIndex((other) => other.id === value.id) === index,
      )
      .slice(0, 5);
  }, [query, catalog, language, remote]);
  async function searchAddress() {
    if (query.trim().length < 3 || searching) return;
    const version = ++searchVersion.current;
    setSearching(true);
    setMessage("");
    try {
      const results = await api.search(query.trim());
      if (version !== searchVersion.current) return;
      setRemote(results);
      if (!results.length)
        setMessage(
          t(
            "No address found. Choose on the map.",
            "Нема резултати. Изберете на мапата.",
          ),
        );
    } catch {
      if (version === searchVersion.current)
        setMessage(
          t(
            "Search is unavailable. Choose on the map.",
            "Пребарувањето е недостапно. Изберете на мапата.",
          ),
        );
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  }
  const moveVertex = useCallback((index: number, point: Coordinate) => {
    setDraft((points) =>
      points.map((previous, i) =>
        i === index
          ? {
              latitude: Math.max(41.91, Math.min(42.08, point.latitude)),
              longitude: Math.max(21.3, Math.min(21.58, point.longitude)),
            }
          : previous,
      ),
    );
  }, []);
  const cancelPicking = useCallback(() => {
    setPicking(null);
    setDraft([]);
    setEditingBoundary(null);
    setMessage("");
    setDrawerHeight(94);
  }, []);
  // Android Back leaves drawing mode or closes the parking popup before leaving the app.
  useEffect(() => {
    if (!focused || (!picking && !selected)) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (picking) cancelPicking(); else clearSelection();
      return true;
    });
    return () => subscription.remove();
  }, [focused, picking, selected, cancelPicking, clearSelection]);
  async function finishZone() {
    const shape = zoneGeometry(draft);
    if (!validZone(shape)) {
      setMessage(
        t(
          "Adjust the corners so edges don’t cross.",
          "Прилагодете ги аглите за да не се сечат линиите.",
        ),
      );
      return;
    }
    if (!editingBoundary) {
      // A drawn zone's pin belongs inside it, not on the first corner tapped.
      const middle = { latitude: draft.reduce((sum, p) => sum + p.latitude, 0) / draft.length, longitude: draft.reduce((sum, p) => sum + p.longitude, 0) / draft.length };
      setProposal(previous => previous ? { ...previous, geometry: shape } : { geometry: shape, coordinate: middle, kind: "zone" });
      setPicking(null);
      return;
    }
    // Return the geometry to the still-mounted wizard; it owns per-step saving.
    setDetailsGeometry({ id: editingBoundary, geometry: shape });
    cancelPicking();
  }
  const dismissGpsArrival = gps.dismiss;
  const dismissArrival = useCallback(() => {
    if (notificationPriority && Platform.OS === "ios") setNotificationClosing(true);
    dismissGpsArrival();
    setFollowupId(null);
    setFollowupFromNotification(false);
    setArrivalPaid(false);
    setArrivalPrice("");
  }, [notificationPriority, dismissGpsArrival]);
  // A refreshed catalog can resolve a pending price question while the popup is open.
  useEffect(() => {
    if (arrivalPlace && question === null && !sending) {
      const timer = setTimeout(dismissArrival, 0);
      return () => clearTimeout(timer);
    }
  }, [arrivalPlace, question, sending, dismissArrival]);
  function updateArrival() {
    if (arrivalPlace) { setDetailsEditing(true); setDetailsId(arrivalPlace.id); }
    dismissArrival();
  }
  async function saveArrivalPrice(free: boolean) {
    if (!arrivalPlace || question !== "price") return;
    const amount = free ? 0 : Number(arrivalPrice.replace(",", "."));
    if ((!free && !arrivalPrice.trim()) || !Number.isFinite(amount) || amount < 0 || amount > 10000) {
      setMessage(t("Enter a price from 0 to 10,000 MKD.", "Внесете цена од 0 до 10.000 денари.")); return;
    }
    if (!checkPrice([amount], setMessage)) return;
    setSending(true); setMessage("");
    try {
      await api.price(arrivalPlace.id, amount, amount);
      await gps.reported(arrivalPlace.id).catch(() => {});
      await refresh();
      dismissArrival();
      thankYou();
    } catch { setMessage(t("Could not save. Try again.", "Не е зачувано. Обидете се повторно.")); }
    finally { setSending(false); }
  }
  async function reportArrival(status: "spaces" | "full") {
    if (!gps.arrival) return;
    const place = catalog.places.find(place => place.id === gps.arrival!.id) ?? gps.arrival;
    setSending(true);
    setMessage("");
    try {
      await api.report(place.id, status);
      await gps.reported(place.id).catch(() => {});
      if (status === "spaces") pocCards.record(place);
      await refresh();
      const smsZone = status === "spaces" ? eligibleSmsZone(gps.location, catalog.places, licensePlate.savedPlate, Date.now()) : null;
      const needsPrice = !smsZone && arrivalQuestion(place, true, now) === "price";
      if (needsPrice) setFollowupFromNotification(gps.arrivalFromNotification);
      else if (gps.arrivalFromNotification && Platform.OS === "ios") setNotificationClosing(true);
      gps.dismiss();
      setArrivalPaid(false);
      setArrivalPrice("");
      if (needsPrice) setFollowupId(place.id);
      else if (status === "full") { setDetailsEditing(false); setDetailsId(place.id); }
      thankYou();
    } catch {
      setMessage(
        t("Could not send. Try again.", "Не е испратено. Обидете се повторно."),
      );
    } finally {
      setSending(false);
    }
  }

  async function reportHere(place: ParkingPlace, status: "spaces" | "full") {
    if (sending) return;
    setSending(true);
    setMessage("");
    try {
      await api.report(place.id, status);
      await gps.reported(place.id).catch(() => {});
      await refresh();
      if (status === "full") { setDetailsEditing(false); setDetailsId(place.id); }
      thankYou();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Could not send. Try again.", "Не е испратено. Обидете се повторно."));
    } finally {
      setSending(false);
    }
  }

  const renderFilter = (item: (typeof filterOptions)[number]) => (
    <Pressable
      key={item.id}
      accessibilityRole="checkbox"
      accessibilityLabel={item.label}
      aria-label={item.label}
      aria-checked={parkingFilters.includes(item.id)}
      accessibilityState={{ checked: parkingFilters.includes(item.id) }}
      onPress={() => {
        setParkingFilters(filters => toggleParkingFilter(filters, item.id));
        setVisibleMatches(30);
        clearSelection();
        // This runs only on press; the extracted renderer never reads search refs.
        // eslint-disable-next-line react-hooks/refs
        clearSearch();
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: parkingFilters.includes(item.id) ? colors.accentText : colors.line, backgroundColor: parkingFilters.includes(item.id) ? colors.mint : colors.paper }}
    >
      <View style={{ width: 30, height: 30, backgroundColor: item.color, borderRadius: 15, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontWeight: "800" }}>{item.symbol}</Text>
      </View>
      <Text style={{ flex: 1, color: colors.ink }}>{item.label}</Text>
      <Text style={{ color: colors.muted }}>{filterCounts[item.id]}</Text>
      <Icon name={parkingFilters.includes(item.id) ? "check-square" : "square"} size={18} color={colors.accentText} />
    </Pressable>
  );

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View
        style={s.map}
        onLayout={(event) => setMapHeight(event.nativeEvent.layout.height)}
      >
        <ParkingMap
          now={now}
          cameraRevision={cameraRevision}
          cameraZoom={cameraZoom}
          places={filteredPlaces}
          filtered={hasFilters}
          selectedId={selected}
          selectedAnchor={anchor}
          onSelectedPosition={projectSelection}
          onCenterChange={centerChanged}
          onBlankPress={blankMap}
          isInteractionCurrent={(sentAt) => !mapBlockedBySheet && sentAt > latestSearchFocus.current}
          selectionEnabled={!picking}
          destination={center}
          destinationMarker={
            picking === "destination" ? null : (destination?.coordinate ?? null)
          }
          userLocation={gps.location}
          userAccuracy={gps.accuracy}
          destinationName={destination?.name}
          drawing={picking === "zone"}
          onMoveVertex={moveVertex}
          onPan={pan}
          picking={picking === "zone"}
          showZones
          dark={dark}
          draftCoordinates={draft}
          onSelect={select}
          onPick={(point) => {
            if (picking !== "zone") return;
            if (!inSkopje(point)) {
              setMessage(
                t("Choose an area in Skopje.", "Изберете област во Скопје."),
              );
              return;
            }
            setDraft((points) =>
              points.length < MAX_BOUNDARY_VERTICES ? [...points, point] : points,
            );
          }}
          language={language}
        />
        {!picking ? (
          <>
            <View style={s.searchPanel}>
              <View style={s.searchBox}>
                <Icon name="search" />
                <TextInput
                  ref={searchInput}
                  onFocus={() => { latestSearchFocus.current = Date.now(); }}
                  style={s.input}
                  value={query}
                  placeholder={
                    destination?.name ??
                    t("Where are you going?", "Каде одите?")
                  }
                  accessibilityLabel={t(
                    "Search destination or zone",
                    "Пребарај дестинација или зона",
                  )}
                  placeholderTextColor={colors.muted}
                  returnKeyType="search"
                  onSubmitEditing={() => void searchAddress()}
                  onChangeText={(value) => {
                    clearSearch();
                    setQuery(value);
                    setMessage("");
                  }}
                />
                {query || destination ? (
                  <IconButton
                    name="x"
                    label={t("Clear destination", "Избриши дестинација")}
                    onPress={() => {
                      clearSearch();
                      setDestination(null);
                    }}
                  />
                ) : null}
                <IconButton
                  name="more-horizontal"
                  label={t("Settings", "Поставки")}
                  onPress={() => { Keyboard.dismiss(); router.push("/settings"); }}
                />
              </View>
              {licensePlate.pendingStop ? <Button title={t("Parking SMS", "Паркинг SMS")} variant="secondary" icon="message-square" onPress={() => setStopSms(true)} /> : null}
              {locationWarning && locationDismissed !== locationWarningKey ? (
                <View style={s.locationNotice}>
                  <Pressable
                    style={s.flex}
                    accessibilityRole="button"
                    onPress={() => setLocationHelp(true)}
                  >
                    <Text
                      accessibilityLiveRegion="polite"
                      style={s.locationText}
                    >
                      {locationWarning}
                    </Text>
                  </Pressable>
                  <IconButton
                    name="x"
                    label={t(
                      "Dismiss location notification",
                      "Затвори известување за локација",
                    )}
                    onPress={() => setLocationDismissed(locationWarningKey)}
                  />
                </View>
              ) : null}
              {query.trim() ? (
                <View style={s.suggestions}>
                  {suggestions.map((value) => (
                    <Pressable
                      accessibilityRole="button"
                      key={value.id}
                      onPress={() => choose(value)}
                      style={s.suggestion}
                    >
                      <Icon name="map-pin" size={16} />
                      <Text numberOfLines={2} style={s.suggestionName}>
                        {value.name}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void searchAddress()}
                    style={s.suggestion}
                    disabled={searching || query.trim().length < 3}
                  >
                    {searching ? (
                      <LoadingIndicator size="small" label="" />
                    ) : (
                      <Icon name="search" size={16} />
                    )}
                    <Text style={s.suggestionName}>
                      {t("Search this address", "Пребарај ја адресата")}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={startDestination}
                    style={s.suggestion}
                  >
                    <Icon name="crosshair" size={16} />
                    <Text style={s.suggestionName}>
                      {t("Choose on map", "Избери на мапа")}
                    </Text>
                  </Pressable>
                  {remote.length ? (
                    <Note>© OpenStreetMap contributors</Note>
                  ) : null}
                </View>
              ) : null}
              {message ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Dismiss message", "Затвори порака")}
                  onPress={() => setMessage("")}
                  style={s.notice}
                >
                  <Text accessibilityLiveRegion="polite" style={s.noticeText}>
                    {message}
                  </Text>
                  <Icon name="x" size={16} />
                </Pressable>
              ) : null}
            </View>
            {selectedPlace && !query ? (
              <ParkingPreview
                key={selectedPlace.id}
                place={selectedPlace}
                point={selectedPoint}
                mapHeight={mapHeight}
                drawerHeight={drawerHeight}
                onClose={clearSelection}
                onUpdate={() => { setDetailsEditing(false); setDetailsId(selectedPlace.id); }}
                onReport={atSelected && connected ? (status) => void reportHere(selectedPlace, status) : undefined}
                reporting={sending}
                onPay={payablePlace(selectedPlace.id, catalog.places) ? () => { clearSelection(); setManualPayId(selectedPlace.id); } : undefined}
              />
            ) : null}
            {drawerHeight <= 100 && payNearby && !selectedPlace && !picking ? <View style={[s.pay, { bottom: drawerHeight + 14 }]}>
              <Button icon="message-square" title={t("Pay parking", "Плати паркинг")} variant="secondary" onPress={() => { Keyboard.dismiss(); setPayChooser(payOrigin); }} />
            </View> : null}
            {drawerHeight <= 100 ? <View style={[s.locate, { bottom: drawerHeight + 14 }]}>
              <IconButton name="info" label={t("Map legend", "Легенда на мапата")} onPress={() => { Keyboard.dismiss(); setLegend(true); }} />
              <IconButton
                name="crosshair"
                label={t("Parking near me", "Паркинг во близина")}
                onPress={nearMe}
              />
            </View> : null}
            <MapDrawer
              key={drawerRevision}
              expandRequest={expandResults}
              onHeightChange={setDrawerHeight}
              onDestination={startDestination}
              onAdd={addParking}
              onDraw={() => {
                pendingNearMe.current = false;
                Keyboard.dismiss();
                clearSearch();
                clearSelection();
                cameraMoved.current = true;
                setDraft([]);
                setEditingBoundary(null);
                setMessage("");
                setPicking("zone");
              }}
            >
              {target || hasFilters ? (
                <>
                  <Text style={s.caption}>
                    {hasFilters ? `${filterOptions.filter(option => parkingFilters.includes(option.id)).map(option => option.label).join(" · ")} · ${rows.length}` : destination
                      ? t(
                          "Parking near destination",
                          "Паркинг до дестинацијата",
                        )
                      : t("Parking near you", "Паркинг во близина")}
                  </Text>
                  {hasFilters ? <Button title={t("Change filter", "Промени филтер")} variant="secondary" onPress={() => setLegend(true)} /> : <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16 }}>
                    {(["nearest", "cheapest"] as const).map(value => (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: sort === value }}
                        onPress={() => setSort(value)}
                        style={{ flex: 1, minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: 10, backgroundColor: sort === value ? colors.mint : colors.paper }}
                      >
                        <Text style={{ color: colors.ink, fontWeight: sort === value ? "700" : "400" }}>
                          {value === "nearest" ? t("Nearest", "Најблиску") : t("Cheapest", "Најевтино")}
                        </Text>
                      </Pressable>
                    ))}
                  </View>}
                  {!hasFilters && sort === "cheapest" ? <Text style={s.caption}>{t(
                    "Public parking · first-hour estimates · unknown prices last. Check signs for restrictions.",
                    "Јавен паркинг · процена за првиот час · непознати цени на крај. Проверете ги знаците за ограничувања.",
                  )}</Text> : null}
                  {rows.slice(0, !hasFilters ? 3 : visibleMatches).map((row) => (
                    <ParkingRow
                      key={row.place.id}
                      place={row.place}
                      distance={row.distance}
                      cost={row.cost}
                      costEvidence={row.costEvidence}
                      selected={selected === row.place.id}
                      onPress={(place) => {
                        select(place);
                        setDrawerHeight(94);
                        setDrawerRevision((value) => value + 1);
                      }}
                    />
                  ))}
                  {hasFilters && rows.length > visibleMatches ? <Button title={t("Show more", "Прикажи повеќе")} variant="secondary" onPress={() => setVisibleMatches(value => value + 30)} /> : null}
                  {!rows.length ? (
                    <Note>
                      {hasFilters ? t("No parking matches this filter", "Нема паркинзи за избраниот филтер") : t(
                        "No parking mapped nearby",
                        "Нема означен паркинг во близина",
                      )}
                    </Note>
                  ) : null}
                </>
              ) : (
                <Button
                  title={t(
                    "Enable location for nearby parking",
                    "Вклучи локација за блиски паркинзи",
                  )}
                  variant="secondary"
                  onPress={() => {
                    setLocationDismissed(null);
                    setLocationHelp(true);
                  }}
                />
              )}
              {!connected ? (
                <Note>
                  {t("Offline · saved map", "Без врска · зачувана мапа")}
                </Note>
              ) : null}
            </MapDrawer>
          </>
        ) : (
          <>
            <View style={s.pickTop}>
              <Button
                title={t("Cancel", "Откажи")}
                icon="x"
                variant="secondary"
                disabled={sending}
                onPress={cancelPicking}
              />
              {picking === "zone" ? (
                <Text style={s.pickHint}>
                  {editingPerimeter ? t("Perimeter · Tap or drag corners", "Периметар · Повлечете за промена") : t(
                    "Tap to add · Drag corners to adjust",
                    "Допрете за додавање · Повлечете за промена",
                  )}
                </Text>
              ) : null}
            </View>
            {picking === "destination" ? (
              <>
                <View pointerEvents="none" style={s.centerPin}>
                  <View style={s.pinHead}>
                    <View style={s.pinHole} />
                  </View>
                  <View style={s.pinTip} />
                </View>
                <View style={s.drawActions}>
                  <Button
                    style={s.flex}
                    title={t("Set destination", "Постави дестинација")}
                    icon="map-pin"
                    onPress={() => {
                      const point = viewport.current;
                      if (!inSkopje(point)) {
                        setMessage(
                          t(
                            "Choose a destination in Skopje.",
                            "Изберете дестинација во Скопје.",
                          ),
                        );
                        return;
                      }
                      choose(
                        {
                          id: "picked",
                          name: t("Destination", "Дестинација"),
                          coordinate: { ...point },
                        },
                        false,
                      );
                      setPicking(null);
                      setDrawerHeight(94);
                    }}
                  />
                </View>
              </>
            ) : (
              <View style={s.drawActions}>
                <Button
                  title={t("Undo", "Врати")}
                  variant="secondary"
                  disabled={!draft.length || sending}
                  onPress={() => setDraft((points) => points.slice(0, -1))}
                />
                <Button
                  style={s.flex}
                  title={
                    sending
                      ? t("Saving…", "Се зачувува…")
                      : editingBoundary
                        ? editingPerimeter ? t("Save perimeter", "Зачувај периметар") : t("Save zone", "Зачувај зона")
                        : proposal ? t("Use this boundary", "Користи ја границата") : t("Finish zone", "Заврши зона")
                  }
                  disabled={draft.length < 3 || sending}
                  onPress={() => void finishZone()}
                />
              </View>
            )}
            {message ? (
              <View style={s.pickMessage}>
                <Text style={s.locationText}>{message}</Text>
              </View>
            ) : null}
          </>
        )}
        <MapCredit active={focused} />
      </View>
      <ParkingDetails
        key={detailsId ?? "none"}
        place={catalog.places.find((place) => place.id === detailsId)}
        visible={detailsId !== null && !picking && !suspendSheets}
        boundaryGeometry={detailsGeometry?.id === detailsId ? detailsGeometry.geometry : undefined}
        initialEditing={detailsEditing}
        minutes={60}
        onClose={() => { setDetailsId(null); setDetailsGeometry(null); }}
        onSelectAlternative={(place) => { setDetailsEditing(false); select(place); setDetailsId(place.id); setCameraZoom(15); setCenter(place.coordinate); setCameraRevision(value => value + 1); }}
        onEditBoundary={(place, geometry) => {
          pendingNearMe.current = false;
          clearSelection();
          setEditingBoundary(place.id);
          clearSearch();
          setMessage("");
          setDraft(
            (geometry ?? (detailsGeometry?.id === place.id ? detailsGeometry.geometry : place.geometry))?.coordinates[0]
              .slice(0, -1)
              .map(([longitude, latitude]) => ({ latitude, longitude })) ?? [],
          );
          cameraMoved.current = true;
          setPicking("zone");
        }}
      />
      <LocationHelp
        visible={locationHelp && !suspendSheets}
        issue={gps.issue ?? (gps.approximatePermission ? { code: "approximate" } : null)}
        onClose={() => setLocationHelp(false)}
        onRetry={retryLocation}
      />
      {proposal ? (
        <ProposalSheet
          visible={!picking && !suspendSheets}
          coordinate={proposal.coordinate}
          geometry={proposal.geometry}
          locationAccuracy={proposal.accuracy}
          initial={{
            zoneCode: proposal.zoneCode,
            kind: proposal.kind,
          }}
          onDrawBoundary={(geometry) => {
            pendingNearMe.current = false;
            Keyboard.dismiss();
            clearSearch();
            clearSelection();
            setEditingBoundary(null);
            setDraft((geometry ?? proposal.geometry)?.coordinates[0].slice(0, -1).map(([longitude, latitude]) => ({ latitude, longitude })) ?? []);
            cameraMoved.current = true;
            setCameraZoom(15);
            setCenter(proposal.coordinate);
            setCameraRevision(value => value + 1);
            setMessage("");
            setPicking("zone");
          }}
          onClose={() => {
            setProposal(null);
            setDraft([]);
            setDrawerHeight(94);
          }}
          onSubmitted={(id) => {
            setSelected(id);
            setAnchor(proposal.coordinate);
            setMessage(t("Added to the map", "Додадено на мапата"));
          }}
        />
      ) : null}
      <ZonePaymentSheet key={payment.place?.id ?? "no-payment"} place={!paymentBlocked ? payment.place : null} validate={payment.validate} onClose={payment.dismiss} onInvalidated={() => { payment.dismiss(false); void refresh(); }} />
      <PayParkingChooser visible={Boolean(payChooser) && !suspendSheets} places={catalog.places} origin={payChooser} onClose={() => setPayChooser(null)} onPick={place => { setPayChooser(null); setManualPayId(place.id); }} />
      <ZonePaymentSheet key={`manual:${manualPayId}`} manual place={!suspendSheets && manualPayId ? catalog.places.find(place => place.id === manualPayId) ?? null : null} validate={manualValidate} onClose={() => setManualPayId(null)}
        onInvalidated={() => { setManualPayId(null); setMessage(t("Payment details changed. Check the sign and try again.", "Податоците за плаќање се сменети. Проверете го знакот и обидете се повторно.")); void refresh(); }} />
      {pocCards.zone ? <PocCardSuggestion zone={pocCards.zone} visible={focused && !suspendSheets && !mapBlockedBySheet && !arrivalPlace && !licensePlate.offerPlate && !selected && !payment.place && !stopSms} onClose={pocCards.dismiss} /> : null}
      <ParkingSmsStopSheet visible={stopSms && !suspendSheets && !arrivalVisible && !detailsId && !legend && !proposal && !picking && !locationHelp} onClose={() => setStopSms(false)} />
      <Sheet visible={legend && !suspendSheets} title={t("Map legend", "Легенда на мапата")} onClose={() => setLegend(false)}>
        {filterOptions.slice(0, 5).map(renderFilter)}
        <RevealSection active={parkingTypesExpanded} style={{ gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Parking types", "Видови паркинг")} aria-label={t("Parking types", "Видови паркинг")} aria-expanded={parkingTypesExpanded} accessibilityState={{ expanded: parkingTypesExpanded }} onPress={() => setParkingTypesExpanded(value => !value)} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 56 }}><Text style={{ flex: 1, color: colors.ink, fontWeight: "700" }}>{t("Parking types", "Видови паркинг")}</Text><Icon name={parkingTypesExpanded ? "chevron-up" : "chevron-down"} size={20} /></Pressable>
          {parkingTypesExpanded ? filterOptions.slice(5).map(renderFilter) : null}
        </RevealSection>
        <Button title={t("Done", "Готово")} onPress={() => { setLegend(false); setExpandResults(value => value + 1); }} />
      </Sheet>
      <Sheet
        visible={arrivalVisible}
        title={
          question === "price"
            ? t("One more thing, is it free?", "Уште нешто, бесплатно ли е?")
            : t("Any free spaces here?", "Има ли слободни места тука?")
        }
        onClose={() => { if (!sending) dismissArrival(); }}
        onDismiss={() => setNotificationClosing(false)}
      >
        <Text style={s.title}>
          {arrivalPlace ? placeName(arrivalPlace, language) : null}
        </Text>
        {question === "availability" ? (
          <View style={s.answers}>
            <Button
              style={s.flex}
              title={t("Yes", "Да")}
              disabled={sending || !connected}
              onPress={() => void reportArrival("spaces")}
            />
            <Button
              style={s.flex}
              title={t("No", "Не")}
              variant="secondary"
              disabled={sending || !connected}
              onPress={() => void reportArrival("full")}
            />
          </View>
        ) : null}
        {question === "price" ? (
          <>
            <Note>{t("The price is still missing here. A quick answer helps the next driver.", "Тука сè уште нема цена. Брзиот одговор му помага на следниот возач.")}</Note>
            {followupPlace?.availability?.status === "full" ? <Button title={t("Find free spaces nearby", "Најди слободни места блиску")} icon="map-pin" variant="secondary" disabled={sending} onPress={() => { setDetailsEditing(false); setDetailsId(followupPlace.id); dismissArrival(); }} /> : null}
            {arrivalPaid ? <>
              <TextInput accessibilityLabel={t("Price per hour in MKD", "Цена по час во денари")} value={arrivalPrice} onChangeText={setArrivalPrice} keyboardType="decimal-pad" placeholder={t("MKD per hour", "Денари по час")} placeholderTextColor={colors.muted} style={[s.input, { flex: undefined, backgroundColor: colors.input, borderRadius: 10, paddingHorizontal: 12 }]} editable={!sending} />
              <Note>{t("If the first and following hours differ, use “Add photo or details”.", "Ако првиот и следните часови се разликуваат, изберете „Додај слика или детали“.")}</Note>
              <Button title={t("Share price", "Сподели цена")} disabled={sending || !connected || !arrivalPrice.trim()} onPress={() => void saveArrivalPrice(false)} />
            </> : <View style={s.answers}>
              <Button style={s.flex} title={t("It's free", "Бесплатно е")} disabled={sending || !connected} onPress={() => void saveArrivalPrice(true)} />
              <Button style={s.flex} title={t("Paid parking", "Се плаќа")} variant="secondary" disabled={sending} onPress={() => setArrivalPaid(true)} />
            </View>}
            <Button
              title={t("Add photo or details", "Додај слика или детали")}
              variant="secondary"
              disabled={sending}
              onPress={updateArrival}
            />
          </>
        ) : null}
        {!connected ? (
          <Note>
            {t("Connect to send your answer.", "Поврзете се за да одговорите.")}
          </Note>
        ) : null}
        {message ? <Note>{message}</Note> : null}
      </Sheet>
    </SafeAreaView>
  );
}
function inSkopje(point: Coordinate) {
  return (
    point.latitude >= 41.91 &&
    point.latitude <= 42.08 &&
    point.longitude >= 21.3 &&
    point.longitude <= 21.58
  );
}
const styles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.paper },
    map: { flex: 1, overflow: "hidden" },
    searchPanel: {
      position: "absolute",
      zIndex: 1080,
      top: 12,
      left: 12,
      right: 12,
      maxWidth: 560,
      gap: 6,
    },
    searchBox: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.paper,
      borderRadius: 18,
      paddingLeft: 16,
      paddingRight: 6,
      minHeight: 58,
      gap: 10,
      elevation: 4,
      boxShadow: "0 3px 14px #153d3a20",
    },
    input: {
      flex: 1,
      minWidth: 0,
      fontSize: 16,
      color: colors.ink,
      paddingVertical: 14,
    },
    suggestions: {
      backgroundColor: colors.paper,
      borderRadius: 16,
      padding: 8,
      elevation: 5,
    },
    suggestion: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      minHeight: 44,
    },
    suggestionName: { flex: 1, color: colors.ink, fontSize: 14 },
    notice: {
      backgroundColor: colors.paper,
      borderRadius: 12,
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    noticeText: { color: colors.ink, flex: 1, lineHeight: 20 },
    locationNotice: {
      backgroundColor: colors.paper,
      borderRadius: 12,
      paddingLeft: 12,
      paddingRight: 4,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    locationText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.red,
      fontWeight: "600",
    },
    locate: { position: "absolute", zIndex: 1000, left: 14, gap: 12 },
    pay: { position: "absolute", zIndex: 1000, right: 14 },
    pickTop: {
      position: "absolute",
      top: 12,
      left: 12,
      right: 12,
      zIndex: 1200,
      alignItems: "flex-start",
      gap: 8,
    },
    pickHint: {
      backgroundColor: colors.paper,
      color: colors.ink,
      borderRadius: 10,
      padding: 10,
      fontSize: 13,
    },
    drawActions: {
      position: "absolute",
      left: 12,
      right: 12,
      bottom: 24,
      zIndex: 1200,
      flexDirection: "row",
      gap: 10,
      backgroundColor: colors.paper,
      padding: 10,
      borderRadius: 18,
      maxWidth: 540,
    },
    pickMessage: {
      position: "absolute",
      left: 12,
      right: 12,
      top: 80,
      zIndex: 1200,
      padding: 12,
      backgroundColor: colors.paper,
      borderRadius: 12,
    },
    centerPin: {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: 38,
      height: 50,
      marginLeft: -19,
      marginTop: -50,
      alignItems: "center",
      zIndex: 1000,
    },
    pinHead: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: "#D63F37",
      borderColor: "#FFFFFF",
      borderWidth: 3,
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 3px 8px #00000045",
    },
    pinHole: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: "#FFFFFF",
    },
    pinTip: {
      marginTop: -4,
      width: 0,
      height: 0,
      borderLeftWidth: 9,
      borderRightWidth: 9,
      borderTopWidth: 16,
      borderLeftColor: "transparent",
      borderRightColor: "transparent",
      borderTopColor: "#D63F37",
    },
    title: { fontSize: 17, fontWeight: "700", color: colors.ink },
    caption: { fontSize: 13, color: colors.muted, marginTop: 4 },
    answers: { flexDirection: "row", gap: 10 },
    flex: { flex: 1 },
  });
