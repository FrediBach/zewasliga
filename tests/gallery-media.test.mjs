import assert from "node:assert/strict";
import test from "node:test";
import { galleryMediaFromFiles, getSlideDurationMs } from "../src/gallery-media.ts";

function setupMedia(t, scenarios = {}, autoComplete = true) {
  const elements = [];
  const filesByUrl = new Map();
  const revoked = [];
  const active = new Set();
  let maximumActive = 0;
  let nextUrl = 0;

  function complete(element) {
    const scenario = scenarios[element.file.name] ?? {};
    if (scenario.error) { element.onerror?.(); return; }
    if (element.kind === "video") {
      element.videoWidth = scenario.width ?? 1920;
      element.videoHeight = scenario.height ?? 1080;
      element.duration = scenario.duration ?? 3.25;
      element.onloadedmetadata?.();
    } else {
      element.naturalWidth = scenario.width ?? 1200;
      element.naturalHeight = scenario.height ?? 800;
      element.onload?.();
    }
  }

  function begin(element) {
    element.file = filesByUrl.get(element.src);
    active.add(element);
    maximumActive = Math.max(maximumActive, active.size);
    if (autoComplete && !scenarios[element.file.name]?.timeout) queueMicrotask(() => complete(element));
  }

  class FakeImage {
    kind = "image";
    _src = "";
    constructor() { elements.push(this); }
    set src(value) { this._src = value; begin(this); }
    get src() { return this._src; }
    removeAttribute(name) {
      assert.equal(name, "src");
      this._src = "";
      active.delete(this);
    }
  }

  class FakeVideo extends FakeImage {
    kind = "video";
    loadCalls = 0;
    set src(value) { this._src = value; }
    get src() { return this._src; }
    load() {
      this.loadCalls += 1;
      if (this.src && !active.has(this)) begin(this);
    }
  }

  for (const [key, value] of Object.entries({ Image: FakeImage, document: { createElement: (name) => {
    assert.equal(name, "video");
    return new FakeVideo();
  } } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  t.mock.method(URL, "createObjectURL", (file) => {
    const url = `blob:test-${++nextUrl}`;
    filesByUrl.set(url, file);
    return url;
  });
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));

  return { elements, filesByUrl, revoked, active, complete, get maximumActive() { return maximumActive; } };
}

function file(name, path = "") {
  const result = new File(["media"], name, { lastModified: 42 });
  if (path) Object.defineProperty(result, "webkitRelativePath", { value: path });
  return result;
}

function assertReleased(element) {
  assert.equal(element.src, "");
  assert.equal(element.onerror, null);
  if (element.kind === "video") {
    assert.equal(element.onloadedmetadata, null);
    assert.equal(element.loadCalls, 2, "clearing the video source should reset its resource selection");
  } else assert.equal(element.onload, null);
}

test("mixed gallery intake reads native dimensions and video duration, retaining successful URLs", async (t) => {
  const media = setupMedia(t, { "clip.MOV": { width: 720, height: 1280, duration: 2.25 } });
  const result = await galleryMediaFromFiles([
    file("photo.jpg", "album/photos/photo.jpg"), file("music.mp3"), file("clip.MOV", "album/videos/clip.MOV"), file("notes.txt"),
  ]);
  assert.deepEqual(result.items.map(({ id, name, kind, width, height, durationMs, lastModified }) => (
    { id, name, kind, width, height, durationMs, lastModified }
  )), [
    { id: "album/photos/photo.jpg-42-0", name: "photo", kind: "image", width: 1200, height: 800, durationMs: 0, lastModified: 42 },
    { id: "album/videos/clip.MOV-42-1", name: "clip", kind: "video", width: 720, height: 1280, durationMs: 2250, lastModified: 42 },
  ]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(media.revoked, []);
  assert.equal(media.filesByUrl.size, 2, "audio and unrelated files do not allocate gallery URLs");
  assert.equal(media.elements[1].muted, true);
  assert.equal(media.elements[1].playsInline, true);
  assert.equal(media.elements[1].preload, "metadata");
  media.elements.forEach(assertReleased);
});

test("invalid video durations, missing dimensions, and decode errors are skipped and released", async (t) => {
  const media = setupMedia(t, {
    "infinite.mp4": { duration: Infinity },
    "unknown.mov": { duration: NaN },
    "empty.mp4": { duration: 0 },
    "no-picture.mp4": { width: 0 },
    "unsupported.mov": { error: true },
    "broken.jpg": { error: true },
  });
  const names = ["infinite.mp4", "unknown.mov", "empty.mp4", "no-picture.mp4", "unsupported.mov", "broken.jpg"];
  const result = await galleryMediaFromFiles([...names.map((name) => file(name)), file("valid.mp4")]);
  assert.deepEqual(result.items.map((item) => item.name), ["valid"]);
  assert.deepEqual(result.skipped, names);
  assert.deepEqual(media.revoked.map((url) => media.filesByUrl.get(url).name).sort(), [...names].sort());
  assert.equal(media.active.size, 0);
  media.elements.forEach(assertReleased);
});

test("metadata timeouts release stalled videos without delaying completed items indefinitely", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const media = setupMedia(t, { "stalled.mov": { timeout: true } });
  const pending = galleryMediaFromFiles([file("stalled.mov"), file("photo.png")]);
  await Promise.resolve();
  assert.equal(media.active.size, 1);
  t.mock.timers.tick(15000);
  const result = await pending;
  assert.deepEqual(result.items.map((item) => item.name), ["photo"]);
  assert.deepEqual(result.skipped, ["stalled.mov"]);
  assert.deepEqual(media.revoked, ["blob:test-1"]);
  assert.equal(media.active.size, 0);
  media.elements.forEach(assertReleased);
});

test("metadata loading limits active decoders and preserves input order despite out-of-order completion", async (t) => {
  const media = setupMedia(t, {}, false);
  const names = Array.from({ length: 11 }, (_, index) => `clip${index}.mp4`);
  const pending = galleryMediaFromFiles(names.map((name) => file(name)));
  assert.equal(media.active.size, 4);
  while (media.active.size) {
    const element = [...media.active].at(-1);
    media.complete(element);
    await Promise.resolve();
  }
  const result = await pending;
  assert.equal(media.maximumActive, 4);
  assert.equal(media.elements.length, names.length);
  assert.deepEqual(result.items.map((item) => item.name), names.map((name) => name.replace(/\.mp4$/, "")));
  assert.deepEqual(result.skipped, []);
  media.elements.forEach(assertReleased);
});

test("slide duration follows the longest valid video, including videos shorter than the image pace", () => {
  const image = { kind: "image", durationMs: 0 };
  assert.equal(getSlideDurationMs([image, { kind: "video", durationMs: 2000 }], 5000), 2000);
  assert.equal(getSlideDurationMs([{ kind: "video", durationMs: 2250 }, image, { kind: "video", durationMs: 8500 }], 5000), 8500);
  assert.equal(getSlideDurationMs([image], 12000), 12000);
  assert.equal(getSlideDurationMs([], 3000), 3000);
  assert.equal(getSlideDurationMs([
    { kind: "video", durationMs: Infinity }, { kind: "video", durationMs: NaN },
    { kind: "video", durationMs: 0 }, { kind: "video", durationMs: -10 }, { kind: "image", durationMs: 99999 },
  ], 5000), 5000);
});
