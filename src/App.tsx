import { ChangeEvent, CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { arrangePhotos, createSmartMosaic, MosaicLayout, PhotoUsage, Viewport } from "./layout";

type Photo = { id: string; name: string; url: string; width: number; height: number };
type DirectoryPickerHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};
type DirectoryPickerWindow = Window & { showDirectoryPicker?: () => Promise<DirectoryPickerHandle> };

const IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const SPEEDS = [3000, 5000, 8000, 12000];

function getDimensions(url: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 1, height: 1 });
    image.src = url;
  });
}

async function photosFromFiles(files: File[]) {
  const supported = files.filter((file) => IMAGE_TYPES.has(file.type) || /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name));
  return Promise.all(supported.map(async (file, index) => {
    const url = URL.createObjectURL(file);
    const dimensions = await getDimensions(url);
    return { id: `${file.name}-${file.lastModified}-${index}`, name: file.name.replace(/\.[^.]+$/, ""), url, ...dimensions };
  }));
}

async function collectImages(handle: DirectoryPickerHandle): Promise<File[]> {
  const files: File[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "file") {
      const file = await entry.getFile();
      if (IMAGE_TYPES.has(file.type) || /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name)) files.push(file);
    } else if (entry.kind === "directory") files.push(...(await collectImages(entry as DirectoryPickerHandle)));
  }
  return files;
}

type GalleryFrame = { layout: MosaicLayout<Photo>; key: number };

