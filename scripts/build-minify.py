#!/usr/bin/env python3
"""
ATP build step — minify the extracted JS/CSS assets.

Phase 3a/b foundation toward full Vite. Today this just runs rjsmin +
csscompressor over the static assets. Outputs *.min.js / *.min.css next
to the sources. Pages reference the .min variants — falls back to source
if missing.

Run locally:    python3 scripts/build-minify.py
Run on deploy:  invoked from backend's npm postinstall (TBD)

Run after editing any of the source files. Commits should include both
source and .min so Railway serves pre-minified assets without needing a
build step on its end.
"""
from __future__ import annotations
import pathlib, sys, time

try:
    import rjsmin, csscompressor
except ImportError:
    print('Install deps: pip3 install rjsmin csscompressor', file=sys.stderr)
    sys.exit(1)

ROOT = pathlib.Path(__file__).resolve().parent.parent

# (source path, min path) — both written to repo root + backend/public
JS_TARGETS = [
    'atp.js',
    'atp-api.js',
    'atp-components.js',
    'admin/core.js',
    'admin/members.js',
    'admin/ambassadors.js',
    'admin/sessions.js',
    'admin/showtoast.js',
    'admin/challenges.js',
    'admin/coaches.js',
    'admin/analytics.js',
    'admin/cms.js',
    'admin/settings.js',
    'admin/init.js',
]
CSS_TARGETS = [
    'atp.css',
    'admin/admin.css',
]

def write_both(rel_min: str, content: str) -> None:
    """Write the minified file to both repo root + backend/public/ to keep them in sync."""
    for base in ['', 'backend/public/']:
        p = ROOT / (base + rel_min)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)

def humanise(n: int) -> str:
    return f'{n//1024}KB' if n >= 1024 else f'{n}B'

def main() -> None:
    t0 = time.time()
    js_in = js_out = css_in = css_out = 0

    print('JS:')
    for src in JS_TARGETS:
        p = ROOT / src
        if not p.exists():
            print(f'  skip (missing): {src}')
            continue
        raw = p.read_text()
        mini = rjsmin.jsmin(raw, keep_bang_comments=False)
        rel_min = src.replace('.js', '.min.js')
        write_both(rel_min, mini)
        ratio = len(mini) * 100 // max(1, len(raw))
        print(f'  {src:30s} {humanise(len(raw)):>7s} → {humanise(len(mini)):>7s} ({ratio:>2d}%)')
        js_in += len(raw)
        js_out += len(mini)

    print('CSS:')
    for src in CSS_TARGETS:
        p = ROOT / src
        if not p.exists():
            print(f'  skip (missing): {src}')
            continue
        raw = p.read_text()
        mini = csscompressor.compress(raw)
        rel_min = src.replace('.css', '.min.css')
        write_both(rel_min, mini)
        ratio = len(mini) * 100 // max(1, len(raw))
        print(f'  {src:30s} {humanise(len(raw)):>7s} → {humanise(len(mini)):>7s} ({ratio:>2d}%)')
        css_in += len(raw)
        css_out += len(mini)

    # ── Bundles ─────────────────────────────────────────────────
    # Concatenate the minified pieces into single bundle files so
    # browsers fetch one resource per logical group instead of N.
    # Order matters: dependencies before consumers.
    print('\nBundles:')

    # Public site shared bundle (atp + components, in load order)
    public_parts = ['atp.min.js', 'atp-api.min.js', 'atp-components.min.js']
    public_bundle = ''
    for src in public_parts:
        p = ROOT / src
        if p.exists():
            public_bundle += '/* ===== ' + src + ' ===== */\n' + p.read_text() + '\n'
    write_both('atp.bundle.min.js', public_bundle)
    print(f'  atp.bundle.min.js              {humanise(len(public_bundle)):>7s}  ({len(public_parts)} sources)')

    # Admin bundle (all modules, in dependency order from admin.html)
    admin_parts = [
        'admin/core.min.js',
        'admin/members.min.js',
        'admin/ambassadors.min.js',
        'admin/sessions.min.js',
        'admin/showtoast.min.js',
        'admin/challenges.min.js',
        'admin/coaches.min.js',
        'admin/analytics.min.js',
        'admin/cms.min.js',
        'admin/settings.min.js',
        'admin/init.min.js',          # last so its hook into showAdminSection wraps everything else
    ]
    admin_bundle = ''
    for src in admin_parts:
        p = ROOT / src
        if p.exists():
            admin_bundle += '/* ===== ' + src + ' ===== */\n' + p.read_text() + '\n'
    write_both('admin/bundle.min.js', admin_bundle)
    print(f'  admin/bundle.min.js            {humanise(len(admin_bundle)):>7s}  ({len(admin_parts)} sources)')

    total_in = js_in + css_in
    total_out = js_out + css_out
    saved = total_in - total_out
    print(f'\nTotal source: {humanise(total_in)} → minified {humanise(total_out)} '
          f'(saved {humanise(saved)}, {saved*100//max(1,total_in)}%) '
          f'in {(time.time()-t0)*1000:.0f}ms')

if __name__ == '__main__':
    main()
