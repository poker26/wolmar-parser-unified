"""Check the exported IPA and its actual code-signing entitlements on the macOS CI host."""
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import zipfile

artifacts = list(Path('build/ios/ipa').glob('*.ipa'))
assert len(artifacts) == 1, 'Expected exactly one exported IPA'
kind = os.environ['IOS_DISTRIBUTION_TYPE']
assert kind in ('IOS_APP_ADHOC', 'IOS_APP_STORE')
parent = Path('build/push-inspection')
parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=parent) as work:
    root = Path(work).resolve()
    with zipfile.ZipFile(artifacts[0]) as archive:
        for item in archive.namelist():
            assert (root / item).resolve().is_relative_to(root), 'Unsafe IPA entry'
    subprocess.run(['ditto', '-x', '-k', str(artifacts[0]), str(root)], check=True)
    apps = list((root / 'Payload').glob('*.app'))
    assert len(apps) == 1
    app = apps[0]
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    assert info['CFBundleIdentifier'] == 'ru.begemot26.numismat'
    assert set(info['UIDeviceFamily']) == {1, 2}
    assert info['MinimumOSVersion'] == '15.0'
    assert str(info.get('NumiPushEnabled')).lower() in ('yes', 'true', '1')
    assert info.get('NumiAPNSEnvironment') == 'production'
    profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')]))
    assert profile['TeamIdentifier'] == ['9J4X6PJX56']
    entitlements = profile['Entitlements']
    assert entitlements['application-identifier'] == '9J4X6PJX56.ru.begemot26.numismat'
    assert entitlements.get('get-task-allow') is False
    assert entitlements.get('aps-environment') == 'production'
    assert profile.get('ProvisionsAllDevices') is not True
    devices = profile.get('ProvisionedDevices', [])
    assert bool(devices) == (kind == 'IOS_APP_ADHOC')
    if kind == 'IOS_APP_ADHOC':
        assert '42f0aa580a1ff5b1a2666c2ca167aa7ad090b436' in [d.lower() for d in devices]
    subprocess.run(['codesign', '--verify', '--strict', str(app)], check=True)
    signed = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
    start = signed.index(b'<?xml')
    stop = signed.index(b'</plist>', start) + len(b'</plist>')
    actual = plistlib.loads(signed[start:stop])
    assert actual.get('aps-environment') == 'production'
    assert actual.get('application-identifier') == '9J4X6PJX56.ru.begemot26.numismat'
    assert actual.get('get-task-allow') is False
    result = {'bundle': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'],
              'build': info['CFBundleVersion'], 'apsEnvironment': 'production', 'signatureVerified': True,
              'profileUUID': profile['UUID'], 'registeredDeviceCount': len(devices), 'physicalDeliveryVerified': False}
    Path('build/ios-tests/push-artifact.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
