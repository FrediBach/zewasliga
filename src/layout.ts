export type LayoutPhoto = {
  id: string;
  width: number;
  height: number;
};

export type Viewport = {
  width: number;
  height: number;
};

export type PhotoUsage = {
  shown: number;
  lastShown: number;
};

export type MosaicTile<T extends LayoutPhoto> = {
  photo: T;
  x: number;
  y: number;
  width: number;
  height: number;
  crop: number;
};

export type MosaicLayout<T extends LayoutPhoto> = {
  tiles: MosaicTile<T>[];
  crop: number;
  score: number;
  direction: "rows" | "columns";
};

type Direction = MosaicLayout<LayoutPhoto>["direction"];

const MAX_PHOTOS_PER_SLIDE = 8;
const compositionCache = new Map<number, number[][]>();

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function aspectRatio(photo: LayoutPhoto) {
  if (!Number.isFinite(photo.width) || !Number.isFinite(photo.height) || photo.width <= 0 || photo.height <= 0) return 1;
  return clamp(photo.width / photo.height, 0.12, 8);
}

function shuffled<T>(items: readonly T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function compositions(total: number) {
  const cached = compositionCache.get(total);
  if (cached) return cached;

  const result: number[][] = [];
  const visit = (remaining: number, parts: number[]) => {
    if (remaining === 0) {
      result.push(parts);
      return;
    }
    for (let size = 1; size <= remaining; size += 1) visit(remaining - size, [...parts, size]);
  };
  visit(total, []);
  compositionCache.set(total, result);
  return result;
}

function cropFraction(photoRatio: number, slotRatio: number) {
  return 1 - Math.min(photoRatio / slotRatio, slotRatio / photoRatio);
}

function targetPhotoCount(total: number, viewport: Viewport) {
  const area = viewport.width * viewport.height;
  const target = area > 1_750_000 ? 7 : area > 1_150_000 ? 6 : area > 750_000 ? 5 : area > 450_000 ? 4 : 3;
  return Math.min(total, target);
}

function makeLayout<T extends LayoutPhoto>(
  photos: readonly T[],
  groups: readonly number[],
  viewport: Viewport,
  direction: Direction,
) {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const tiles: MosaicTile<T>[] = [];
  let photoIndex = 0;

  if (direction === "rows") {
    const rowData = groups.map((size) => {
      const rowPhotos = photos.slice(photoIndex, photoIndex + size);
      photoIndex += size;
      const ratioTotal = rowPhotos.reduce((sum, photo) => sum + aspectRatio(photo), 0);
      return { photos: rowPhotos, ratioTotal, idealHeight: width / ratioTotal };
    });
    const idealHeightTotal = rowData.reduce((sum, row) => sum + row.idealHeight, 0);
    let y = 0;

    rowData.forEach((row, rowIndex) => {
      const tileHeight = rowIndex === rowData.length - 1 ? 1 - y : row.idealHeight / idealHeightTotal;
      let x = 0;
      row.photos.forEach((photo, columnIndex) => {
        const tileWidth = columnIndex === row.photos.length - 1 ? 1 - x : aspectRatio(photo) / row.ratioTotal;
        const slotRatio = (tileWidth * width) / (tileHeight * height);
        tiles.push({ photo, x, y, width: tileWidth, height: tileHeight, crop: cropFraction(aspectRatio(photo), slotRatio) });
        x += tileWidth;
      });
      y += tileHeight;
    });
  } else {
    const columnData = groups.map((size) => {
      const columnPhotos = photos.slice(photoIndex, photoIndex + size);
      photoIndex += size;
      const inverseRatioTotal = columnPhotos.reduce((sum, photo) => sum + 1 / aspectRatio(photo), 0);
      return { photos: columnPhotos, inverseRatioTotal, idealWidth: height / inverseRatioTotal };
    });
    const idealWidthTotal = columnData.reduce((sum, column) => sum + column.idealWidth, 0);
    let x = 0;

    columnData.forEach((column, columnIndex) => {
      const tileWidth = columnIndex === columnData.length - 1 ? 1 - x : column.idealWidth / idealWidthTotal;
      let y = 0;
      column.photos.forEach((photo, rowIndex) => {
        const tileHeight = rowIndex === column.photos.length - 1 ? 1 - y : (1 / aspectRatio(photo)) / column.inverseRatioTotal;
        const slotRatio = (tileWidth * width) / (tileHeight * height);
        tiles.push({ photo, x, y, width: tileWidth, height: tileHeight, crop: cropFraction(aspectRatio(photo), slotRatio) });
        y += tileHeight;
      });
      x += tileWidth;
    });
  }

  return tiles;
}

function scoreLayout<T extends LayoutPhoto>(tiles: MosaicTile<T>[], viewport: Viewport) {
  const crop = tiles.reduce((sum, tile) => sum + tile.crop, 0) / tiles.length;
  const worstCrop = Math.max(...tiles.map((tile) => tile.crop));
  const shortEdgeTarget = clamp(Math.min(viewport.width, viewport.height) * 0.19, 104, 190);
  const smallTilePenalty = tiles.reduce((sum, tile) => {
    const shortEdge = Math.min(tile.width * viewport.width, tile.height * viewport.height);
    const shortage = Math.max(0, (shortEdgeTarget - shortEdge) / shortEdgeTarget);
    return sum + shortage * shortage;
  }, 0) / tiles.length;

  return { crop, score: crop * 1.3 + worstCrop * 0.22 + smallTilePenalty * 0.34 };
}

function bestArrangementForOrder<T extends LayoutPhoto>(photos: readonly T[], viewport: Viewport) {
  let best: MosaicLayout<T> | null = null;
  for (const groups of compositions(photos.length)) {
    for (const direction of ["rows", "columns"] as const) {
      const tiles = makeLayout(photos, groups, viewport, direction);
      const metrics = scoreLayout(tiles, viewport);
      if (!best || metrics.score < best.score) best = { tiles, ...metrics, direction };
    }
  }
  return best as MosaicLayout<T>;
}

function weightedSelection<T extends LayoutPhoto>(
  pool: readonly T[],
  count: number,
  history: ReadonlyMap<string, PhotoUsage>,
  slideNumber: number,
  random: () => number,
) {
  const available = [...pool];
  const selected: T[] = [];
  while (selected.length < count && available.length) {
    const weights = available.map((photo) => {
      const usage = history.get(photo.id);
      if (!usage) return 5;
      const slidesAgo = slideNumber - usage.lastShown;
      const recencyWeight = slidesAgo <= 1 ? 0.08 : slidesAgo === 2 ? 0.32 : slidesAgo === 3 ? 0.62 : 1;
      return recencyWeight / (1 + usage.shown * 0.24);
    });
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = clamp(random(), 0, 0.999999999) * weightTotal;
    let choice = available.length - 1;
    for (let index = 0; index < weights.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) {
        choice = index;
        break;
      }
    }
    selected.push(available.splice(choice, 1)[0]);
  }
  return selected;
}

