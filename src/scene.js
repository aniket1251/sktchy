// scene.js - the ordered node list plus pure geometry helpers.

let nodeIdCounter = 0;

export function createScene() {
  return { nodes: [] };
}

export function createNode(type, x, y, w, h) {
  const bounds = normalizeRect(x, y, w, h);
  return {
    id: "n" + nodeIdCounter++,
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    type,
    fill: "transparent",
    selected: false,
  };
}

// A line connecting two boxes by reference. Each end stores the node id and a
// connection-point index (0 = top-center, 1 = bottom-center) so the endpoints
// are recomputed from live box geometry and follow drag/resize.
export function createLine(fromId, fromAnchor, toId, toAnchor) {
  return {
    id: "n" + nodeIdCounter++,
    type: "line",
    fromId,
    fromAnchor,
    toId,
    toAnchor,
    selected: false,
  };
}

// The two connection points on a box's vertical axis, in world space.
// Index 0 = top-center, 1 = bottom-center. Kept here so geometry has a single home.
export function connectionAnchor(node, index) {
  const cx = node.x + node.w / 2;
  return index === 0 ? { x: cx, y: node.y } : { x: cx, y: node.y + node.h };
}

// Outward normal for an anchor: top (0) points up, bottom (1) points down.
function anchorNormal(index) {
  return index === 0 ? -1 : 1; // sign on the Y axis
}

// How far a connector steps straight out of a box before it may turn, so the
// line clears the shape body instead of cutting across it.
const LINE_STUB = 24;

// Orthogonal (right-angle) route between two boxes as a list of world points.
// The line leaves each anchor perpendicular to its edge, travels through free
// space, and arrives perpendicular to the other anchor - so it never clips the
// shapes the way a direct diagonal does. Falls back to [] if a node is gone.
export function lineRoute(scene, line) {
  const from = scene.nodes.find((n) => n.id === line.fromId);
  const to = scene.nodes.find((n) => n.id === line.toId);
  if (!from || !to) return [];

  const a = connectionAnchor(from, line.fromAnchor);
  const b = connectionAnchor(to, line.toAnchor);
  const an = anchorNormal(line.fromAnchor);
  const bn = anchorNormal(line.toAnchor);

  // Step each anchor straight out of its box so the line always clears the body.
  const a1 = { x: a.x, y: a.y + an * LINE_STUB };
  const b1 = { x: b.x, y: b.y + bn * LINE_STUB };

  if (an === bn) {
    // Same side (e.g. both tops): run a horizontal rail past the outer stub,
    // so the span bridging the boxes sits clear of both.
    const rail = an < 0 ? Math.min(a1.y, b1.y) : Math.max(a1.y, b1.y);
    return [a, a1, { x: a1.x, y: rail }, { x: b1.x, y: rail }, b1, b];
  }

  // Opposite sides: drop a vertical seam midway in x, meeting the two stub levels.
  const seamX = (a1.x + b1.x) / 2;
  return [a, a1, { x: seamX, y: a1.y }, { x: seamX, y: b1.y }, b1, b];
}

export function pointInRect(px, py, rect) {
  // Lines have no rect body; never hit-test or select them.
  if (rect.type === "line") return false;
  return (
    px >= rect.x &&
    px <= rect.x + rect.w &&
    py >= rect.y &&
    py <= rect.y + rect.h
  );
}

export function rectsIntersect(a, b) {
  if (a.type === "line" || b.type === "line") return false;
  return (
    a.x <= b.x + b.w &&
    a.x + a.w >= b.x &&
    a.y <= b.y + b.h &&
    a.y + a.h >= b.y
  );
}

// Topmost node containing the point, or null.
export function hitTest(scene, wx, wy) {
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    if (pointInRect(wx, wy, scene.nodes[i])) return scene.nodes[i];
  }
  return null;
}

// All nodes containing the point, topmost first.
export function hitTestAll(scene, wx, wy) {
  const hits = [];
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    if (pointInRect(wx, wy, scene.nodes[i])) hits.push(scene.nodes[i]);
  }
  return hits;
}

// Pick the node to select: topmost on a fresh click, next-below when cycling, so nested shapes are reachable.
export function hitTestCycle(scene, wx, wy, current) {
  const hits = hitTestAll(scene, wx, wy);
  if (hits.length === 0) return null;
  const idx = current ? hits.indexOf(current) : -1;
  if (idx === -1) return hits[0];
  return hits[(idx + 1) % hits.length];
}

export function selectOnly(scene, node) {
  for (const n of scene.nodes) n.selected = n === node;
}

export function clearSelection(scene) {
  for (const n of scene.nodes) n.selected = false;
}

export function getSelected(scene) {
  return scene.nodes.filter((n) => n.selected);
}

// Axis-aligned union bounds of the given nodes, or null if empty.
export function unionBounds(nodes) {
  if (nodes.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    if (n.type === "line") continue;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function setSelectionByMarquee(scene, rect) {
  for (const n of scene.nodes) n.selected = rectsIntersect(rect, n);
}

// Remove selected nodes in place, keeping the rest in draw order. Also drop any
// line whose referenced box was removed, so no dangling connectors remain.
export function removeSelected(scene) {
  const removedIds = new Set(
    scene.nodes.filter((n) => n.selected).map((n) => n.id)
  );
  const kept = scene.nodes.filter((n) => {
    if (n.selected) return false;
    if (n.type === "line" && (removedIds.has(n.fromId) || removedIds.has(n.toId))) {
      return false;
    }
    return true;
  });
  scene.nodes.length = 0;
  for (const node of kept) scene.nodes.push(node);
}

// Normalize so (x, y) is the top-left and w, h are non-negative.
export function normalizeRect(x, y, w, h) {
  return {
    x: w < 0 ? x + w : x,
    y: h < 0 ? y + h : y,
    w: Math.abs(w),
    h: Math.abs(h),
  };
}
