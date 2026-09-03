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

test("start page stays viewport-contained and highlights the gallery behavior", async () => {
  const [page, styles] = await Promise.all([readFile(pageUrl, "utf8"), readFile(stylesUrl, "utf8")]);
  assert.match(styles, /\.app-shell \{[^}]*height:100svh[^}]*overflow:hidden/);
  assert.match(styles, /\.welcome \{[^}]*height:100%[^}]*overflow:hidden/);
  assert.match(page, /Fits the frame/);
  assert.match(page, /Fair rotation/);
  assert.match(page, /Direct the mix/);
  assert.match(page, /Inspect details/);
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
  assert.match(page, /timerPaused = paused \|\| detailLens !== null/);
  assert.match(page, /advanceRemainingRef\.current = Math\.max\(0, advanceDeadlineRef\.current - now\)/);
  assert.match(styles, /\.detail-lens \{[^}]*position:fixed[^}]*border-radius:50%/);
  assert.match(styles, /\.detail-lens \{[^}]*pointer-events:none/);
});

test("the top strip tracks viewed images in filename order", async () => {
  const [page, styles] = await Promise.all([readFile(pageUrl, "utf8"), readFile(stylesUrl, "utf8")]);
  assert.match(page, /left\.name\.localeCompare\(right\.name\)/);
  assert.match(page, /className="view-progress"/);
  assert.match(page, /historyRef\.current\.get\(photo\.id\)\?\.shown/);
  assert.match(styles, /\.view-progress \{[^}]*height:4px[^}]*grid-template-columns:repeat\(var\(--photo-count\),minmax\(0,1fr\)\)/);
  assert.match(styles, /\.view-progress-dot\.viewed \{ background:#fff/);
});
