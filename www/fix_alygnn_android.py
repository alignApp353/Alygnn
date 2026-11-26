#!/usr/bin/env python3
"""Targeted Alygnn Android www fixes; backs up files before editing."""
from pathlib import Path
import re, shutil, sys

root=Path.cwd()
www=root/'www'
if not www.is_dir():
    print('ERROR: Run this from the Alygnn project folder containing www/. No files changed.')
    sys.exit(1)
files=['app-start.html','app-login.html','app-employer-login.html','app-swipe.html']
missing=[name for name in files if not (www/name).is_file()]
if missing:
    print('ERROR: Missing '+', '.join(missing)+'. No files changed.')
    sys.exit(1)

contents={n:(www/n).read_text(encoding='utf-8') for n in files}

# Replace a named JS function with balanced braces, respecting comments and strings
# (the functions we alter here contain no complex template literals).
def replace_function(text, name, replacement):
    m=re.search(r'\bfunction\s+'+re.escape(name)+r'\s*\([^)]*\)\s*\{',text)
    if not m: raise RuntimeError('Missing function '+name)
    start=m.start(); brace=m.end()-1
    level=0; state='normal'; esc=False; i=brace
    while i<len(text):
        ch=text[i]; nxt=text[i+1] if i+1<len(text) else ''
        if state in ('single','double','template'):
            if esc:esc=False
            elif ch=='\\':esc=True
            elif (state=='single' and ch=="'") or (state=='double' and ch=='"') or (state=='template' and ch=='`'):state='normal'
        elif state=='line':
            if ch=='\n':state='normal'
        elif state=='block':
            if ch=='*' and nxt=='/':state='normal';i+=1
        else:
            if ch=='/' and nxt=='/':state='line';i+=1
            elif ch=='/' and nxt=='*':state='block';i+=1
            elif ch=="'":state='single'
            elif ch=='"':state='double'
            elif ch=='`':state='template'
            elif ch=='{':level+=1
            elif ch=='}':
                level-=1
                if level==0:return text[:start]+replacement+text[i+1:]
        i+=1
    raise RuntimeError('Unbalanced function '+name)

# One appearance source for the unauthenticated chooser and both login pages.
# A single shared preference is respected when explicitly present, otherwise
# Android's system setting is used. Never switch theme on account-role selection.
common_pref='''function preference(){
    for(const key of ['alygnnTheme','alygnn-theme','alygnn_theme']){
      const v=normalize(read(key));
      if(v) return v;
    }
    return 'auto';
  }'''
for n in ('app-login.html','app-employer-login.html'):
    contents[n]=replace_function(contents[n],'preference',common_pref)

start=contents['app-start.html']
if 'function preference(role)' not in start:
    raise SystemExit('ERROR: app-start.html changed unexpectedly. No files changed.')
start=replace_function(start,'preference', '''function preference(role){
    // The chooser uses the SAME appearance for either role.
    for(const key of ['alygnnTheme','alygnn-theme','alygnn_theme']){
      const v=normalize(read(key));
      if(v) return v;
    }
    return 'auto';
  }''')
contents['app-start.html']=start

# Existing older tablet rules (including justify-content:center) are retained
# for easy rollback, but a single final CSS rule wins on portrait tablets.
swipe=contents['app-swipe.html']
marker='alygnn-android-portrait-gap-correction-20261125'
if marker not in swipe:
    css=f'''\n<style id="{marker}">
/* Only tablet portrait. Align the card below the stats instead of centering
   it inside the remaining screen; keep the existing button/card design. */
@media (min-width:600px) and (orientation:portrait){{
  body:not(.no-jobs-mode) #swipe-area{{
    --alygnn-group-top-pad:clamp(16px,2dvh,24px)!important;
    justify-content:flex-start!important;
    height:auto!important;
    min-height:0!important;
    padding-top:clamp(16px,2dvh,24px)!important;
  }}
}}
</style>
'''
    if '</head>' not in swipe:raise SystemExit('ERROR: app-swipe.html has no head. No files changed.')
    swipe=swipe.replace('</head>',css+'</head>',1)
contents['app-swipe.html']=swipe

backups=root/'alygnn-android-backup-before-theme-spacing'
backups.mkdir(exist_ok=True)
for n in files:
    shutil.copy2(www/n,backups/n)
for n in files:
    (www/n).write_text(contents[n],encoding='utf-8')
print('Updated ONLY: '+', '.join(files))
print('Original backups: '+str(backups))
print('Next: npx cap sync android')
