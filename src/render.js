// render.js - all canvas drawing. Pure: reads camera + scene + overlay, mutates nothing.

import { unionBounds } from "./scene.js";

// Theme-driven colors cached from CSS custom properties, refreshed only on theme
// change so draw() never pays for getComputedStyle per frame.
const theme = {
  background: "#ffffff",
  dotGrid: "#d4d4d8",
  shapeStroke: "#000000",
  selBlue: "#3b82f6",
  selBlueFill: "rgba(59, 130, 246, 0.1)",
  handleFill: "#ffffff",
};

// Re-read themed colors from CSS variables into the cache; call on startup and theme change.
export function refreshTheme() {
  const s = getComputedStyle(document.documentElement);
  const read = (name, fallback) => {
    const v = s.getPropertyValue(name).trim();
    return v || fallback;
  };
  theme.background = read("--canvas-bg", theme.background);
  theme.dotGrid = read("--dot-grid", theme.dotGrid);
  theme.shapeStroke = read("--shape-stroke", theme.shapeStroke);
  theme.selBlue = read("--sel-blue", theme.selBlue);
  theme.selBlueFill = read("--sel-blue-fill", theme.selBlueFill);
  theme.handleFill = read("--handle-fill", theme.handleFill);
}

export function draw(ctx, canvas, camera, scene, overlay) {
  // Clear the backing store in device-pixel space.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Combined DPR + camera transform: one world unit -> scale CSS px at the current DPR.
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(
    camera.scale * dpr,
    0,
    0,
    camera.scale * dpr,
    camera.offsetX * dpr,
    camera.offsetY * dpr
  );

  drawGrid(ctx, camera);

  for (const node of scene.nodes) {
    drawNode(ctx, node, camera.scale);
  }

  for (const node of scene.nodes) {
    if (node.selected) drawSelection(ctx, node, camera.scale);
  }

  // Handles on a single selected node, or a group box around a multi-selection.
  const selected = scene.nodes.filter((n) => n.selected);
  if (selected.length === 1) {
    drawHandles(ctx, selected[0], camera.scale);
  } else if (selected.length > 1) {
    const box = unionBounds(selected);
    drawSelection(ctx, box, camera.scale);
    drawHandles(ctx, box, camera.scale);
  }

  if (overlay && overlay.draftNode) {
    drawNode(ctx, overlay.draftNode, camera.scale);
  }

  if (overlay && overlay.marqueeRect) {
    drawMarquee(ctx, overlay.marqueeRect, camera.scale);
  }
}

// Dot grid in world space across only the visible rect, so cost stays bounded at any zoom.
const GRID_STEP = 40;
const GRID_MAX_DOTS = 20000;
function drawGrid(ctx, camera) {
  const tl = camera.screenToWorld(0, 0);
  const br = camera.screenToWorld(camera.vw, camera.vh);
  const minX = Math.min(tl.x, br.x);
  const maxX = Math.max(tl.x, br.x);
  const minY = Math.min(tl.y, br.y);
  const maxY = Math.max(tl.y, br.y);

  const startX = Math.floor(minX / GRID_STEP) * GRID_STEP;
  const startY = Math.floor(minY / GRID_STEP) * GRID_STEP;

  // Bail out when zoomed so far out the lattice would be too dense.
  const cols = Math.floor((maxX - startX) / GRID_STEP) + 1;
  const rows = Math.floor((maxY - startY) / GRID_STEP) + 1;
  if (cols * rows > GRID_MAX_DOTS) return;

  const r = 1 / camera.scale; // ~1 CSS px regardless of zoom
  ctx.fillStyle = theme.dotGrid;
  for (let x = startX; x <= maxX; x += GRID_STEP) {
    for (let y = startY; y <= maxY; y += GRID_STEP) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Marquee: translucent fill + dashed border, screen-constant via divide-by-scale.
function drawMarquee(ctx, rect, scale) {
  ctx.fillStyle = theme.selBlueFill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = theme.selBlue;
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([4 / scale, 4 / scale]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.setLineDash([]);
}

// Dashed blue ring offset outside the shape (all sizes screen-constant).
const SELECT_GAP = 10;
const SELECT_WIDTH = 1.5;
const SELECT_DASH = 4;
function drawSelection(ctx, node, scale) {
  const pad = SELECT_GAP / scale;
  ctx.strokeStyle = theme.selBlue;
  ctx.lineWidth = SELECT_WIDTH / scale;
  ctx.setLineDash([SELECT_DASH / scale, SELECT_DASH / scale]);
  ctx.strokeRect(node.x - pad, node.y - pad, node.w + pad * 2, node.h + pad * 2);
  ctx.setLineDash([]);
}

export const HANDLE_SCREEN = 10;

// Handle centers, offset onto the dashed ring (shared SELECT_GAP). Used to draw and hit-test.
export function handleCenters(node, scale = 1) {
  const g = SELECT_GAP / scale;
  return [
    { x: node.x - g, y: node.y - g },
    { x: node.x + node.w + g, y: node.y - g },
    { x: node.x - g, y: node.y + node.h + g },
    { x: node.x + node.w + g, y: node.y + node.h + g },
  ];
}

function drawHandles(ctx, node, scale) {
  const s = HANDLE_SCREEN / scale;
  const half = s / 2;
  const r = 2 / scale;
  ctx.fillStyle = theme.handleFill;
  ctx.strokeStyle = theme.selBlue;
  ctx.lineWidth = 1.5 / scale;
  for (const c of handleCenters(node, scale)) {
    ctx.beginPath();
    ctx.roundRect(c.x - half, c.y - half, s, s, r);
    ctx.fill();
    ctx.stroke();
  }
}

// Shape styling: themed outline, per-node fill, rounded rects.
const SHAPE_STROKE_WIDTH = 1.5;
const RECT_RADIUS = 4;

function drawNode(ctx, node, scale) {
  ctx.fillStyle = node.fill;
  ctx.strokeStyle = theme.shapeStroke;
  ctx.lineWidth = SHAPE_STROKE_WIDTH / scale; // constant ~1.5 CSS px at any zoom
  ctx.beginPath();
  if (node.type === "ellipse") {
    const rx = node.w / 2;
    const ry = node.h / 2;
    ctx.ellipse(node.x + rx, node.y + ry, rx, ry, 0, 0, Math.PI * 2);
  } else {
    ctx.roundRect(node.x, node.y, node.w, node.h, RECT_RADIUS);
  }
  ctx.fill();
  ctx.stroke();
}
