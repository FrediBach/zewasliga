import { useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { GalleryMedia } from "./gallery-media";

type GalleryVideoProps = {
  media: GalleryMedia;
  paused: boolean;
  muted: boolean;
  onElement: (id: string, element: HTMLVideoElement | null) => void;
  onReady: (id: string, ready: boolean) => void;
  onError: (message: string) => void;
  onBlocked: () => void;
};

type VideoSession = {
  element: HTMLVideoElement;
  id: string;
  active: boolean;
  ready: boolean;
  failed: boolean;
  playAttempt: number;
  playPending: boolean;
  play: () => void;
};

export function GalleryVideo({ media, paused, muted, onElement, onReady, onError, onBlocked }: GalleryVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<VideoSession | null>(null);
  const callbacksRef = useRef({ paused, muted, onElement, onReady, onError, onBlocked });
  callbacksRef.current = { paused, muted, onElement, onReady, onError, onBlocked };

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const session: VideoSession = {
      element: video, id: media.id, active: true, ready: false, failed: false,
      playAttempt: 0, playPending: false, play: () => {},
    };
    sessionRef.current = session;
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null;
    const clearLoadingTimeout = () => {
      if (loadingTimeout !== null) clearTimeout(loadingTimeout);
      loadingTimeout = null;
    };
    const watchForReady = () => {
      // Repeated waiting/stalled events must not extend the same loading deadline.
      if (loadingTimeout === null) loadingTimeout = setTimeout(fail, 15_000);
    };

    const reportReady = (ready: boolean) => {
      if (!session.active) return;
      if (ready) clearLoadingTimeout();
      else watchForReady();
      if (session.ready === ready) return;
      session.ready = ready;
      callbacksRef.current.onReady(media.id, ready);
    };
    const fail = () => {
      if (!session.active || session.failed) return;
      session.failed = true;
      session.playAttempt += 1;
      session.playPending = false;
      video.pause();
      video.muted = true;
      // Global gesture handlers must not try to resume this failed source.
      callbacksRef.current.onElement(media.id, null);
      // A failed tile must not keep every other video and the slideshow waiting.
      reportReady(true);
      callbacksRef.current.onError(`Could not play ${media.name}. This browser may not support its video format.`);
    };
    const rejectPlay = (error: unknown, attempt: number) => {
      if (!session.active || attempt !== session.playAttempt) return;
      session.playPending = false;
      if (callbacksRef.current.paused) return;
      const name = error instanceof DOMException || error instanceof Error ? error.name : "";
      // pause(), a new source, and Strict Mode cleanup can abort a pending play().
      if (name === "AbortError") return;
      if (name === "NotAllowedError") {
        callbacksRef.current.onError(`Playback of ${media.name} was blocked. Press play to continue.`);
        callbacksRef.current.onBlocked();
      } else {
        fail();
      }
    };
    session.play = () => {
      if (!session.active || session.failed || session.playPending || !video.paused) return;
      const attempt = ++session.playAttempt;
      session.playPending = true;
      try {
        void video.play().then(() => {
          if (session.active && attempt === session.playAttempt) session.playPending = false;
        }, error => rejectPlay(error, attempt));
      } catch (error) {
        rejectPlay(error, attempt);
      }
    };
    const ready = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) reportReady(true);
    };
    const waiting = () => {
      if (!session.failed) reportReady(false);
    };
    const stalled = () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) waiting();
    };

    video.addEventListener("loadeddata", ready);
    video.addEventListener("canplay", ready);
    video.addEventListener("playing", ready);
    video.addEventListener("waiting", waiting);
    video.addEventListener("stalled", stalled);
    video.addEventListener("error", fail);
    video.muted = callbacksRef.current.muted;
    video.defaultMuted = callbacksRef.current.muted;
    // Own the source in this effect so Strict Mode's second setup restores it
    // after cleanup; an unchanged JSX src would not necessarily be reassigned.
    watchForReady();
    video.src = media.url;
    video.load();
    ready();

    return () => {
      session.active = false;
      session.playAttempt += 1;
      clearLoadingTimeout();
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("canplay", ready);
      video.removeEventListener("playing", ready);
      video.removeEventListener("waiting", waiting);
      video.removeEventListener("stalled", stalled);
      video.removeEventListener("error", fail);
      video.pause();
      video.muted = true;
      video.removeAttribute("src");
      video.load();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [media.id, media.name, media.url]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    onElement(media.id, sessionRef.current?.failed ? null : video);
    return () => onElement(media.id, null);
  }, [media.id, onElement]);

  useLayoutEffect(() => {
    const session = sessionRef.current;
    // Frame changes can replace the readiness callback while React retains the
    // same video element; report its state without restarting playback.
    onReady(media.id, Boolean(session?.ready || session?.failed));
  }, [media.id, media.url, onReady]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted || Boolean(sessionRef.current?.failed);
    video.defaultMuted = muted;
  }, [media.id, media.url, muted]);

  useLayoutEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (paused) {
      session.playAttempt += 1;
      session.playPending = false;
      session.element.pause();
    } else {
      session.play();
    }
  }, [media.id, media.url, paused]);

  return <video ref={videoRef} muted={muted} loop playsInline preload="auto" draggable={false} aria-hidden="true" />;
}

/** A still of the actual tile's current frame: never a second playing video. */
export function VideoDetailFrame({ video, style }: { video: HTMLVideoElement | null; style: CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const draw = () => {
      if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch {
        // The parent may have changed folders or released this source meanwhile.
      }
    };
    draw();
    const frame = requestAnimationFrame(draw);
    video.addEventListener("loadeddata", draw);
    video.addEventListener("seeked", draw);
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("loadeddata", draw);
      video.removeEventListener("seeked", draw);
    };
  }, [video]);

  return <canvas ref={canvasRef} style={{ position: "absolute", maxWidth: "none", objectFit: "cover", ...style }} aria-hidden="true" />;
}
