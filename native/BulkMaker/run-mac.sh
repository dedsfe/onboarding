#!/bin/zsh
set -e

project_dir="${0:A:h}"
scratch_dir="/private/tmp/bulkmaker-build"
app_dir="/private/tmp/BulkMaker-dev.app"

swift build --package-path "$project_dir" --scratch-path "$scratch_dir"
binary_dir="$(swift build --package-path "$project_dir" --scratch-path "$scratch_dir" --show-bin-path)"

mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$binary_dir/BulkMaker" "$app_dir/Contents/MacOS/BulkMaker"
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
open -a "$app_dir"