function currentViewport(): Viewport {
  if (typeof window === "undefined") return { width: 1280, height: 720 };
  return { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) };
}

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [frame, setFrame] = useState<GalleryFrame | null>(null);
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5000);
  const [showChrome, setShowChrome] = useState(true);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const photosRef = useRef<Photo[]>([]);
  const frameRef = useRef<GalleryFrame | null>(null);
  const viewportRef = useRef<Viewport>(currentViewport());
  const historyRef = useRef<Map<string, PhotoUsage>>(new Map());
  const slideNumberRef = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advance = useCallback(() => {
    if (!photosRef.current.length) return;
    const previousIds = new Set(frameRef.current?.layout.tiles.map((tile) => tile.photo.id) ?? []);
    const layout = createSmartMosaic(
      photosRef.current,
      viewportRef.current,
      historyRef.current,
      previousIds,
      slideNumberRef.current,
    );
    if (!layout) return;

    const nextSlideNumber = slideNumberRef.current + 1;
    layout.tiles.forEach(({ photo }) => {
      const usage = historyRef.current.get(photo.id) ?? { shown: 0, lastShown: Number.NEGATIVE_INFINITY };
      historyRef.current.set(photo.id, { shown: usage.shown + 1, lastShown: nextSlideNumber });
    });
    slideNumberRef.current = nextSlideNumber;
    const nextFrame = { layout, key: nextSlideNumber };
    frameRef.current = nextFrame;
    setFrame(nextFrame);
  }, []);

  const loadFiles = useCallback(async (files: File[]) => {
    const nextPhotos = await photosFromFiles(files);
    if (!nextPhotos.length) {
      setMessage("No supported images found. Try JPG, PNG, WebP, AVIF, or GIF files.");
      return;
    }
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
    photosRef.current = nextPhotos;
    historyRef.current = new Map();
    slideNumberRef.current = 0;
    frameRef.current = null;
    setPhotos(nextPhotos);
    const layout = createSmartMosaic(nextPhotos, viewportRef.current, historyRef.current, new Set(), 0);
    if (layout) {
      layout.tiles.forEach(({ photo }) => historyRef.current.set(photo.id, { shown: 1, lastShown: 1 }));
      slideNumberRef.current = 1;
      const firstFrame = { layout, key: 1 };
      frameRef.current = firstFrame;
      setFrame(firstFrame);
    }
    setPaused(false);
    setMessage("");
  }, []);

  const chooseFolder = useCallback(async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) { inputRef.current?.click(); return; }
    try {
      const handle = await picker();
      await loadFiles(await collectImages(handle));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("That folder couldn’t be opened. Please try again.");
    }
  }, [loadFiles]);

  const handleFallback = (event: ChangeEvent<HTMLInputElement>) => {
    void loadFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setMessage("Fullscreen isn’t available in this browser."); }
  };

  useEffect(() => {
    if (paused || photos.length === 0) return;
    const timer = window.setInterval(advance, intervalMs);
    return () => window.clearInterval(timer);
  }, [advance, intervalMs, paused, photos.length]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!photosRef.current.length && event.key.toLowerCase() !== "o") return;
      if (event.key === " " || event.key.toLowerCase() === "k") { event.preventDefault(); setPaused((value) => !value); }
      else if (event.key === "ArrowRight") advance();
      else if (event.key.toLowerCase() === "f") void toggleFullscreen();
      else if (event.key.toLowerCase() === "o") void chooseFolder();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [advance, chooseFolder]);

  useEffect(() => {
    let animationFrame = 0;
    const updateLayout = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const bounds = shellRef.current?.getBoundingClientRect();
        const viewport = {
          width: Math.max(1, bounds?.width ?? window.innerWidth),
          height: Math.max(1, bounds?.height ?? window.innerHeight),
        };
        const previous = viewportRef.current;
        if (Math.abs(previous.width - viewport.width) < 2 && Math.abs(previous.height - viewport.height) < 2) return;
        viewportRef.current = viewport;

        const currentFrame = frameRef.current;
        if (!currentFrame) return;
        const layout = arrangePhotos(currentFrame.layout.tiles.map((tile) => tile.photo), viewport);
        if (!layout) return;
        const reflowedFrame = { ...currentFrame, layout };
        frameRef.current = reflowedFrame;
        setFrame(reflowedFrame);
      });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateLayout);
    if (shellRef.current) observer?.observe(shellRef.current);
    window.addEventListener("resize", updateLayout);
    window.visualViewport?.addEventListener("resize", updateLayout);
    updateLayout();
    return () => {
      cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", updateLayout);
      window.visualViewport?.removeEventListener("resize", updateLayout);
    };
  }, []);

  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url)), []);

  const wakeChrome = () => {
    setShowChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (photos.length && !paused) hideTimer.current = setTimeout(() => setShowChrome(false), 2600);
  };

  return (
    <main ref={shellRef} className={`app-shell ${photos.length ? "is-playing" : ""}`} onPointerMove={wakeChrome}>
      <div className="ambient" aria-hidden="true" />
      {photos.length ? (
        <section className="mosaic" aria-label="Photo slideshow">
          {frame?.layout.tiles.map((tile) => (
            <figure
              className="tile"
              key={`${tile.photo.id}-${frame.key}`}
              style={{
                "--tile-x": `${tile.x * 100}%`,
                "--tile-y": `${tile.y * 100}%`,
                "--tile-width": `${tile.width * 100}%`,
                "--tile-height": `${tile.height * 100}%`,
              } as CSSProperties}
            >
              <img src={tile.photo.url} alt={tile.photo.name} draggable={false} />
              <figcaption>{tile.photo.name}</figcaption>
            </figure>
          ))}
        </section>
      ) : (
        <section className="welcome">
          <div className="eyebrow"><span /> LOCAL-ONLY SLIDESHOW</div>
          <h1>Every photo<br />gets its space.</h1>
          <p className="intro">Choose a folder. Zewasliga turns it into an ever-changing, edge-to-edge gallery—without uploading a single image.</p>
          <button className="primary-action" onClick={chooseFolder}><span>Choose image folder</span><span aria-hidden="true">↗</span></button>
          <p className="privacy-note"><span>●</span> Your images stay on this device</p>
          {message && <p className="error-message" role="alert">{message}</p>}
          <div className="demo-mosaic" aria-hidden="true">
            <div className="demo-tile demo-a"><span>01</span></div>
            <div className="demo-tile demo-b"><span>02</span></div>
            <div className="demo-tile demo-c"><span>03</span></div>
          </div>
        </section>
      )}

      <header className={`topbar ${showChrome || !photos.length ? "visible" : ""}`}>
        <a className="brand" href="/" aria-label="Zewasliga home"><span className="brand-mark"><i /><i /><i /></span><span>ZEWASLIGA</span></a>
        {photos.length ? <button className="quiet-button" onClick={chooseFolder}>Change folder</button> : <span className="top-note">ZERO WASTE · FULL FRAME</span>}
      </header>

      {photos.length > 0 && (
        <div className={`control-dock ${showChrome ? "visible" : ""}`}>
          <button className="icon-button" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Play slideshow" : "Pause slideshow"}><span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span></button>
          <button className="next-button" onClick={advance}>Next mix <span aria-hidden="true">→</span></button>
          <span className="divider" />
          <label className="speed-control"><span>PACE</span><select value={intervalMs} onChange={(event) => setIntervalMs(Number(event.target.value))}>{SPEEDS.map((speed) => <option key={speed} value={speed}>{speed / 1000}s</option>)}</select></label>
          <span className="counter"><b>{frame?.layout.tiles.length ?? 0}</b> / {photos.length}</span>
          <button className="fullscreen-button" onClick={toggleFullscreen} aria-label="Toggle fullscreen"><span aria-hidden="true">⌗</span></button>
        </div>
      )}
      {message && photos.length > 0 && <div className="toast" role="alert">{message}</div>}
      <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple onChange={handleFallback} {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} />
    </main>
  );
}
