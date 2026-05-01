#!/usr/bin/env bash
# scripts/generate-logo-assets.sh
#
# Regenerates all logo-derived assets from the source PNGs in public/.
# Run after any logo source change: `npm run logo:generate`.
#
# Sources (kept at native 1254x1254, edited externally):
#   - public/shredtrack_logo.png    → primary logo (web favicons, iOS icon, splash)
#   - public/shredstack_watch_icon.png → watchOS-only (composed for circular mask)
#
# Requires:
#   - sips     (built into macOS)
#   - magick   (ImageMagick — `brew install imagemagick`)
#
# Theme color #151525 matches viewport.themeColor in src/app/layout.tsx.

set -euo pipefail

cd "$(dirname "$0")/.."

SRC_LOGO="public/shredtrack_logo.png"
SRC_WATCH="public/shredstack_watch_icon.png"
BG="#151525"

[ -f "$SRC_LOGO" ]  || { echo "Missing $SRC_LOGO"; exit 1; }
[ -f "$SRC_WATCH" ] || { echo "Missing $SRC_WATCH"; exit 1; }
command -v sips   >/dev/null || { echo "sips not found (macOS only)"; exit 1; }
command -v magick >/dev/null || { echo "magick not found — brew install imagemagick"; exit 1; }

q() { "$@" >/dev/null; }

# ─── Web (Next.js app/ file conventions) ──────────────────────────────────────
# Replaces existing src/app/icon.png; adds apple-icon and opengraph-image.
q sips -s format png --resampleHeightWidth 512 512 "$SRC_LOGO" --out src/app/icon.png
q sips -s format png --resampleHeightWidth 180 180 "$SRC_LOGO" --out src/app/apple-icon.png

# OG image — logo centered on themeColor canvas at 1200x630.
magick "$SRC_LOGO" -resize 600x600 \
  -gravity center -background "$BG" -extent 1200x630 \
  src/app/opengraph-image.png

# ─── PWA manifest icons ───────────────────────────────────────────────────────
mkdir -p public/icons
q sips -s format png --resampleHeightWidth 192 192 "$SRC_LOGO" --out public/icons/icon-192.png
q sips -s format png --resampleHeightWidth 512 512 "$SRC_LOGO" --out public/icons/icon-512.png
q sips -s format png --resampleHeightWidth 512 512 "$SRC_LOGO" --out public/icons/icon-512-maskable.png

# ─── favicon.ico (multi-size 16/32/48) ────────────────────────────────────────
TMP_FAVICON=$(mktemp -d)
trap 'rm -rf "$TMP_FAVICON"' EXIT
for size in 16 32 48; do
  q sips -s format png --resampleHeightWidth "$size" "$size" "$SRC_LOGO" \
    --out "$TMP_FAVICON/favicon-${size}.png"
done
magick "$TMP_FAVICON/favicon-16.png" "$TMP_FAVICON/favicon-32.png" "$TMP_FAVICON/favicon-48.png" \
  public/favicon.ico

# ─── iOS app icon (alpha-stripped — Apple rejects icons with alpha) ───────────
IOS_ICON="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
q sips -s format png --resampleHeightWidth 1024 1024 "$SRC_LOGO" --out "$IOS_ICON"
magick "$IOS_ICON" -background "$BG" -alpha remove -alpha off "$IOS_ICON"

# ─── iOS splash (logo at ~40% of canvas on themeColor) ────────────────────────
SPLASH_DIR="ios/App/App/Assets.xcassets/Splash.imageset"
magick "$SRC_LOGO" -resize 1100x1100 \
  -gravity center -background "$BG" -extent 2732x2732 \
  -alpha remove -alpha off \
  "$SPLASH_DIR/splash-2732x2732.png"
cp "$SPLASH_DIR/splash-2732x2732.png" "$SPLASH_DIR/splash-2732x2732-1.png"
cp "$SPLASH_DIR/splash-2732x2732.png" "$SPLASH_DIR/splash-2732x2732-2.png"

# ─── watchOS app icon (uses watch-specific source) ────────────────────────────
WATCH_DIR="native/WatchApp/Assets.xcassets"
WATCH_ICONSET="$WATCH_DIR/AppIcon.appiconset"
mkdir -p "$WATCH_ICONSET"

# Asset catalog metadata — write only if missing so manual edits are preserved.
if [ ! -f "$WATCH_DIR/Contents.json" ]; then
  cat > "$WATCH_DIR/Contents.json" <<'JSON'
{
  "info": {
    "author": "xcode",
    "version": 1
  }
}
JSON
fi
if [ ! -f "$WATCH_ICONSET/Contents.json" ]; then
  cat > "$WATCH_ICONSET/Contents.json" <<'JSON'
{
  "images": [
    {
      "filename": "AppIcon-watchOS-1024.png",
      "idiom": "universal",
      "platform": "watchos",
      "size": "1024x1024"
    }
  ],
  "info": {
    "author": "xcode",
    "version": 1
  }
}
JSON
fi

WATCH_ICON="$WATCH_ICONSET/AppIcon-watchOS-1024.png"
q sips -s format png --resampleHeightWidth 1024 1024 "$SRC_WATCH" --out "$WATCH_ICON"
magick "$WATCH_ICON" -background "$BG" -alpha remove -alpha off "$WATCH_ICON"

echo "✓ Logo assets regenerated"
