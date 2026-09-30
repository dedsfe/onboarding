#!/bin/zsh
set -e

project_dir="${0:A:h}"
scratch_dir="/private/tmp/bulkmaker-build"
app_dir="/private/tmp/BulkMaker-dev.app"

swift build --package-path "$project_dir" --scratch-path "$scratch_dir"
binary_dir="$(swift build --package-path "$project_dir" --scratch-path "$scratch_dir" --show-bin-path)"

mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$binary_dir/BulkMaker" "$app_dir/Contents/MacOS/BulkMaker"
# Our native slide renderer; TerminalHandoff copies it into each project's .bulk-maker/bin.
cp "$binary_dir/carousel-render" "$app_dir/Contents/MacOS/carousel-render"
ditto "$binary_dir/BulkMaker_BulkMaker.bundle" "$app_dir/Contents/Resources/BulkMaker_BulkMaker.bundle"
cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>BulkMaker</string>
  <key>CFBundleDisplayName</key><string>The Carousel Maker - Lote</string>
  <key>CFBundleExecutable</key><string>BulkMaker</string>
  <key>CFBundleIdentifier</key><string>com.andrefelipe.bulkmaker.dev</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

codesign --force --deep --sign - "$app_dir"
# One instance only: an old copy left running keeps rewriting the AI workspace with old code.
pkill -f "$app_dir/Contents/MacOS/BulkMaker" 2>/dev/null || true
while pgrep -f "$app_dir/Contents/MacOS/BulkMaker" >/dev/null; do sleep 0.2; done
open -a "$app_dir"
