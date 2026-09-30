#!/bin/zsh
# Production build: release binaries, signed with Developer ID + hardened runtime, notarized and stapled.
# Output: native/BulkMaker/dist/The Carousel Maker.zip, ready to send.
#
# One-time setup (asks for an app-specific password from appleid.apple.com):
#   xcrun notarytool store-credentials carousel-maker --apple-id <seu email> --team-id 4ZQ8PBTL5U
# Usage: VERSION=0.1.0 zsh release-mac.sh
set -e

project_dir="${0:A:h}"
scratch_dir="/private/tmp/bulkmaker-release"
dist_dir="$project_dir/dist"
app_dir="$dist_dir/The Carousel Maker.app"
zip_path="$dist_dir/The Carousel Maker.zip"
identity="Developer ID Application: Andre Souza (4ZQ8PBTL5U)"
profile="${NOTARY_PROFILE:-carousel-maker}"
version="${VERSION:-0.1.0}"
build_number="$(date +%Y%m%d%H%M)"

xcrun notarytool history --keychain-profile "$profile" >/dev/null 2>&1 || {
  print "Falta a credencial do notarytool. Rode uma vez:"
  print "  xcrun notarytool store-credentials $profile --apple-id <seu email> --team-id 4ZQ8PBTL5U"
  exit 1
}

# -j 2 keeps the release compile gentle on an 8 GB Mac.
swift build -c release -j 2 --package-path "$project_dir" --scratch-path "$scratch_dir"
bin_dir="$(swift build -c release --package-path "$project_dir" --scratch-path "$scratch_dir" --show-bin-path)"

rm -rf "$app_dir" "$zip_path"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$bin_dir/BulkMaker" "$app_dir/Contents/MacOS/BulkMaker"
cp "$bin_dir/carousel-render" "$app_dir/Contents/MacOS/carousel-render"
ditto "$bin_dir/BulkMaker_BulkMaker.bundle" "$app_dir/Contents/Resources/BulkMaker_BulkMaker.bundle"
cat > "$app_dir/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>The Carousel Maker</string>
  <key>CFBundleDisplayName</key><string>The Carousel Maker</string>
  <key>CFBundleExecutable</key><string>BulkMaker</string>
  <key>CFBundleIdentifier</key><string>com.andrefelipe.carouselmaker</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$build_number</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# Inner executable first, then the app; hardened runtime + secure timestamp are required for notarization.
codesign --force --timestamp --options runtime --sign "$identity" "$app_dir/Contents/MacOS/carousel-render"
codesign --force --timestamp --options runtime --sign "$identity" "$app_dir"
codesign --verify --deep --strict --verbose=2 "$app_dir"

ditto -c -k --keepParent "$app_dir" "$zip_path"
xcrun notarytool submit "$zip_path" --keychain-profile "$profile" --wait
xcrun stapler staple "$app_dir"
rm "$zip_path"
ditto -c -k --keepParent "$app_dir" "$zip_path"

spctl --assess --type execute --verbose "$app_dir"
print "\nPronto: $zip_path (versão $version, build $build_number)"
open -R "$zip_path"
