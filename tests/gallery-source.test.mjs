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

test("slide images receive subtle size-aware zoom motion", async () => {
  const [page, styles] = await Promise.all([readFile(pageUrl, "utf8"), readFile(stylesUrl, "utf8")]);
  assert.match(page, /Math\.sqrt\(Math\.max\(0, area\)\)/);
  assert.match(page, /Math\.min\(0\.055/);
  assert.match(page, /zoomsIn/);
  assert.match(styles, /@keyframes image-zoom/);
  assert.match(styles, /\.is-paused \.tile img \{ animation-play-state:paused/);
});

test("clicking a tile promotes it on the next slide", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /onClick=\{\(\) => promoteOnNextSlide\(tile\.photo\.id\)\}/);
  assert.match(page, /requestedPriorityId[\s\S]*new Set\(\[requestedPriorityId\]\)/);
  assert.match(page, /Show \$\{tile\.photo\.name\} large on the next slide/);
});

test("holding Shift shows a detail loupe at the pointer", async () => {
  const [page, styles] = await Promise.all([readFile(pageUrl, "utf8"), readFile(stylesUrl, "utf8")]);
  assert.match(page, /event\.key !== "Shift"/);
  assert.match(page, /showDetailLens\(event\.currentTarget, tile\.photo, event\.clientX, event\.clientY\)/);
  assert.match(page, /DETAIL_LENS_ZOOM/);
  assert.match(styles, /\.detail-lens \{[^}]*position:fixed[^}]*border-radius:50%/);
  assert.match(styles, /\.detail-lens \{[^}]*pointer-events:none/);
});
