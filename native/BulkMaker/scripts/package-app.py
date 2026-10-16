#!/usr/bin/env python3
"""Assemble a SwiftPM app without changing signing or publishing anything."""
import argparse
import json
import plistlib
import shutil
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("bin_dir", type=Path)
p.add_argument("sparkle_dir", type=Path)
p.add_argument("app", type=Path)
p.add_argument("version")
p.add_argument("build")
p.add_argument("--preview", action="store_true")
p.add_argument("--profile", type=Path)
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
if a.app.exists():
    raise SystemExit("A pasta de saída já existe. Use uma nova pasta de build.")
macos = a.app / "Contents/MacOS"
resources = a.app / "Contents/Resources"
frameworks = a.app / "Contents/Frameworks"
for directory in (macos, resources, frameworks):
    directory.mkdir(parents=True, exist_ok=True)
for binary in ("BulkMaker", "carousel-render"):
    shutil.copy2(a.bin_dir / binary, macos / binary)
shutil.copytree(a.bin_dir / "BulkMaker_BulkMaker.bundle", resources / "BulkMaker_BulkMaker.bundle", symlinks=True)
shutil.copytree(a.sparkle_dir / "Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework",
                frameworks / "Sparkle.framework", symlinks=True)
info = dict(CFBundleName="The Carousel Maker", CFBundleDisplayName="The Carousel Maker",
            CFBundleExecutable="BulkMaker", CFBundleIdentifier="com.andrefelipe.carouselmaker" + (".dev" if a.preview else ""),
            CFBundlePackageType="APPL", CFBundleShortVersionString=a.version,
            CFBundleVersion=a.build, LSMinimumSystemVersion="26.0",
            LSApplicationCategoryType="public.app-category.productivity", NSHighResolutionCapable=True,
            SUSendProfileInfo=False, SUEnableSystemProfiling=False,
            SURequireSignedFeed=True, SUVerifyUpdateBeforeExtraction=True)
updates = json.loads((root / "updates.json").read_text())
if not a.preview:
    info.update(SUFeedURL=updates["feedURL"], SUPublicEDKey=updates["publicEDKey"])
    shutil.copy2(a.profile, a.app / "Contents/embedded.provisionprofile")
with (a.app / "Contents/Info.plist").open("wb") as f:
    plistlib.dump(info, f)
