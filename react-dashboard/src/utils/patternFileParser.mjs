function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;

  const normalized = {
    left: Number(bounds.left),
    top: Number(bounds.top),
    right: Number(bounds.right),
    bottom: Number(bounds.bottom),
  };
  if (!Object.values(normalized).every(Number.isFinite)) return null;
  if (normalized.right <= normalized.left || normalized.bottom <= normalized.top) return null;
  return normalized;
}

function getCellRecord(element) {
  const label = String(element?.contentDescription || element?.text || '');
  const match = label.match(/\bcell\s*([1-9])\b/i);
  const bounds = normalizeBounds(element?.bounds);
  if (!match || !bounds) return null;

  return {
    cell: Number(match[1]),
    cx: (bounds.left + bounds.right) / 2,
    cy: (bounds.top + bounds.bottom) / 2,
    bounds,
    clickable: element.clickable,
  };
}

function getFrameCells(frame) {
  const elements = frame?.screen?.elements;
  if (!Array.isArray(elements)) return [];

  const cells = new Map();
  for (const element of elements) {
    const record = getCellRecord(element);
    if (!record) continue;

    const previous = cells.get(record.cell);
    const area = (record.bounds.right - record.bounds.left) * (record.bounds.bottom - record.bounds.top);
    const previousArea = previous
      ? (previous.bounds.right - previous.bounds.left) * (previous.bounds.bottom - previous.bounds.top)
      : -1;
    if (!previous || area > previousArea) cells.set(record.cell, record);
  }
  return [...cells.values()];
}

function inferScreenSize(frames) {
  let screenBounds = null;
  let largestArea = 0;
  const allBounds = [];

  for (const frame of frames) {
    for (const element of frame?.screen?.elements || []) {
      const bounds = normalizeBounds(element?.bounds);
      if (!bounds) continue;
      allBounds.push(bounds);

      if (bounds.left === 0 && bounds.top === 0) {
        const area = bounds.right * bounds.bottom;
        if (area > largestArea) {
          largestArea = area;
          screenBounds = bounds;
        }
      }
    }
  }

  if (screenBounds) {
    return {
      screenWidth: screenBounds.right - screenBounds.left,
      screenHeight: screenBounds.bottom - screenBounds.top,
    };
  }

  if (allBounds.length === 0) return { screenWidth: 0, screenHeight: 0 };
  return {
    screenWidth: Math.max(...allBounds.map(bounds => bounds.right)),
    screenHeight: Math.max(...allBounds.map(bounds => bounds.bottom)),
  };
}

function orderByNearestCenter(candidates, startingCell, knownCells) {
  const remaining = [...candidates];
  const ordered = [];
  let previous = startingCell == null ? null : knownCells.get(startingCell);

  while (remaining.length) {
    remaining.sort((a, b) => {
      if (!previous) return a.cell - b.cell;
      const distanceA = Math.hypot(a.cx - previous.cx, a.cy - previous.cy);
      const distanceB = Math.hypot(b.cx - previous.cx, b.cy - previous.cy);
      return distanceA - distanceB || a.cell - b.cell;
    });
    const next = remaining.shift();
    ordered.push(next);
    previous = next;
  }

  return ordered;
}

export function parsePatternFileContents(contents, fileName = 'pattern.json') {
  let data;
  try {
    data = typeof contents === 'string' ? JSON.parse(contents) : contents;
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Expected a screen-reader recording object');
  }

  const frames = Array.isArray(data.frames) ? data.frames : [];
  if (frames.length === 0) throw new Error('No screen-reader frames found');

  const knownCells = new Map();
  const seenTouchedCells = new Set();
  const sequence = [];
  const simultaneousGroups = [];

  frames.forEach(frame => {
    const frameCells = getFrameCells(frame);
    if (frameCells.length === 0) return;

    frameCells.forEach(record => knownCells.set(record.cell, record));
    const hasClickableCells = frameCells.some(record => record.clickable === true);
    const newlyTouched = frameCells.filter(record => {
      const isTouched = record.clickable === false
        || (record.clickable !== true && hasClickableCells);
      return isTouched && !seenTouchedCells.has(record.cell);
    });

    if (newlyTouched.length === 0) return;
    if (newlyTouched.length > 1) {
      simultaneousGroups.push(newlyTouched.map(record => record.cell));
    }

    const ordered = orderByNearestCenter(
      newlyTouched,
      sequence.length ? sequence[sequence.length - 1] : null,
      knownCells,
    );
    ordered.forEach(record => {
      sequence.push(record.cell);
      seenTouchedCells.add(record.cell);
    });
  });

  if (sequence.length < 2) {
    throw new Error('Could not find at least two touched cells in the screen-reader frames');
  }

  const { screenWidth, screenHeight } = inferScreenSize(frames);
  if (screenWidth <= 0 || screenHeight <= 0) {
    throw new Error('Could not determine the screen dimensions from the file');
  }

  return {
    fileName,
    cells: sequence,
    cellCoords: [...knownCells.values()].sort((a, b) => a.cell - b.cell),
    screenWidth,
    screenHeight,
    frameCount: frames.length,
    simultaneousGroups,
  };
}
