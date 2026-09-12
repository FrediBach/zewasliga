# Zewasliga

A zero-waste slide gallery that turns a local image directory into a changing, full-screen photo mosaic. Images are read directly in the browser and are never uploaded.

Every slide is planned for the current viewport. Zewasliga compares fair combinations of recently unused photos, matches portrait and landscape images to row- and column-based mosaics, and chooses the arrangement with the least crop. Photos that receive the smallest tiles are carried into the next slide and promoted into its largest spaces. The mosaic always covers the full screen and automatically replans itself when the window or device orientation changes.

## Run locally

```bash
nvm use
npm ci
npm run dev
```

Open `http://localhost:5173`, choose a folder of JPG, PNG, WebP, AVIF, or GIF files, and the slideshow starts automatically.

## Controls

- `Space` or `K`: pause and play
- `←` / `→`: show the previous or next mix
- `↓`: dismiss the current mix and show the next one
- `↑`: hold the current mix for one more selected duration
- Hold `Shift` over a photo: inspect it with the detail lens and pause the slide countdown; press `+` to zoom in further
- `Enter` while hovering over a photo: love or unlove it; loved photos may reappear occasionally during the rotation
- `F`: toggle fullscreen
- `O`: choose another folder

The folder picker uses the File System Access API where available and falls back to a directory file input in other browsers.

## Production build

```bash
npm run build
npm run preview
```

## Deploy to Vercel

Import this repository into Vercel with the repository root as the project directory. `vercel.json` selects Vite, installs with `npm ci`, runs tests before the production build, and publishes `dist`. Node.js 22 is pinned in `package.json` and `.nvmrc`. No environment variables or backend services are required.

In the project's **Settings → Domains**, add `www.zewasliga.com` and `zewasliga.com`, then apply the DNS records Vercel provides at your DNS provider. The configuration permanently redirects the apex domain to `https://www.zewasliga.com`. Preview deployment URLs remain usable. Keep Vercel's preview deployment protection enabled.

The canonical URL, Open Graph and Twitter cards, robots.txt, and sitemap use `https://www.zewasliga.com/`. After deployment, verify the domain's HTTPS certificate, apex redirect, folder selection, playback, fullscreen, and social image at `/og-image.png`.

Security headers allow local blob images and the inline styles used by the mosaic while blocking network connections from the app, external scripts, and framing. Hashed Vite assets receive immutable caching. There is no catch-all rewrite: this app has one route, so unknown paths should return 404 rather than duplicate the home page.

GitHub Actions runs the test suite and production build on pushes and pull requests. Vercel also runs tests before each build.

## Brand assets

The favicon uses a charcoal Z and red period on the portfolio's off-white background. `public/` contains the SVG and ICO favicons, Apple touch icon, manifest icons, and a 1200 × 630 PNG social preview. To regenerate the PNG assets on macOS, run `swift scripts/generate-brand-assets.swift`. Assets are checked in, so deployment does not require Swift.

The manifest supplies application identity and home-screen icons; it does not provide offline support. Images remain local to the browser and are never uploaded.

Configuration reference: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) and [vercel.json](https://vercel.com/docs/project-configuration/vercel-json).
