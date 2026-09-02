import assert from "node:assert/strict";
import test from "node:test";
import { arrangePhotos, createSmartMosaic, smallTilePriorities } from "../src/layout.ts";

const photos = [
  { id: "portrait-a", width: 800, height: 1200 },
  { id: "landscape-a", width: 1200, height: 800 },
  { id: "wide", width: 1600, height: 900 },
  { id: "portrait-b", width: 900, height: 1600 },
  { id: "square", width: 1000, height: 1000 },
  { id: "landscape-b", width: 1800, height: 1200 },
];

function seededRandom(initialSeed) {
  let seed = initialSeed;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function assertExactCoverage(layout) {
  const area = layout.tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
  assert.ok(Math.abs(area - 1) < 1e-10, `tile area should fill the viewport; received ${area}`);
  for (const tile of layout.tiles) {
    assert.ok(tile.x >= 0 && tile.y >= 0);
    assert.ok(tile.x + tile.width <= 1 + 1e-10);
    assert.ok(tile.y + tile.height <= 1 + 1e-10);
  }
  for (let leftIndex = 0; leftIndex < layout.tiles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.tiles.length; rightIndex += 1) {
      const left = layout.tiles[leftIndex];
      const right = layout.tiles[rightIndex];
      const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
      const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
      assert.ok(overlapWidth * overlapHeight < 1e-10, "tiles should not overlap");
    }
  }
}

test("smart mosaic covers a landscape viewport with very little crop", () => {
  const layout = createSmartMosaic(photos, { width: 1920, height: 1080 }, new Map(), new Set(), new Set(), 0, seededRandom(42));
  assert.ok(layout);
  assertExactCoverage(layout);
  assert.ok(layout.crop < 0.02, `expected less than 2% average crop; received ${layout.crop}`);
});

test("the same selection reflows to fill a portrait viewport", () => {
  const layout = arrangePhotos(photos, { width: 390, height: 844 }, new Set(), seededRandom(84));
  assert.ok(layout);
  assertExactCoverage(layout);
  assert.ok(layout.crop < 0.03, `expected less than 3% average crop; received ${layout.crop}`);
});

test("small tiles are carried into a large slot on the next slide", () => {
  const currentLayout = {
    tiles: photos.slice(0, 6).map((photo, index) => ({
      photo,
      x: 0,
      y: 0,
      width: index < 2 ? 0.3 : 0.1,
      height: 1,
      crop: 0,
    })),
    crop: 0,
    score: 0,
    direction: "columns",
  };
  const priorities = smallTilePriorities(currentLayout);
  const previousIds = new Set(currentLayout.tiles.map((tile) => tile.photo.id));
  const morePhotos = [
    ...photos,
    { id: "new-a", width: 1400, height: 900 },
    { id: "new-b", width: 900, height: 1400 },
    { id: "new-c", width: 1500, height: 1000 },
    { id: "new-d", width: 1000, height: 1500 },
  ];
  const layout = createSmartMosaic(morePhotos, { width: 1920, height: 1080 }, new Map(), previousIds, priorities, 1, seededRandom(126));
  assert.ok(layout);
  assert.equal(priorities.size, 2);
  const areas = layout.tiles.map((tile) => tile.width * tile.height).sort((left, right) => right - left);
  const promotedAreas = layout.tiles
    .filter((tile) => priorities.has(tile.photo.id))
    .map((tile) => tile.width * tile.height)
    .sort((left, right) => right - left);
  assert.equal(promotedAreas.length, 2, "both small photos should carry over");
  assert.ok(promotedAreas[0] >= areas[0] * 0.9, "a carried photo should receive the largest slot");
  assert.ok(promotedAreas[1] >= areas[1] * 0.9, "the second carried photo should receive the second-largest slot");
});
