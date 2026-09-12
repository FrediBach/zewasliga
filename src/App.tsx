import { ChangeEvent, CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { arrangePhotos, createSmartMosaic, MosaicLayout, PhotoUsage, smallTilePriorities, Viewport } from "./layout";
import { collectMediaFiles, DirectoryPickerWindow, isImageFile, isAudioFile } from "./media";
import { MusicControls, useAudioPlayer } from "./MusicControls";

type Photo = { id: string; name: string; url: string; width: number; height: number; lastModified: number };
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
  const supported = files.filter(isImageFile);
  return Promise.all(supported.map(async (file, index) => {
    const url = URL.createObjectURL(file);
    const dimensions = await getDimensions(url);
    return { id: `${file.name}-${file.lastModified}-${index}`, name: file.name.replace(/\.[^.]+$/, ""), url, lastModified: file.lastModified, ...dimensions };
  }));
}

type GalleryFrame = { layout: MosaicLayout<Photo>; key: number; prioritizedIds: Set<string> };
type DetailLens = { photo: Photo; pointerX: number; pointerY: number; tile: DOMRect };

const DETAIL_LENS_SIZE = 210;
const DETAIL_LENS_ZOOM = 2.25;
const DETAIL_LENS_ZOOM_STEP = 0.75;
const DETAIL_LENS_MAX_ZOOM = 5.25;

function currentViewport(): Viewport {
  if (typeof window === "undefined") return { width: 1280, height: 720 };
  return { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) };
}

