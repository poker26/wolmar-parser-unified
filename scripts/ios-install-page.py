"""Emit the small HTTPS installation page and Apple manifest for a verified IPA."""
import argparse
import html
import plistlib
import sys
from pathlib import Path
from urllib.parse import quote, urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', required=True)
parser.add_argument('--build', required=True)
parser.add_argument('--version', required=True)
parser.add_argument('--emit', choices=['manifest', 'page'], required=True)
parser.add_argument('--output')
args = parser.parse_args()
sys.stdout.reconfigure(encoding='utf-8')
base = args.base_url.rstrip('/')
if urlparse(base).scheme != 'https' or not args.build.isdigit() or not args.version.replace('.', '').isdigit():
    raise SystemExit('Expected an HTTPS URL, numeric build version and dotted app version')
if args.emit == 'manifest':
    manifest = {'items': [{'assets': [{'kind': 'software-package', 'url': base + '/Numi.ipa'}],
        'metadata': {'bundle-identifier': 'ru.begemot26.numismat', 'bundle-version': args.build,
                     'kind': 'software', 'title': 'Нуми'}}]}
    content = plistlib.dumps(manifest).decode('utf-8')
else:
    install = 'itms-services://?action=download-manifest&url=' + quote(base + '/install.plist', safe='')
    content = '''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Установить Нуми</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:#101114;color:#ece4d8;font:18px/1.5 system-ui,-apple-system,sans-serif}
main{width:100%;max-width:430px;text-align:center;padding:42px 26px;background:#1b1c21;border:1px solid #38302b;border-radius:24px}
.seal{width:88px;height:88px;margin:0 auto 22px;border:2px solid #bc8b60;border-radius:50%;display:grid;place-items:center;color:#d7ad84;font:52px Georgia,serif}
h1{font:52px Georgia,serif;letter-spacing:.03em;margin:12px 0}.version{color:#b3aaa0;margin:12px 0 30px}
a{display:block;padding:16px 12px;border-radius:14px;background:#c9986a;color:#151310;font-weight:650;text-decoration:none}
.help{margin:24px 0 0;font-size:16px;color:#c0b7ab}a:focus-visible{outline:3px solid #fff;outline-offset:4px}
</style></head><body><main><div class="seal" aria-hidden="true">Н</div><h1>Нуми</h1>
<p class="version">Версия ''' + html.escape(args.version) + '''</p>
<a href="''' + html.escape(install, quote=True) + '''">Установить Нуми</a>
<p class="help">Откройте страницу в Safari на iPad и подтвердите установку.</p>
</main></body></html>'''
if args.output:
    Path(args.output).write_text(content, encoding='utf-8')
else:
    print(content)
