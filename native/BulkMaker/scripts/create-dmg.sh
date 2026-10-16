#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h:h}"
app_path="${1:A}"
dmg_path="${2:A}"
[[ -d "$app_path/Contents" && ! -e "$dmg_path" ]] || { print 'Informe um app e um DMG de saída que ainda não exista.'; exit 1; }
stage_dir="$(mktemp -d /private/tmp/carousel-dmg.XXXXXX)"
mount_dir="$stage_dir/mount"
cleanup() {
  hdiutil detach "$mount_dir" -quiet 2>/dev/null || true
  rm -rf "$stage_dir"
}
trap cleanup EXIT
mkdir -p "$stage_dir/content/.background" "$mount_dir" "${dmg_path:h}"
ditto "$app_path" "$stage_dir/content/${app_path:t}"
ln -s /Applications "$stage_dir/content/Aplicativos"
swift "$project_dir/scripts/dmg-background.swift" "$stage_dir/content/.background/install.png"
hdiutil create -quiet -volname 'The Carousel Maker' -srcfolder "$stage_dir/content" -format UDRW "$stage_dir/edit.dmg"
hdiutil attach -quiet -readwrite -noverify -mountpoint "$mount_dir" "$stage_dir/edit.dmg"
osascript - "$mount_dir" "${app_path:t}" <<'APPLESCRIPT'
on run argv
  set mountedFolder to POSIX file (item 1 of argv) as alias
  set appName to item 2 of argv
  tell application "Finder"
    open mountedFolder
    set installerWindow to container window of mountedFolder
    set current view of installerWindow to icon view
    set toolbar visible of installerWindow to false
    set statusbar visible of installerWindow to false
    set bounds of installerWindow to {320, 180, 980, 600}
    set options to icon view options of installerWindow
    set arrangement of options to not arranged
    set icon size of options to 96
    set text size of options to 14
    set background picture of options to file ".background:install.png" of mountedFolder
    set position of item appName of mountedFolder to {175, 210}
    set position of item "Aplicativos" of mountedFolder to {485, 210}
    update mountedFolder without registering applications
    delay 1
    close installerWindow
  end tell
end run
APPLESCRIPT
sync
hdiutil detach -quiet "$mount_dir"
hdiutil convert -quiet "$stage_dir/edit.dmg" -format UDZO -imagekey zlib-level=9 -o "$dmg_path"
hdiutil verify "$dmg_path"
