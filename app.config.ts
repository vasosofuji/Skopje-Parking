import type { ConfigContext, ExpoConfig } from "expo/config";
export default ({ config }: ConfigContext): ExpoConfig => {
  const testPackage = process.env.PARKINO_TEST_PACKAGE === "1" || process.env.PARKINO_DEVICE_TEST === "1";
  // Background location needs Google Play's declaration, a video and review, so store builds
  // ship without it until PARKINO_BACKGROUND_LOCATION=1 is set for an approved release.
  const backgroundLocation = process.env.PARKINO_BACKGROUND_LOCATION === "1";
  const plugins = (config.plugins ?? []).map(plugin => Array.isArray(plugin) && plugin[0] === "expo-location"
    ? ["expo-location", { ...plugin[1], isIosBackgroundLocationEnabled: backgroundLocation, isAndroidBackgroundLocationEnabled: backgroundLocation, isAndroidForegroundServiceEnabled: backgroundLocation }] as [string, Record<string, unknown>]
    : plugin);
  if (["preview", "production"].includes(process.env.EAS_BUILD_PROFILE ?? "") && process.env.EXPO_PUBLIC_OFFLINE_PREVIEW !== "1") {
    const url = new URL(process.env.EXPO_PUBLIC_API_URL ?? "http://localhost");
    const host = url.hostname.replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(^|\.)(localhost|local|internal|invalid|test)$/.test(host))
      throw new Error("Connected APK builds require a public HTTPS EXPO_PUBLIC_API_URL.");
  }
  return ({
  ...config,
  name: testPackage ? "Parking Test" : "Parking",
  slug: "parkskopje",
  android: {
    ...config.android,
    ...(testPackage ? { package: "mk.parkskopje.app.dev" } : {}),
    // Template and library permissions the app never uses; keeping them out of the store
    // manifest avoids sensitive-permission declarations.
    blockedPermissions: [
      "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.USE_BIOMETRIC", "android.permission.USE_FINGERPRINT",
      "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE", "android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO", "android.permission.RECORD_AUDIO",
      ...(backgroundLocation ? [] : ["android.permission.ACCESS_BACKGROUND_LOCATION", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_LOCATION"]),
    ],
  },
  ...(testPackage ? {
    ios: { ...config.ios, bundleIdentifier: "mk.parkskopje.app.dev" },
    scheme: "parkskopje-test",
  } : {}),
  extra: {
    ...config.extra,
    androidNativeMapsEnabled: Boolean(process.env.GOOGLE_MAPS_ANDROID_KEY),
    usbTest: process.env.PARKINO_DEVICE_TEST === "1",
    backgroundLocation,
  },
  plugins: [
    ...plugins,
    "./plugins/with-short-cmake-paths",
    "./plugins/with-mlkit-ocr",
    "./plugins/with-offline-map",
    "expo-secure-store",
    [
      "expo-image-picker",
      {
        photosPermission: "Choose a parking sign photo to share its prices.",
        cameraPermission: "Photograph parking signs to share their prices.",
        microphonePermission: false,
      },
    ],
    [
      "expo-build-properties",
      { android: { buildArchs: ["arm64-v8a", "armeabi-v7a"], usesCleartextTraffic: process.env.PARKINO_DEVICE_TEST === "1" } },
    ],
    ...(process.env.GOOGLE_MAPS_ANDROID_KEY
      ? [
          [
            "react-native-maps",
            { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY },
          ] as [string, Record<string, string>],
        ]
      : []),
  ],
  });
};
