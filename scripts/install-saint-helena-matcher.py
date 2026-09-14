"""Build and optionally deploy the foreign-issuer matcher correction."""

import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def output(*args):
    return subprocess.check_output(args, text=True).strip()


container = "numismatics-numis-web-1"
base = "numismatics-numis-web:trace-barrier-20260914"
image = "numismatics-numis-web:foreign-issuer-aliases-20260914"
expected_refserver_sha256 = "1bb17c46fe41ad0f3af1e8580d943e9504d036e490e9e11ec2b6d167193aae9a"
folder = Path("/opt/numismatics/releases/foreign-issuer-aliases-20260914")
override = Path("/opt/numismatics/releases/bioclip-ranking-20260912/docker-compose.release.yml")
source = Path(__file__).resolve().parent

before = json.loads(output("docker", "inspect", container))[0]
assert before["Config"]["Image"] == base, "Active image changed"
assert output("docker", "image", "inspect", base, "--format", "{{.Id}}") == before["Image"]
original = subprocess.check_output(["docker", "exec", container, "cat", "/app/refserver.py"])
assert hashlib.sha256(original).hexdigest() == expected_refserver_sha256, "refserver.py changed"
changes = output("docker", "diff", container).splitlines()
assert not [
    value for value in changes
    if value.startswith(("A /app/", "C /app/", "D /app/")) and "/__pycache__" not in value
]

patched = original


def replace_once(needle: bytes, replacement: bytes):
    global patched
    assert patched.count(needle) == 1, needle.decode("utf-8", errors="replace")
    patched = patched.replace(needle, replacement)


replace_once(
    b"import identification_observability\n",
    b"import identification_observability\n"
    b"from refserver_foreign_issuers import (\n"
    b"    canonicalize_foreign_issuer, catalog_country_variants, issuer_from_legends,\n"
    b")\n",
)
replace_once(
    b"def _canon_country(c):\n"
    b"    if not c:\n"
    b"        return None\n"
    b"    c = c.strip()\n"
    b"    return _C_ALIAS.get(_fold_text(c), c)\n",
    b"def _canon_country(c):\n"
    b"    if not c:\n"
    b"        return None\n"
    b"    c = c.strip()\n"
    b"    return canonicalize_foreign_issuer(_C_ALIAS.get(_fold_text(c), c))\n",
)
replace_once(
    b"def _country_from_legends(extracted):\n"
    b"    \"\"\"A literal foreign issuer on the coin outranks a conflicting model guess.\"\"\"\n"
    b"    text_value = _fold_text(\" \".join(str(value or \"\") for value in extracted.get(\"legends\") or []))\n",
    b"def _country_from_legends(extracted):\n"
    b"    \"\"\"A literal foreign issuer on the coin outranks a conflicting model guess.\"\"\"\n"
    b"    literal_issuer = issuer_from_legends(extracted.get(\"legends\") or [])\n"
    b"    if literal_issuer:\n"
    b"        return literal_issuer\n"
    b"    text_value = _fold_text(\" \".join(str(value or \"\") for value in extracted.get(\"legends\") or []))\n",
)
replace_once(
    b"    params = {\"country\": country or \"\", \"year\": year or 0}\n"
    b"    async with async_session() as ses:\n"
    b"        res = await ses.execute(_SQL, params)\n"
    b"        rows = [dict(r._mapping) for r in res]\n\n"
    b"    scored = _rank_foreign_candidates(ex, country, rows)\n",
    b"    query_countries = catalog_country_variants(country) if country else (\"\",)\n"
    b"    rows_by_id = {}\n"
    b"    async with async_session() as ses:\n"
    b"        for query_country in query_countries:\n"
    b"            res = await ses.execute(_SQL, {\"country\": query_country, \"year\": year or 0})\n"
    b"            for record in res:\n"
    b"                row = dict(record._mapping)\n"
    b"                rows_by_id[row[\"id\"]] = row\n"
    b"    rows = list(rows_by_id.values())\n\n"
    b"    scored = _rank_foreign_candidates(ex, country, rows)\n",
)

compile(patched, "/app/refserver.py", "exec")
folder.mkdir(parents=True, exist_ok=True)
(folder / "refserver.py").write_bytes(patched)
for name in (
    "refserver_foreign_issuers.py",
    "test_refserver_foreign_issuers.py",
):
    shutil.copy2(source / name, folder / name)
(folder / "Dockerfile").write_text(
    "FROM " + base + "\n"
    "COPY refserver.py refserver_foreign_issuers.py "
    "test_refserver_foreign_issuers.py /app/\n",
    encoding="utf-8",
)
subprocess.run(["docker", "build", "--pull=false", "-t", image, str(folder)], check=True)
for test in (
    "/app/test_refserver_foreign_issuers.py",
    "/app/test_identification_trace_barrier.py",
    "/app/test_vision_payload.py",
):
    subprocess.run(["docker", "run", "--rm", "--entrypoint", "python", image, test], check=True)

if "--apply" not in sys.argv:
    print(json.dumps({"built": image, "applied": False}))
    raise SystemExit(0)

config = override.read_text(encoding="utf-8")
assert config.count("image: " + base) == 1, "Release image changed"
assert json.loads(output("docker", "inspect", container))[0]["Id"] == before["Id"]
backup = Path("/opt/numismatics/backups") / (
    "foreign-issuer-aliases-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
)
backup.mkdir(mode=0o700)
shutil.copy2(override, backup / "docker-compose.release.yml")
(backup / "refserver.py").write_bytes(original)
override.write_text(config.replace("image: " + base, "image: " + image), encoding="utf-8")
compose = [
    "docker", "compose", "-p", "numismatics",
    "-f", "/opt/numismatics/docker-compose.yml",
    "-f", "/opt/numismatics/docker-compose.override.yml",
    "-f", str(override),
]
try:
    subprocess.run(compose + [
        "up", "-d", "--no-deps", "--no-build", "--pull", "never",
        "--wait", "--wait-timeout", "45", "numis-web",
    ], check=True)
    subprocess.run([
        "curl", "--fail", "--silent", "--show-error", "--retry", "8",
        "--retry-all-errors", "--retry-delay", "1", "--max-time", "3",
        "http://127.0.0.1:8077/refhealth",
    ], check=True)
except Exception:
    override.write_text(config, encoding="utf-8")
    subprocess.run(compose + ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "numis-web"], check=True)
    raise

print(json.dumps({
    "image": image,
    "backup": str(backup),
    "refserver_sha256": hashlib.sha256(patched).hexdigest(),
    "applied": True,
}))
