import { isImageFile, isVideoFile, mediaPath } from "./media.ts";

export type GalleryMedia = {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  lastModified: number;
  kind: "image" | "video";
  durationMs: number;
};

type MediaMetadata = Pick<GalleryMedia, "width" | "height" | "durationMs">;

const METADATA_CONCURRENCY = 4;
const METADATA_TIMEOUT_MS = 15000;

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function readMetadata(url: string, kind: GalleryMedia["kind"]): Promise<MediaMetadata | null> {
  return new Promise((resolve) => {
    let settled = false;
    let cleanup = () => {};
    const finish = (metadata: MediaMetadata | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { cleanup(); } catch { /* Detached media may already have been released. */ }
      resolve(metadata);
    };
    const timeout = setTimeout(() => finish(null), METADATA_TIMEOUT_MS);

    try {
      if (kind === "video") {
        const video = document.createElement("video");
        cleanup = () => {
          video.onloadedmetadata = null;
          video.onerror = null;
          video.removeAttribute("src");
          video.load();
        };
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.onloadedmetadata = () => {
          const metadata = { width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000 };
          finish(Object.values(metadata).every(positiveFinite) ? metadata : null);
        };
        video.onerror = () => finish(null);
        video.src = url;
        video.load();
      } else {
        const image = new Image();
        cleanup = () => {
          image.onload = null;
          image.onerror = null;
          image.removeAttribute("src");
        };
        image.onload = () => {
          const width = image.naturalWidth;
          const height = image.naturalHeight;
          finish(positiveFinite(width) && positiveFinite(height) ? { width, height, durationMs: 0 } : null);
        };
        image.onerror = () => finish(null);
        image.src = url;
      }
    } catch {
      finish(null);
    }
  });
}

/** The caller owns successful object URLs; failed media never retain a URL or decoder. */
export async function galleryMediaFromFiles(files: File[]): Promise<{ items: GalleryMedia[]; skipped: string[] }> {
  const supported = files.filter((file) => isImageFile(file) || isVideoFile(file));
  const results: Array<GalleryMedia | null> = new Array(supported.length);
  let cursor = 0;

  async function worker() {
    while (cursor < supported.length) {
      const index = cursor++;
      const file = supported[index];
      const kind = isVideoFile(file) ? "video" : "image";
      let url: string | null = null;
      try {
        url = URL.createObjectURL(file);
        const metadata = await readMetadata(url, kind);
        if (!metadata) throw new Error("Media metadata unavailable");
        results[index] = {
          id: `${mediaPath(file)}-${file.lastModified}-${index}`,
          name: file.name.replace(/\.[^.]+$/, ""),
          url,
          lastModified: file.lastModified,
          kind,
          ...metadata,
        };
      } catch {
        if (url) URL.revokeObjectURL(url);
        results[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(METADATA_CONCURRENCY, supported.length) }, worker));
  return {
    items: results.filter((item): item is GalleryMedia => item !== null),
    skipped: supported.filter((_, index) => results[index] === null).map(mediaPath),
  };
}

export function getSlideDurationMs(items: Array<Pick<GalleryMedia, "kind" | "durationMs">>, fallbackMs: number): number {
  let longest = 0;
  for (const item of items) {
    if (item.kind === "video" && positiveFinite(item.durationMs)) longest = Math.max(longest, item.durationMs);
  }
  return longest || fallbackMs;
}