function imageMotion(photoId: string, frameKey: number, area: number, durationMs: number) {
  let hash = 2166136261;
  for (const character of `${photoId}-${frameKey}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const scale = 1 + Math.min(0.055, 0.01 + Math.sqrt(Math.max(0, area)) * 0.045);
  const zoomsIn = (hash >>> 0) % 2 === 0;
  return {
    "--zoom-from": zoomsIn ? "1" : String(scale),
    "--zoom-to": zoomsIn ? String(scale) : "1",
    "--zoom-duration": `${durationMs}ms`,
  };
}

function KeyboardShortcuts() {
  return (
    <dl>
      <div><dt><kbd>Space</kbd> / <kbd>K</kbd></dt><dd>Pause / play slideshow</dd></div>
      <div><dt><kbd>A</kbd></dt><dd>Pause / play music</dd></div>
      <div><dt><kbd>M</kbd></dt><dd>Mute / unmute music</dd></div>
      <div><dt><kbd>−</kbd> / <kbd>=</kbd></dt><dd>Music volume</dd></div>
      <div><dt><kbd>[</kbd> / <kbd>]</kbd></dt><dd>Previous / next track</dd></div>
      <div><dt><kbd>←</kbd></dt><dd>Previous mix</dd></div>
      <div><dt><kbd>→</kbd> / <kbd>↓</kbd></dt><dd>Next mix</dd></div>
      <div><dt><kbd>↑</kbd></dt><dd>Hold this mix longer</dd></div>
      <div><dt><kbd>Enter</kbd></dt><dd>Love / unlove hovered photo</dd></div>
      <div><dt><kbd>Shift</kbd></dt><dd>Inspect hovered photo</dd></div>
      <div><dt><kbd>Shift</kbd> + <kbd>+</kbd></dt><dd>Zoom in further</dd></div>
      <div><dt><kbd>F</kbd></dt><dd>Toggle fullscreen</dd></div>
      <div><dt><kbd>O</kbd></dt><dd>Choose another folder</dd></div>
    </dl>
  );
}

export default function Home() {
  const { audio, player } = useAudioPlayer();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [frame, setFrame] = useState<GalleryFrame | null>(null);
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5000);
  const [showChrome, setShowChrome] = useState(true);
  const [message, setMessage] = useState("");
  const [shiftHeld, setShiftHeld] = useState(false);
  const [detailLens, setDetailLens] = useState<DetailLens | null>(null);
  const [detailLensZoom, setDetailLensZoom] = useState(DETAIL_LENS_ZOOM);
  const [lovedIds, setLovedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const loadRequestRef = useRef(0);
  const shellRef = useRef<HTMLElement>(null);
  const durationPieRef = useRef<HTMLSpanElement>(null);
  const photosRef = useRef<Photo[]>([]);
  const frameRef = useRef<GalleryFrame | null>(null);
  const viewportRef = useRef<Viewport>(currentViewport());
  const historyRef = useRef<Map<string, PhotoUsage>>(new Map());
  const lovedIdsRef = useRef<Set<string>>(new Set());
  const slideNumberRef = useRef(0);
  const frameHistoryRef = useRef<GalleryFrame[]>([]);
  const frameIndexRef = useRef(-1);
  const requestedPriorityRef = useRef<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const advanceDeadlineRef = useRef(0);
  const advanceRemainingRef = useRef(intervalMs);
  const countdownDurationRef = useRef(intervalMs);
  const timerContextRef = useRef<{ frameKey: number | null; intervalMs: number; photos: Photo[] } | null>(null);
  const timerWasPausedRef = useRef(false);
  const detailLensActiveRef = useRef(false);
  const hoveredTileRef = useRef<{ element: HTMLElement; photo: Photo } | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const nameOrderedPhotos = useMemo(() => [...photos].sort((left, right) => (
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  )), [photos]);
  const viewedCount = photos.reduce((count, photo) => count + Number((historyRef.current.get(photo.id)?.shown ?? 0) > 0), 0);
  const timerPaused = paused || detailLens !== null;
  const hasMedia = photos.length > 0 || audio.tracks.length > 0;
  const wakeChrome = useCallback(() => {
    setShowChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (hasMedia && !paused) hideTimer.current = setTimeout(() => setShowChrome(false), 2600);
  }, [hasMedia, paused]);

  const advance = useCallback(() => {
    if (!photosRef.current.length) return;

    const requestedPriorityId = requestedPriorityRef.current;
    const nextHistoryIndex = frameIndexRef.current + 1;
    const savedFrame = frameHistoryRef.current[nextHistoryIndex];
    if (savedFrame && !requestedPriorityId) {
      frameIndexRef.current = nextHistoryIndex;
      frameRef.current = savedFrame;
      setFrame(savedFrame);
      return;
    }

    const previousIds = new Set(frameRef.current?.layout.tiles.map((tile) => tile.photo.id) ?? []);
    const prioritizedIds = requestedPriorityId
      ? new Set([requestedPriorityId])
      : frameRef.current ? smallTilePriorities(frameRef.current.layout) : new Set<string>();
    const layout = createSmartMosaic(
      photosRef.current,
      viewportRef.current,
      historyRef.current,
      previousIds,
      prioritizedIds,
      slideNumberRef.current,
      lovedIdsRef.current,
    );
    if (!layout) return;

    const nextSlideNumber = slideNumberRef.current + 1;
    layout.tiles.forEach(({ photo }) => {
      const usage = historyRef.current.get(photo.id) ?? { shown: 0, lastShown: Number.NEGATIVE_INFINITY };
      historyRef.current.set(photo.id, { shown: usage.shown + 1, lastShown: nextSlideNumber });
    });
    slideNumberRef.current = nextSlideNumber;
    const nextFrame = { layout, key: nextSlideNumber, prioritizedIds };
    frameHistoryRef.current = frameHistoryRef.current.slice(0, frameIndexRef.current + 1);
    frameHistoryRef.current.push(nextFrame);
    frameIndexRef.current = frameHistoryRef.current.length - 1;
    requestedPriorityRef.current = null;
    frameRef.current = nextFrame;
    setFrame(nextFrame);
  }, []);

  const promoteOnNextSlide = useCallback((photoId: string) => {
    requestedPriorityRef.current = photoId;
    advance();
  }, [advance]);

  const goBack = useCallback(() => {
    const previousIndex = frameIndexRef.current - 1;
    if (previousIndex < 0) return;
    const previousFrame = frameHistoryRef.current[previousIndex];
    frameIndexRef.current = previousIndex;
    frameRef.current = previousFrame;
    setFrame(previousFrame);
  }, []);

  const loadFiles = useCallback(async (files: File[], request = ++loadRequestRef.current) => {
    const nextPhotos = await photosFromFiles(files);
    if (request !== loadRequestRef.current) {
      nextPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
      return;
    }
    if (!nextPhotos.length && !files.some(isAudioFile)) {
      setMessage("No supported images or music found. Try JPG, PNG, WebP, AVIF, GIF, MP3, or WAV files.");
      return;
    }
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
    photosRef.current = nextPhotos;
    historyRef.current = new Map();
    lovedIdsRef.current = new Set();
    slideNumberRef.current = 0;
    frameHistoryRef.current = [];
    frameIndexRef.current = -1;
    requestedPriorityRef.current = null;
    frameRef.current = null;
    setFrame(null);
    setPhotos(nextPhotos);
    player.setFiles(files);
    setLovedIds(new Set());
    const layout = createSmartMosaic(nextPhotos, viewportRef.current, historyRef.current, new Set(), new Set(), 0);
    if (layout) {
      layout.tiles.forEach(({ photo }) => historyRef.current.set(photo.id, { shown: 1, lastShown: 1 }));
      slideNumberRef.current = 1;
      const firstFrame = { layout, key: 1, prioritizedIds: new Set<string>() };
      frameHistoryRef.current = [firstFrame];
      frameIndexRef.current = 0;
      frameRef.current = firstFrame;
      setFrame(firstFrame);
    }
    setPaused(false);
    setMessage("");
  }, [player]);

  const chooseFolder = useCallback(async () => {
    void player.unlock()?.catch(() => {});
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) { inputRef.current?.click(); return; }
    const request = ++loadRequestRef.current;
    try {
      const handle = await picker();
      await loadFiles(await collectMediaFiles(handle), request);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (request === loadRequestRef.current) setMessage("That folder couldn’t be opened. Please try again.");
    }
  }, [loadFiles, player]);

  const handleFallback = (event: ChangeEvent<HTMLInputElement>) => {
    void player.unlock()?.catch(() => {});
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
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;

    const now = Date.now();
    const previousContext = timerContextRef.current;
    const contextChanged = previousContext?.frameKey !== (frame?.key ?? null)
      || previousContext?.intervalMs !== intervalMs
      || previousContext?.photos !== photos;

    if (contextChanged) {
      advanceRemainingRef.current = intervalMs;
      countdownDurationRef.current = intervalMs;
    } else if (timerPaused && !timerWasPausedRef.current) {
      advanceRemainingRef.current = Math.max(0, advanceDeadlineRef.current - now);
    }

    timerContextRef.current = { frameKey: frame?.key ?? null, intervalMs, photos };
    timerWasPausedRef.current = timerPaused;
    if (timerPaused || photos.length === 0) return;

    const delay = advanceRemainingRef.current;
    advanceDeadlineRef.current = now + delay;
    advanceTimerRef.current = window.setTimeout(advance, delay);
    return () => {
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    };
  }, [advance, frame?.key, intervalMs, photos, timerPaused]);

  const holdCurrentSlide = useCallback(() => {
    if (timerPaused || !photosRef.current.length) return;
    const remainingMs = Math.max(0, advanceDeadlineRef.current - Date.now());
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    const extendedDelay = remainingMs + intervalMs;
    countdownDurationRef.current = extendedDelay;
    advanceDeadlineRef.current = Date.now() + extendedDelay;
    advanceTimerRef.current = window.setTimeout(advance, extendedDelay);
  }, [advance, intervalMs, timerPaused]);

  const showDetailLens = useCallback((element: HTMLElement, photo: Photo, pointerX: number, pointerY: number) => {
    detailLensActiveRef.current = true;
    setDetailLens({ photo, pointerX, pointerY, tile: element.getBoundingClientRect() });
  }, []);

  const toggleLoved = useCallback((photoId: string) => {
    setLovedIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      lovedIdsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const handleShiftDown = (event: KeyboardEvent) => {
      if ((event.key === "+" || event.code === "NumpadAdd") && detailLensActiveRef.current) {
        event.preventDefault();
        if (!event.repeat) setDetailLensZoom((zoom) => Math.min(DETAIL_LENS_MAX_ZOOM, zoom + DETAIL_LENS_ZOOM_STEP));
        return;
      }
      if (event.key !== "Shift" || event.repeat) return;
      setShiftHeld(true);
      const hovered = hoveredTileRef.current;
      if (hovered) showDetailLens(hovered.element, hovered.photo, pointerRef.current.x, pointerRef.current.y);
    };
    const hideDetailLens = () => {
      setShiftHeld(false);
      detailLensActiveRef.current = false;
      setDetailLens(null);
      setDetailLensZoom(DETAIL_LENS_ZOOM);
    };
    const handleShiftUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") hideDetailLens();
    };
    window.addEventListener("keydown", handleShiftDown);
    window.addEventListener("keyup", handleShiftUp);
    window.addEventListener("blur", hideDetailLens);
    return () => {
      window.removeEventListener("keydown", handleShiftDown);
      window.removeEventListener("keyup", handleShiftUp);
      window.removeEventListener("blur", hideDetailLens);
    };
  }, [showDetailLens]);

  useEffect(() => {
    hoveredTileRef.current = null;
    detailLensActiveRef.current = false;
    setDetailLens(null);
    setDetailLensZoom(DETAIL_LENS_ZOOM);
  }, [frame?.key]);

  useEffect(() => {
    if (timerPaused || photos.length === 0) return;
    let animationFrame = 0;

    const updatePie = () => {
      const remainingMs = Math.max(0, advanceDeadlineRef.current - Date.now());
      const remaining = Math.min(1, remainingMs / Math.max(1, countdownDurationRef.current));
      durationPieRef.current?.style.setProperty("--remaining", `${remaining * 100}%`);
      durationPieRef.current?.setAttribute("aria-valuenow", String(Math.ceil(remaining * 100)));
      animationFrame = requestAnimationFrame(updatePie);
    };

    updatePie();
    return () => cancelAnimationFrame(animationFrame);
  }, [frame?.key, intervalMs, photos, timerPaused]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const onVolume = target instanceof HTMLInputElement && target.type === "range" && target.closest(".volume-control");
      if (!onVolume && target instanceof HTMLElement && target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if ((event.key === " " || event.key === "Enter") && target instanceof HTMLElement && target.closest("button:not(.tile), a")) return;
      const key = event.key.toLowerCase();
      if (audio.tracks.length && ["a", "m", "-", "=", "[", "]"].includes(key)) {
        event.preventDefault();
        if (key === "-" || key === "=") player.changeVolume(key === "-" ? -0.05 : 0.05);
        else if (!event.repeat) {
          if (key === "a") player.toggle();
          else if (key === "m") player.toggleMute();
          else if (key === "[") player.previous();
          else player.next();
        }
        wakeChrome();
        return;
      }
      if (onVolume) return;
      if (key === "f" && hasMedia) { event.preventDefault(); if (!event.repeat) void toggleFullscreen(); return; }
      if (key === "o") { event.preventDefault(); if (!event.repeat) void chooseFolder(); return; }
      if (!photosRef.current.length && event.key.toLowerCase() !== "o") return;
      if (event.key === "Enter" && hoveredTileRef.current) {
        event.preventDefault();
        if (!event.repeat) toggleLoved(hoveredTileRef.current.photo.id);
      }
      else if (event.key === " " || event.key.toLowerCase() === "k") { event.preventDefault(); if (!event.repeat) setPaused((value) => !value); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); goBack(); }
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); advance(); }
      else if (event.key === "ArrowUp") { event.preventDefault(); if (!event.repeat) holdCurrentSlide(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [advance, audio.tracks.length, chooseFolder, goBack, hasMedia, holdCurrentSlide, player, toggleLoved, wakeChrome]);

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
        const layout = arrangePhotos(
          currentFrame.layout.tiles.map((tile) => tile.photo),
          viewport,
          currentFrame.prioritizedIds,
        );
        if (!layout) return;
        const reflowedFrame = { ...currentFrame, layout };
        if (frameIndexRef.current >= 0) frameHistoryRef.current[frameIndexRef.current] = reflowedFrame;
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

  useEffect(() => () => {
    loadRequestRef.current += 1;
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  return (
    <main ref={shellRef} className={`app-shell ${hasMedia ? "is-playing" : ""} ${paused ? "is-paused" : ""}`} onPointerMove={wakeChrome}>
      {photos.length ? (
        <section className="mosaic" aria-label="Photo slideshow">
          {frame?.layout.tiles.map((tile) => (
            <button
              type="button"
              className="tile"
              key={`${tile.photo.id}-${frame.key}`}
              onClick={() => promoteOnNextSlide(tile.photo.id)}
              onPointerEnter={(event) => {
                hoveredTileRef.current = { element: event.currentTarget, photo: tile.photo };
                pointerRef.current = { x: event.clientX, y: event.clientY };
                if (shiftHeld) showDetailLens(event.currentTarget, tile.photo, event.clientX, event.clientY);
              }}
              onPointerMove={(event) => {
                pointerRef.current = { x: event.clientX, y: event.clientY };
                if (shiftHeld) showDetailLens(event.currentTarget, tile.photo, event.clientX, event.clientY);
              }}
              onPointerLeave={() => {
                hoveredTileRef.current = null;
                detailLensActiveRef.current = false;
                setDetailLens(null);
                setDetailLensZoom(DETAIL_LENS_ZOOM);
              }}
              aria-label={`Show ${tile.photo.name} large on the next slide. ${lovedIds.has(tile.photo.id) ? "Loved; press Enter to unlove" : "Press Enter to love"}`}
              style={{
                "--tile-x": `${tile.x * 100}%`,
                "--tile-y": `${tile.y * 100}%`,
                "--tile-width": `${tile.width * 100}%`,
                "--tile-height": `${tile.height * 100}%`,
                ...imageMotion(tile.photo.id, frame.key, tile.width * tile.height, intervalMs),
              } as CSSProperties}
            >
              <img src={tile.photo.url} alt="" draggable={false} />
              {lovedIds.has(tile.photo.id) && <span className="tile-love" aria-hidden="true">♥</span>}
              <span className="tile-caption" aria-hidden="true">{tile.photo.name}</span>
            </button>
          ))}
        </section>
      ) : audio.tracks.length ? (
        <section className="music-canvas" aria-label="Music playback">
          <span className="eyebrow">ON YOUR DEVICE</span>
          <p>{audio.tracks[audio.trackIndex]?.name ?? "Your soundtrack"}</p>
        </section>
      ) : (
        <section className="welcome">
          <div className="welcome-intro">
            <div className="welcome-copy">
              <div className="eyebrow">A LOCAL IMAGE SLIDESHOW</div>
              <h1>Every photo.<br />Room to be seen<span className="accent">.</span></h1>
              <p className="intro">Choose a folder. Your images find their place in an ever-changing, full-screen mosaic. Add MP3 or WAV files for a soundtrack.</p>
              <div className="start-row">
                <button className="primary-action" onClick={chooseFolder}><span>Choose image folder</span><span aria-hidden="true">↗</span></button>
                <p className="privacy-note">On your device. No uploads.</p>
              </div>
              {message && <p className="error-message" role="alert">{message}</p>}
            </div>

            <aside className="welcome-shortcuts" aria-labelledby="welcome-shortcuts-title">
              <h2 id="welcome-shortcuts-title">Keyboard shortcuts</h2>
              <KeyboardShortcuts />
            </aside>
          </div>

          <div className="features-heading"><span>THOUGHTFULLY ARRANGED</span><span>01 — 04</span></div>

          <div className="feature-strip" aria-label="Gallery features">
            <div className="feature"><span className="feature-number">01</span><div><b>Fits the frame</b><small>Smart layouts minimize cropping.</small></div></div>
            <div className="feature"><span className="feature-number">02</span><div><b>Fair rotation</b><small>Tracks views so no photo is forgotten.</small></div></div>
            <div className="feature"><span className="feature-number">03</span><div><b>Direct the mix</b><small>Click a photo to feature it next.</small></div></div>
            <div className="feature"><span className="feature-number">04</span><div><b>Inspect details</b><small>Hold Shift for a close-up lens.</small></div></div>
          </div>
        </section>
      )}

      <header className={`topbar ${showChrome || paused || !hasMedia ? "visible" : ""}`}>
        <a className="brand" href="/" aria-label="Zewasliga home"><span>Zewasliga<span className="accent">.</span></span></a>
        {hasMedia ? <button className="quiet-button" onClick={chooseFolder}>Change folder</button> : <span className="top-note">ZERO WASTE / FULL FRAME</span>}
      </header>

      {photos.length > 0 && (
        <div
          className="view-progress"
          role="progressbar"
          aria-label={`${viewedCount} of ${photos.length} images viewed`}
          aria-valuemin={0}
          aria-valuemax={photos.length}
          aria-valuenow={viewedCount}
          style={{ "--photo-count": nameOrderedPhotos.length } as CSSProperties}
        >
          {nameOrderedPhotos.map((photo) => (
            <span
              key={photo.id}
              className={`view-progress-dot ${(historyRef.current.get(photo.id)?.shown ?? 0) > 0 ? "viewed" : ""}`}
              aria-hidden="true"
            />
          ))}
        </div>
      )}

      {hasMedia && (
        <div className={`control-dock ${showChrome || paused ? "visible" : ""}`}>
          {photos.length > 0 && <>
            <button className="icon-button" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Play slideshow" : "Pause slideshow"} aria-keyshortcuts="Space K"><span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span></button>
            <button className="next-button" onClick={advance}>Next mix <span aria-hidden="true">→</span></button>
            <span className="divider" />
            <label className="speed-control"><span>PACE</span><select value={intervalMs} onChange={(event) => setIntervalMs(Number(event.target.value))}>{SPEEDS.map((speed) => <option key={speed} value={speed}>{speed / 1000}s</option>)}</select></label>
            <span className="counter"><b>{frame?.layout.tiles.length ?? 0}</b> / {photos.length}</span>
          </>}
          {audio.tracks.length > 0 && <>
            {photos.length > 0 && <span className="divider" />}
            <MusicControls audio={audio} player={player} visible={showChrome || paused} />
          </>}
          <button className="fullscreen-button" onClick={toggleFullscreen} aria-label="Toggle fullscreen"><span aria-hidden="true">⌗</span></button>
        </div>
      )}
      {photos.length > 0 && (
        <span
          ref={durationPieRef}
          className={`duration-pie ${timerPaused ? "paused" : ""}`}
          role="progressbar"
          aria-label={timerPaused ? "Slide timer paused" : "Slide time remaining"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={timerPaused ? undefined : 100}
          title={timerPaused ? "Slide timer paused" : "Slide time remaining"}
        />
      )}
      {hasMedia && <div className="shortcut-help">
        <button type="button" className="shortcut-help-button" aria-label="Show keyboard shortcuts" aria-describedby="keyboard-shortcuts">?</button>
        <div id="keyboard-shortcuts" className="shortcut-help-panel" role="tooltip">
          <strong>Keyboard shortcuts</strong>
          <KeyboardShortcuts />
        </div>
      </div>}
      {shiftHeld && detailLens && (
        <div
          className="detail-lens"
          aria-hidden="true"
          style={{ left: detailLens.pointerX, top: detailLens.pointerY }}
        >
          <img
            src={detailLens.photo.url}
            alt=""
            style={{
              left: detailLens.tile.left - detailLens.pointerX + DETAIL_LENS_SIZE / 2,
              top: detailLens.tile.top - detailLens.pointerY + DETAIL_LENS_SIZE / 2,
              width: detailLens.tile.width,
              height: detailLens.tile.height,
              transform: `scale(${detailLensZoom})`,
              transformOrigin: `${detailLens.pointerX - detailLens.tile.left}px ${detailLens.pointerY - detailLens.tile.top}px`,
            }}
          />
        </div>
      )}
      {(message || audio.error) && hasMedia && <div className="toast" role="alert">{message || audio.error}</div>}
      <input ref={inputRef} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/vnd.wave,.mp3,.wav" multiple onChange={handleFallback} {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} />
    </main>
  );
}