function orderedFairPool<T extends LayoutPhoto>(
  photos: readonly T[],
  history: ReadonlyMap<string, PhotoUsage>,
  maximumCount: number,
  random: () => number,
) {
  const ranked = photos.map((photo) => ({
    photo,
    usage: history.get(photo.id) ?? { shown: 0, lastShown: Number.NEGATIVE_INFINITY },
    jitter: random(),
  })).sort((left, right) => (
    left.usage.shown - right.usage.shown
    || left.usage.lastShown - right.usage.lastShown
    || left.jitter - right.jitter
  ));
  const poolSize = Math.min(ranked.length, Math.max(28, maximumCount * 7));
  return ranked.slice(0, poolSize).map(({ photo }) => photo);
}

export function arrangePhotos<T extends LayoutPhoto>(
  photos: readonly T[],
  viewport: Viewport,
  random: () => number = Math.random,
) {
  if (!photos.length) return null;

  const byRatio = [...photos].sort((left, right) => aspectRatio(left) - aspectRatio(right));
  const orders: T[][] = [
    [...photos],
    byRatio,
    [...byRatio].reverse(),
  ];
  const trialCount = photos.length < 3 ? 3 : 80;
  while (orders.length < trialCount) orders.push(shuffled(photos, random));

  let best: MosaicLayout<T> | null = null;
  for (const order of orders) {
    const candidate = bestArrangementForOrder(order, viewport);
    if (!best || candidate.score < best.score) best = candidate;
  }
  return best;
}

export function createSmartMosaic<T extends LayoutPhoto>(
  photos: readonly T[],
  viewport: Viewport,
  history: ReadonlyMap<string, PhotoUsage>,
  previousIds: ReadonlySet<string>,
  slideNumber: number,
  random: () => number = Math.random,
) {
  if (!photos.length) return null;

  const targetCount = targetPhotoCount(photos.length, viewport);
  const minimumCount = photos.length === 1 ? 1 : Math.max(2, targetCount - 2);
  const maximumCount = Math.min(photos.length, MAX_PHOTOS_PER_SLIDE, targetCount + 1);
  const counts = Array.from({ length: maximumCount - minimumCount + 1 }, (_, index) => minimumCount + index);
  const pool = orderedFairPool(photos, history, maximumCount, random);
  const minimumShown = Math.min(...photos.map((photo) => history.get(photo.id)?.shown ?? 0));
  const trialCount = photos.length <= 10 ? 240 : 440;
  let best: MosaicLayout<T> | null = null;

  for (let trial = 0; trial < trialCount; trial += 1) {
    const count = counts[trial % counts.length];
    const selected = trial < counts.length
      ? pool.slice(0, count)
      : weightedSelection(pool, count, history, slideNumber, random);
    const arranged = bestArrangementForOrder(shuffled(selected, random), viewport);
    const overlap = arranged.tiles.reduce((sum, tile) => sum + Number(previousIds.has(tile.photo.id)), 0);
    const unavoidableOverlap = Math.max(0, count + previousIds.size - photos.length);
    const avoidableOverlap = Math.max(0, overlap - unavoidableOverlap) / count;
    const usagePenalty = arranged.tiles.reduce((sum, tile) => {
      const shown = history.get(tile.photo.id)?.shown ?? 0;
      return sum + Math.max(0, shown - minimumShown);
    }, 0) / count;
    const selectionScore = arranged.score
      + Math.abs(count - targetCount) * 0.018
      + avoidableOverlap * 0.48
      + usagePenalty * 0.09;

    if (!best || selectionScore < best.score) best = { ...arranged, score: selectionScore };
  }

  return best;
}
