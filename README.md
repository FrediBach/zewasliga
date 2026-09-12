# Zewasliga

A zero-waste slide gallery that turns a local directory into a changing, full-screen photo and video mosaic, with an optional MP3 or WAV soundtrack. All media is read directly in the browser and is never uploaded.

Every slide is planned for the current viewport. Zewasliga compares fair combinations of recently unused photos, matches portrait and landscape images to row- and column-based mosaics, and chooses the arrangement with the least crop. Photos that receive the smallest tiles are carried into the next slide and promoted into its largest spaces. The mosaic always covers the full screen and automatically replans itself when the window or device orientation changes.

## Run locally

```bash
nvm use
npm ci
npm run dev
```

Open `http://localhost:5173`, choose a folder of JPG, PNG, WebP, AVIF, GIF, MP4, or MOV files, and the slideshow starts automatically.

Videos use their detected dimensions in the same layouts, crop minimization, fair rotation, favorites, and view tracking as photos. They play inline and muted. Click a video to toggle its sound; only one visible video is audible at a time. Video sound is independent of the optional music soundtrack. Press `P` over a photo or video to feature it on the next slide.

A slide containing videos defaults to the longest video's duration, even when shorter than the selected photo pace. Shorter videos loop. `↑` adds another full slide duration, so videos loop during the extension too. The Pace menu can override the current video slide or restore its automatic duration; future video slides use their own durations. Pausing the slideshow or using the detail lens pauses the videos and countdown together. Loading videos also holds the countdown. New slides start their videos from the beginning and muted.

MP4 and MOV are containers; playback depends on the codecs supported by the browser. Files the browser cannot open are skipped with a message. Videos remain local, and only their metadata is loaded during folder scanning.

Include MP3 or WAV files in the folder or its subfolders to add music. Both formats can share a playlist. Tracks play in natural filename/path order (`2` before `10`) and repeat after the last track. Music has its own play/pause button, with two subtle bars that respond to the sound, and a flat vertical volume bar. Folders containing only music also work. If the browser blocks automatic audio playback, press the music button or `A` to start.

Music is decoded locally ahead of playback. The next track is scheduled on the audio clock, with another track prepared in advance; only a small rolling set of decoded tracks is retained. Short gain ramps soften track edges, pause/resume, skipping, and volume changes. Silence already recorded into an audio file remains part of the track. Unreadable tracks are skipped with a message.

## Controls

- `Space` or `K`: pause and play the slideshow
- `A`: pause and play music independently
- `M`: mute or unmute music
- `−` / `=`: lower or raise music volume by 5%
- `[` / `]`: previous or next music track
- `←` / `→`: show the previous or next mix
- `↓`: dismiss the current mix and show the next one
- `↑`: hold the current mix for one more slide duration (video duration by default on video slides)
- Hold `Shift` over a photo or video: inspect it with the detail lens and pause playback and the countdown; press `+` to zoom in further
- `Enter` while hovering over a photo or video: love or unlove it; loved items may reappear occasionally during the rotation
- `P` while hovering over a photo or video: feature it on the next slide
- `V` while hovering over a video: toggle its sound, just like clicking it
- `F`: toggle fullscreen
- `O`: choose another folder

The folder picker uses the File System Access API where available and falls back to a directory file input in other browsers.

The volume bar also supports the arrow keys and Home/End when focused. Music shortcuts leave text inputs and native control keys alone. The sound animation respects reduced-motion preferences.

## Production build

```bash
npm run build
npm run preview
```

## Deploy to Vercel

Import this repository into Vercel with the repository root as the project directory. `vercel.json` selects Vite, installs with `npm ci`, runs tests before the production build, and publishes `dist`. Node.js 22 is pinned in `package.json` and `.nvmrc`. No environment variables or backend services are required.

In the project's **Settings → Domains**, add `www.zewasliga.com` and `zewasliga.com`, then apply the DNS records Vercel provides at your DNS provider. The configuration permanently redirects the apex domain to `https://www.zewasliga.com`. Preview deployment URLs remain usable. Keep Vercel's preview deployment protection enabled.

The canonical URL, Open Graph and Twitter cards, robots.txt, and sitemap use `https://www.zewasliga.com/`. After deployment, verify the domain's HTTPS certificate, apex redirect, folder selection, playback, fullscreen, and social image at `/og-image.png`.

Security headers allow local blob images and videos and the inline styles used by the mosaic while blocking network connections from the app, external scripts, and framing. Hashed Vite assets receive immutable caching. There is no catch-all rewrite: this app has one route, so unknown paths should return 404 rather than duplicate the home page.

GitHub Actions runs the test suite and production build on pushes and pull requests. Vercel also runs tests before each build.

## Brand assets

The favicon uses a charcoal Z and red period on the portfolio's off-white background. `public/` contains the SVG and ICO favicons, Apple touch icon, manifest icons, and a 1200 × 630 PNG social preview. To regenerate the PNG assets on macOS, run `swift scripts/generate-brand-assets.swift`. Assets are checked in, so deployment does not require Swift.

The manifest supplies application identity and home-screen icons; it does not provide offline support. Images, videos, and music remain local to the browser and are never uploaded.

Configuration reference: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) and [vercel.json](https://vercel.com/docs/project-configuration/vercel-json).
