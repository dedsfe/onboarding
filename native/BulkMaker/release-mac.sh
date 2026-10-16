#!/bin/zsh
# Setup: xcrun notarytool store-credentials carousel-maker --apple-id <email> --team-id 4ZQ8PBTL5U
# Release: PROVISIONING_PROFILE=/path/profile.provisionprofile zsh release-mac.sh
# Local smoke test, never publish: zsh release-mac.sh --preview
set -euo pipefail
project_dir="${0:A:h}"
cd "$project_dir"
preview=false
[[ "${1:-}" == '--preview' ]] && preview=true
version="$(<VERSION)"
build_number="$(date -u +%Y%m%d%H%M%S)"
identity='Developer ID Application: Andre Souza (4ZQ8PBTL5U)'
profile="${NOTARY_PROFILE:-carousel-maker}"
if $preview; then
  scratch_dir=/private/tmp/bulkmaker-build
  output_dir="$project_dir/dist/preview/$build_number"
  swift build --scratch-path "$scratch_dir"
  bin_dir="$(swift build --scratch-path "$scratch_dir" --show-bin-path)"
else
  python3 scripts/release-preflight.py
  xcrun notarytool history --keychain-profile "$profile" >/dev/null 2>&1 || {
    print "Configure o notarytool: xcrun notarytool store-credentials $profile --apple-id <email> --team-id 4ZQ8PBTL5U"
    exit 1
  }
  scratch_dir=/private/tmp/bulkmaker-release
  output_dir="$project_dir/dist/$version-$build_number"
  swift build -c release -j 2 --scratch-path "$scratch_dir"
  bin_dir="$(swift build -c release --scratch-path "$scratch_dir" --show-bin-path)"
fi
mkdir -p "$output_dir"
app_dir="$output_dir/The Carousel Maker.app"
sparkle_dir="$scratch_dir/artifacts/sparkle/Sparkle"
args=("$bin_dir" "$sparkle_dir" "$app_dir" "$version" "$build_number")
if $preview; then args+=(--preview); else args+=(--profile "$PROVISIONING_PROFILE"); fi
python3 scripts/package-app.py "${args[@]}"
if $preview; then
  codesign --force --deep --sign - "$app_dir"
else
  framework="$app_dir/Contents/Frameworks/Sparkle.framework/Versions/B"
  for component in "$framework/XPCServices/Downloader.xpc" "$framework/XPCServices/Installer.xpc" "$framework/Autoupdate" "$framework/Updater.app"; do
    codesign --force --timestamp --options runtime --preserve-metadata=entitlements --sign "$identity" "$component"
  done
  codesign --force --timestamp --options runtime --sign "$identity" "$app_dir/Contents/Frameworks/Sparkle.framework"
  codesign --force --timestamp --options runtime --sign "$identity" "$app_dir/Contents/MacOS/carousel-render"
  codesign --force --timestamp --options runtime --sign "$identity" --entitlements Xcode/CarouselMaker.entitlements "$app_dir"
fi
codesign --verify --deep --strict --verbose=2 "$app_dir"
zip_path="$output_dir/The Carousel Maker-$version.zip"
ditto -c -k --keepParent "$app_dir" "$zip_path"
if ! $preview; then
  xcrun notarytool submit "$zip_path" --keychain-profile "$profile" --wait
  xcrun stapler staple "$app_dir"
  rm "$zip_path"
  ditto -c -k --keepParent "$app_dir" "$zip_path"
fi
dmg_path="$output_dir/The Carousel Maker-$version.dmg"
zsh scripts/create-dmg.sh "$app_dir" "$dmg_path"
if ! $preview; then
  codesign --timestamp --sign "$identity" "$dmg_path"
  xcrun notarytool submit "$dmg_path" --keychain-profile "$profile" --wait
  xcrun stapler staple "$dmg_path"
  xcrun stapler validate "$dmg_path"
  spctl --assess --type execute --verbose "$app_dir"
  feed_dir="$output_dir/publish/releases"
  mkdir -p "$feed_dir"
  cp "$dmg_path" "$feed_dir/"
  feed_url="$(python3 -c 'import json; print(json.load(open("updates.json"))["feedURL"])')"
  account="$(python3 -c 'import json; print(json.load(open("updates.json"))["keychainAccount"])')"
  "$sparkle_dir/bin/generate_appcast" --account "$account" --download-url-prefix "${feed_url:h}/releases/" \
    --maximum-deltas 0 -o "$output_dir/publish/appcast.xml" "$feed_dir"
  python3 scripts/release-manifest.py "$dmg_path" "$output_dir/publish/latest.json" "$version" "$build_number"
fi
print "Pronto: $dmg_path"
if $preview; then print 'PRÉVIA LOCAL: assinatura ad-hoc, sem notarização; não distribuir.'; fi
