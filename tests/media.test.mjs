import assert from "node:assert/strict";
import test from "node:test";
import { collectMediaFiles, compareMediaFiles, isImageFile, isAudioFile, isVideoFile, mediaPath } from "../src/media.ts";

function fileEntry(name, type = "") {
  const file = new File([name], name, { type });
  return { kind: "file", name, getFile: async () => file };
}

function directory(name, entries) {
  return { kind: "directory", name, async *values() { yield* entries; } };
}

test("media recognition supports MIME types and case-insensitive extensions", () => {
  for (const name of ["photo.AVIF", "photo.gif", "photo.JPG", "photo.jpeg", "photo.PNG", "photo.webp"]) {
    assert.equal(isImageFile({ name, type: "" }), true);
  }
  assert.equal(isImageFile({ name: "photo", type: "image/jpeg" }), true);
  assert.equal(isImageFile({ name: "track.mp3", type: "audio/mpeg" }), false);
  for (const [name, type] of [
    ["track.MP3", ""], ["track", "audio/mpeg"], ["track", "audio/mp3"],
    ["track.WAV", ""], ["track.wav", "application/octet-stream"],
    ["track", "audio/wav"], ["track", "audio/x-wav"], ["track", "audio/wave"], ["track", "audio/vnd.wave"],
    ["track", "Audio/WAV"],
  ]) {
    assert.equal(isAudioFile({ name, type }), true, `${name} (${type}) should be supported`);
  }
  for (const name of ["notes.mp3.txt", "notes.wav.txt", "track.ogg", "movie.mp4"]) {
    assert.equal(isAudioFile({ name, type: "" }), false);
  }
  for (const [name, type] of [["clip.MP4", ""], ["clip.mov", "application/octet-stream"], ["clip", "video/mp4"], ["clip", "Video/QuickTime"]]) {
    assert.equal(isVideoFile({ name, type }), true);
  }
  for (const name of ["clip.mp4.txt", "clip.webm", "clip.m4v", "track.mp3"]) {
    assert.equal(isVideoFile({ name, type: "" }), false);
  }
});

test("recursive folder intake preserves relative paths and natural order", async () => {
  const entries = [
    directory("disc10", [fileEntry("01.mp3"), fileEntry("notes.txt")]),
    fileEntry("cover.PNG"),
    directory("disc2", [fileEntry("track10.MP3"), fileEntry("track2.WAV"), fileEntry("01.mp3")]),
    fileEntry("video.mp4"),
    directory("videos", [fileEntry("clip.MOV"), fileEntry("unsupported.webm")]),
    fileEntry("mime-only", "audio/x-wav"),
  ];
  const files = await collectMediaFiles(directory("album", entries));
  assert.deepEqual(files.map(mediaPath), [
    "cover.PNG", "disc2/01.mp3", "disc2/track2.WAV", "disc2/track10.MP3", "disc10/01.mp3", "mime-only", "video.mp4", "videos/clip.MOV",
  ]);
  assert.equal(files[1].name, "01.mp3");
  assert.equal(files[4].name, "01.mp3");
  assert.equal(Object.hasOwn(files[1], "webkitRelativePath"), false);

  const reversed = await collectMediaFiles(directory("album", [...entries].reverse()));
  assert.deepEqual(reversed.map(mediaPath), files.map(mediaPath));
});

test("directory input and picker use the same track ordering", async () => {
  const picked = await collectMediaFiles(directory("album", [
    directory("disc10", [fileEntry("01.mp3")]),
    directory("disc2", [fileEntry("track10.wav"), fileEntry("track2.mp3")]),
  ]));
  const inputFiles = picked.map((file) => {
    const inputFile = new File([""], file.name);
    Object.defineProperty(inputFile, "webkitRelativePath", { value: `album/${mediaPath(file)}` });
    return inputFile;
  }).reverse();
  assert.deepEqual(inputFiles.sort(compareMediaFiles).map(mediaPath), picked.map((file) => `album/${mediaPath(file)}`));
});

test("loose files sort naturally with reproducible case and number ties", () => {
  const files = ["10.mp3", "2.mp3", "02.mp3", "a.mp3", "A.mp3"].map((name) => new File([""], name));
  assert.deepEqual(files.sort(compareMediaFiles).map(mediaPath), ["02.mp3", "2.mp3", "10.mp3", "A.mp3", "a.mp3"]);
  assert.deepEqual(files.reverse().sort(compareMediaFiles).map(mediaPath), ["02.mp3", "2.mp3", "10.mp3", "A.mp3", "a.mp3"]);
});
