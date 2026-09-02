# Zewasliga

A zero-waste slide gallery that turns a local image directory into a changing, full-screen photo mosaic. Images are read directly in the browser and are never uploaded.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, choose a folder of JPG, PNG, WebP, AVIF, or GIF files, and the slideshow starts automatically.

## Controls

- `Space` or `K`: pause and play
- `→`: show the next mix
- `F`: toggle fullscreen
- `O`: choose another folder

The folder picker uses the File System Access API where available and falls back to a directory file input in other browsers.

## Build for local preview

```bash
npm run build
npm run preview
```

Zewasliga has no backend, deployment configuration, analytics, or upload service. The production build is only for running a locally optimized preview.
