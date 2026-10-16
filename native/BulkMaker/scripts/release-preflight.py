#!/usr/bin/env python3
import base64
import datetime
import fnmatch
import json
import os
import plistlib
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

root = Path(__file__).resolve().parents[1]
version = (root / "VERSION").read_text().strip()
if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?", version):
    raise SystemExit("VERSION deve conter uma versão como 0.1.0.")
updates = json.loads((root / "updates.json").read_text())
feed = urlparse(updates["feedURL"])
if feed.scheme != "https" or not feed.netloc or not feed.path.endswith("/appcast.xml"):
    raise SystemExit("Configure feedURL HTTPS em updates.json, terminando em /appcast.xml.")
if len(base64.b64decode(updates["publicEDKey"], validate=True)) != 32:
    raise SystemExit("Configure a chave pública EdDSA de Sparkle em updates.json.")
profile = os.environ.get("PROVISIONING_PROFILE", "")
if not profile or not Path(profile).is_file():
    raise SystemExit("Defina PROVISIONING_PROFILE com o perfil Developer ID que autoriza o grupo do Data Protection Keychain.")
raw = subprocess.check_output(["security", "cms", "-D", "-i", profile], stderr=subprocess.DEVNULL)
data = plistlib.loads(raw)
entitlements = data.get("Entitlements", {})
app_id = "4ZQ8PBTL5U.com.andrefelipe.carouselmaker"
if not any(fnmatch.fnmatchcase(app_id, group) for group in entitlements.get("keychain-access-groups", [])):
    raise SystemExit("O perfil não autoriza o grupo do Keychain deste app.")
if not fnmatch.fnmatchcase(app_id, entitlements.get("com.apple.application-identifier", "")):
    raise SystemExit("O perfil não autoriza o identificador deste app.")
if data["ExpirationDate"] < datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
    raise SystemExit("O perfil Developer ID expirou.")
print("Configuração pública e perfil Developer ID verificados.")
