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

export function pointInRect(px, py, rect) {
  return (
    px >= rect.x &&
    px <= rect.x + rect.w &&
    py >= rect.y &&
    py <= rect.y + rect.h
  );
}

export function rectsIntersect(a, b) {
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

// Remove selected nodes in place, keeping the rest in draw order.
export function removeSelected(scene) {
  const kept = scene.nodes.filter((n) => !n.selected);
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
