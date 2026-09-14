"""Require the requested physical device in the distribution provisioning profile."""
import os
import pathlib
import plistlib
import subprocess

udid = os.environ.get('NUMI_TEST_UDID', '').lower()
if not udid:
    raise SystemExit('NUMI_TEST_UDID is required for registered-device builds')
profile_directories = [
    pathlib.Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles',
    pathlib.Path.home() / 'Library/MobileDevice/Provisioning Profiles',
]
matches = []
for file in (file for directory in profile_directories for file in directory.glob('*.mobileprovision')):
    profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(file)]))
    if profile.get('Entitlements', {}).get('application-identifier') != '9J4X6PJX56.ru.begemot26.numismat':
        continue
    if udid in [value.lower() for value in profile.get('ProvisionedDevices', [])]:
        if profile.get('Entitlements', {}).get('get-task-allow') is not False:
            raise SystemExit('Expected a distribution profile')
        matches.append(profile['UUID'])
if not matches:
    raise SystemExit('No Numi distribution profile includes the requested device')
print('Verified registered-device profile:', ', '.join(matches))
