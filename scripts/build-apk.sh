#!/bin/sh
# Builds the store-config release APK on this machine (no EAS cloud build).
# Gradle runs in a short path because CMake breaks on "All my AI stuff". Signing uses
# SKOPJE_PARKING_KEYSTORE, SKOPJE_PARKING_KEY_ALIAS and SKOPJE_PARKING_KEYSTORE_PASSWORD from .env.
# Output: dist/skopje-parking-<version>.apk
# SKOPJE_PARKING_DEVICE_TEST=1 builds the emulator test app instead (package com.vasojevich.parking.dev, x86_64,
# the isolated QA API on 127.0.0.1:3002 through adb reverse): dist/skopje-parking-device-test.apk
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
if [ "$SKOPJE_PARKING_DEVICE_TEST" = 1 ]; then
  BUILD="${SKOPJE_PARKING_BUILD_DIR:-/c/pb/device-test}"; API="http://127.0.0.1:3002"; GRADLE_ARCH="-PreactNativeArchitectures=x86_64"
else
  unset SKOPJE_PARKING_DEVICE_TEST SKOPJE_PARKING_TEST_PACKAGE
  BUILD="${SKOPJE_PARKING_BUILD_DIR:-/c/pb/release}"; API="https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api"; GRADLE_ARCH=""
fi
# Background arrival reminders and the widget's background updates. Prebuild adds the permissions
# and Gradle embeds the flag in the app config, so both steps need it. A Play upload with it also
# needs the background location declaration approved first.
export SKOPJE_PARKING_BACKGROUND_LOCATION=1
key() { grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '\r'; }
if [ "$SKOPJE_PARKING_DEVICE_TEST" != 1 ]; then
  KEYSTORE="$(key SKOPJE_PARKING_KEYSTORE)"; ALIAS="$(key SKOPJE_PARKING_KEY_ALIAS)"
  SKOPJE_PARKING_KEYSTORE_PASSWORD="$(key SKOPJE_PARKING_KEYSTORE_PASSWORD)"; export SKOPJE_PARKING_KEYSTORE_PASSWORD
  [ -f "$KEYSTORE" ] && [ -n "$SKOPJE_PARKING_KEYSTORE_PASSWORD" ] || { echo "Set the SKOPJE_PARKING_KEYSTORE* values in .env" >&2; exit 1; }
fi

echo "== sync to $BUILD"
mkdir -p "$BUILD"
# .env stays out: Expo would load it while bundling. Excluded folders are neither copied nor purged.
robocopy "$(cygpath -w "$ROOT")" "$(cygpath -w "$BUILD")" //MIR //NFL //NDL //NJH //NJS //NP \
  //XD node_modules android ios .git .claude dist output data\\runtime website presentations .presentation-build \
  //XF .env .env.local > /dev/null || [ $? -lt 8 ]
# /XD android above also skips modules/*/android, the local native modules' source.
robocopy "$(cygpath -w "$ROOT/modules")" "$(cygpath -w "$BUILD/modules")" //MIR //NFL //NDL //NJH //NJS //NP \
  //XD node_modules build .gradle .cxx > /dev/null || [ $? -lt 8 ]
cd "$BUILD"
npm install --no-audit --no-fund --loglevel=error

echo "== prebuild"
EXPO_PUBLIC_API_URL="$API" npx expo prebuild --platform android --clean --no-install > /dev/null
echo "sdk.dir=$(cygpath -m "$SDK")" > android/local.properties

echo "== gradle assembleRelease"
cd android
EXPO_PUBLIC_API_URL="$API" NODE_ENV=production ./gradlew assembleRelease $GRADLE_ARCH --console=plain -q
cd ..
mkdir -p "$ROOT/dist"
if [ "$SKOPJE_PARKING_DEVICE_TEST" = 1 ]; then
  cp android/app/build/outputs/apk/release/app-release.apk "$ROOT/dist/skopje-parking-device-test.apk"
  echo "$ROOT/dist/skopje-parking-device-test.apk"; exit 0
fi

echo "== sign"
VERSION="$(node -p "require('./app.json').expo.version")"
OUT="$ROOT/dist/skopje-parking-$VERSION.apk"
TOOLS="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
"$TOOLS/apksigner.bat" sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" --ks-pass env:SKOPJE_PARKING_KEYSTORE_PASSWORD \
  --out "$(cygpath -w "$OUT")" "$(cygpath -w android/app/build/outputs/apk/release/app-release.apk)"
"$TOOLS/apksigner.bat" verify --print-certs "$(cygpath -w "$OUT")" | head -3
echo "$OUT"
