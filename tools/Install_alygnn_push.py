#!/usr/bin/env python3
"""One-time safe patch for Alygnn's existing www source files.
Runs from inside the Alygnn~new project, after copying this ZIP's www/ + tools/.
Never replaces the current application HTML; it inserts a deferred script before </body>.
"""
from pathlib import Path
import json

root=Path(__file__).resolve().parents[1]
if not (root/'www'/'app-account.html').exists():
    raise SystemExit('ERROR: Copy this ZIP contents to the Alygnn~new project root before running.')
paths=['app-account.html','app-swipe.html','app-applied.html',
       'app-messages.html','app-chat.html','app-employer-dashboard.html']
tag='\n<script defer src="app-push-notifications.js"></script>\n'
changed=0
for name in paths:
    p=root/'www'/name
    if not p.exists():
        print(f'SKIP (not present): {p}')
        continue
    content=p.read_text(encoding='utf-8')
    if 'src="app-push-notifications.js"' in content:
        print('Already configured:',name)
        continue
    pos=content.lower().rfind('</body>')
    if pos<0:
        print('ERROR (missing </body>):',name)
        continue
    p.write_text(content[:pos]+tag+content[pos:],encoding='utf-8')
    changed+=1
    print('Configured:',name)

package=root/'package.json'
if package.exists():
    data=json.loads(package.read_text(encoding='utf-8'))
    # Package is installed locally using npm. Keep its existing exact version if present.
    deps=data.setdefault('dependencies',{})
    if '@capacitor/push-notifications' not in deps:
        deps['@capacitor/push-notifications']='^8.1.3'
        package.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
        print('Added push dependency to package.json')
    else:
        print('Push dependency already present in package.json')
else:
    print('WARNING: package.json not found')
print(f'Done: {changed} application pages modified. No visual styles changed.')
