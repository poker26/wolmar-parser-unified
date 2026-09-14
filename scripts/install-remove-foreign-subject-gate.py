"""Remove the unsafe hard subject gate while preserving issuer aliases."""

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
base = "numismatics-numis-web:foreign-issuer-aliases-20260914"
image = "numismatics-numis-web:foreign-issuer-no-subject-gate-20260914"
expected_refserver_sha256 = "d590ea11b1a0e34b37fba5062fc627ec18a38c520ef262d1c1d328b8c8721fbd"
folder = Path("/opt/numismatics/releases/foreign-issuer-no-subject-gate-20260914")
override = Path("/opt/numismatics/releases/bioclip-ranking-20260912/docker-compose.release.yml")

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
import_line = b"from refserver_foreign_subjects import foreign_subject_conflicts\n"
gate = (
    b"    if foreign_subject_conflicts(ex, row):\n"
    b"        return False\n"
)
assert patched.count(import_line) == 1
assert patched.count(gate) == 1
patched = patched.replace(import_line, b"").replace(gate, b"")
assert b"foreign_subject_conflicts" not in patched
compile(patched, "/app/refserver.py", "exec")

folder.mkdir(parents=True, exist_ok=True)
(folder / "refserver.py").write_bytes(patched)
(folder / "Dockerfile").write_text(
    "FROM " + base + "\nCOPY refserver.py /app/refserver.py\n",
    encoding="utf-8",
)
subprocess.run(["docker", "build", "--pull=false", "-t", image, str(folder)], check=True)
for test in (
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
    "foreign-issuer-no-subject-gate-"
    + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
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
    subprocess.run(compose + [
        "up", "-d", "--no-deps", "--no-build", "--pull", "never", "numis-web",
    ], check=True)
    raise

print(json.dumps({
    "image": image,
    "backup": str(backup),
    "refserver_sha256": hashlib.sha256(patched).hexdigest(),
    "applied": True,
}))
