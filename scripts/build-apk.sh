#!/bin/sh
# Builds the store-config release APK on this machine (no EAS cloud build).
# Gradle runs in a short path because CMake breaks on "All my AI stuff". Signing uses
# SKOPJE_PARKING_KEYSTORE, SKOPJE_PARKING_KEY_ALIAS and SKOPJE_PARKING_KEYSTORE_PASSWORD from .env.
# Output: dist/skopje-parking-<version>.apk
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${SKOPJE_PARKING_BUILD_DIR:-/c/pb/release}"
SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
API="https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api"
# Background arrival reminders and the widget's background updates. Prebuild adds the permissions
# and Gradle embeds the flag in the app config, so both steps need it. A Play upload with it also
# needs the background location declaration approved first.
export SKOPJE_PARKING_BACKGROUND_LOCATION=1
key() { grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '\r'; }
KEYSTORE="$(key SKOPJE_PARKING_KEYSTORE)"; ALIAS="$(key SKOPJE_PARKING_KEY_ALIAS)"
SKOPJE_PARKING_KEYSTORE_PASSWORD="$(key SKOPJE_PARKING_KEYSTORE_PASSWORD)"; export SKOPJE_PARKING_KEYSTORE_PASSWORD
[ -f "$KEYSTORE" ] && [ -n "$SKOPJE_PARKING_KEYSTORE_PASSWORD" ] || { echo "Set the SKOPJE_PARKING_KEYSTORE* values in .env" >&2; exit 1; }

echo "== sync to $BUILD"
mkdir -p "$BUILD"
# .env stays out: Expo would load it while bundling. Excluded folders are neither copied nor purged.
robocopy "$(cygpath -w "$ROOT")" "$(cygpath -w "$BUILD")" //MIR //NFL //NDL //NJH //NJS //NP \
  //XD node_modules android ios .git dist output data\\runtime website presentations .presentation-build \
  //XF .env .env.local > /dev/null || [ $? -lt 8 ]
# /XD android above also skips modules/*/android, the local native modules' source.
robocopy "$(cygpath -w "$ROOT/modules")" "$(cygpath -w "$BUILD/modules")" //MIR //NFL //NDL //NJH //NJS //NP \
  //XD node_modules build .gradle .cxx > /dev/null || [ $? -lt 8 ]
cd "$BUILD"
npm install --no-audit --no-fund --loglevel=error

echo "== prebuild"
env -u SKOPJE_PARKING_DEVICE_TEST -u SKOPJE_PARKING_TEST_PACKAGE EXPO_PUBLIC_API_URL="$API" \
  npx expo prebuild --platform android --clean --no-install > /dev/null
echo "sdk.dir=$(cygpath -m "$SDK")" > android/local.properties

echo "== gradle assembleRelease"
cd android
env -u SKOPJE_PARKING_DEVICE_TEST -u SKOPJE_PARKING_TEST_PACKAGE EXPO_PUBLIC_API_URL="$API" NODE_ENV=production \
  ./gradlew assembleRelease --console=plain -q
cd ..

echo "== sign"
VERSION="$(node -p "require('./app.json').expo.version")"
OUT="$ROOT/dist/skopje-parking-$VERSION.apk"
mkdir -p "$ROOT/dist"
TOOLS="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
"$TOOLS/apksigner.bat" sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" --ks-pass env:SKOPJE_PARKING_KEYSTORE_PASSWORD \
  --out "$(cygpath -w "$OUT")" "$(cygpath -w android/app/build/outputs/apk/release/app-release.apk)"
"$TOOLS/apksigner.bat" verify --print-certs "$(cygpath -w "$OUT")" | head -3
echo "$OUT"
