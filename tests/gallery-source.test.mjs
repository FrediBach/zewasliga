import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../src/App.tsx", import.meta.url);
const stylesUrl = new URL("../src/index.css", import.meta.url);

test("gallery includes directory access and slideshow controls", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /showDirectoryPicker/);
  assert.match(page, /webkitdirectory/);
  assert.match(page, /requestFullscreen/);
  assert.match(page, /ArrowLeft/);
  assert.match(page, /ArrowRight.*ArrowDown/);
  assert.match(page, /ArrowUp/);
  assert.match(page, /remainingMs \+ intervalMs/);
  assert.match(page, /className={`duration-pie/);
  assert.match(page, /--remaining/);
});

test("gallery does not retain starter preview code", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview|react-loading-skeleton/);
});

test("slide countdown stays fixed in the bottom-right corner", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  assert.match(styles, /\.duration-pie \{[^}]*position:fixed/);
  assert.match(styles, /\.duration-pie \{[^}]*right:24px;[^}]*bottom:24px/);
});
