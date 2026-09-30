#!/usr/bin/env python3
"""Builds Sources/BulkMaker/Resources/obras-nga.json from the National Gallery of Art open data.

Keeps open-access (CC0) paintings that are landscape-shaped and large enough for a 2560px wallpaper.
Usage: python3 export-nga-artworks.py <dir with objects.csv and published_images.csv>
Data: https://github.com/NationalGalleryOfArt/opendata
"""
import csv
import json
import os
import sys

csv.field_size_limit(sys.maxsize)
source = sys.argv[1]
objects = {row["objectid"]: row for row in csv.DictReader(open(os.path.join(source, "objects.csv"), encoding="utf-8"))}
artworks = []
for image in csv.DictReader(open(os.path.join(source, "published_images.csv"), encoding="utf-8")):
    art = objects.get(image["depictstmsobjectid"])
    width, height = int(image["width"] or 0), int(image["height"] or 0)
    if image["openaccess"] != "1" or image["viewtype"] != "primary" or not art:
        continue
    if art["classification"] != "Painting" or width < 2400 or width < height * 1.2:
        continue
    artworks.append({"id": image["uuid"], "title": art["title"].strip(),
                     "artist": art["attribution"].strip(), "date": art["displaydate"].strip()})
artworks.sort(key=lambda item: item["id"])
target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Sources/BulkMaker/Resources/obras-nga.json")
with open(target, "w", encoding="utf-8") as file:
    json.dump(artworks, file, ensure_ascii=False, separators=(",", ":"))
print(f"{len(artworks)} obras → {target}")
