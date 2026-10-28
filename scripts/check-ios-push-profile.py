"""Validate production APNs entitlement in the profiles available to the signing step."""
import os
from pathlib import Path
import plistlib
import subprocess

kind = os.environ.get('IOS_DISTRIBUTION_TYPE')
assert kind in ('IOS_APP_ADHOC', 'IOS_APP_STORE'), 'Expected an iOS distribution build'
directories = [Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles',
               Path.home() / 'Library/MobileDevice/Provisioning Profiles']
matches = []
for directory in directories:
    for file in directory.glob('*.mobileprovision'):
        profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(file)]))
        entitlements = profile.get('Entitlements', {})
        if entitlements.get('application-identifier') != '9J4X6PJX56.ru.begemot26.numismat':
            continue
        if entitlements.get('get-task-allow') is not False or profile.get('ProvisionsAllDevices') is True:
            continue
        has_devices = bool(profile.get('ProvisionedDevices'))
        if has_devices != (kind == 'IOS_APP_ADHOC'):
            continue
        if entitlements.get('aps-environment') != 'production':
            continue
        matches.append(profile['UUID'])
if not matches:
    raise SystemExit('No Numi distribution profile includes the production APNs entitlement')
print('Verified production APNs profiles:', ', '.join(matches))
