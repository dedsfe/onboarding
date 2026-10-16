#!/usr/bin/env python3
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import quote
archive, output, version, build = sys.argv[1:]
path = Path(archive)
digest = hashlib.sha256()
with path.open("rb") as file:
    for chunk in iter(lambda: file.read(1024 * 1024), b""):
        digest.update(chunk)
data = dict(version=version, build=build, minimumMacOS="26.0", architecture="arm64", notarized=True,
            url="/releases/" + quote(path.name), sha256=digest.hexdigest(),
            size=path.stat().st_size)
Path(output).write_text(json.dumps(data, indent=2) + "\n")
