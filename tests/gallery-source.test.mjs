import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../src/App.tsx", import.meta.url);

test("gallery includes directory access and slideshow controls", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /showDirectoryPicker/);
  assert.match(page, /webkitdirectory/);
  assert.match(page, /requestFullscreen/);
  assert.match(page, /setInterval\(advance/);
});

test("gallery does not retain starter preview code", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview|react-loading-skeleton/);
});
