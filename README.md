# touchshell.com

The marketing site for [Touchshell](https://github.com/keithvassallomt/touchshell) — a GNOME Shell extension that makes GNOME feel more natural on touchscreen devices.

The site is a single static page with an interactive in-browser GNOME mock, so visitors on a touchscreen can try the gestures (swipe up from the bottom, drag down from the top-right for quick settings, flick a window away to close it, etc.) without installing anything.

## What's here

```
.
├── index.html      # Page markup + GNOME mock DOM
├── styles.css      # All styling (including the GNOME shell mock)
├── app.js          # Gesture sim, feature grid, lightbox, syntax highlighting
└── assets/         # SVG icons, swipe glyphs, badges
```

No build step, no bundler, no dependencies. Vanilla HTML, CSS and ES modules.

## Run locally

Any static file server will do:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

The site uses `<script type="module">`, so opening `index.html` directly via `file://` will fail CORS — always serve it over HTTP.

## Deploy

It's a static site, so any static host works (GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket, etc.). Point the host at this directory; there's nothing to compile.

## Demo videos

The mobile fallback and feature lightbox load short `.webm` clips from the [demos-v1 release](https://github.com/keithvassallomt/touchshell/releases/tag/demos-v1) on the extension repo, fetched lazily on demand to keep the page light.

## Friendly Manifesto

This project voluntarily adheres to [The Friendly Manifesto](https://friendlymanifesto.org).

## License

MIT — see [LICENSE](LICENSE).

The Touchshell extension itself is GPL-2.0-or-later; this is the website only.
