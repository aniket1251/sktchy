// main.js - wiring, active-tool state, DOM chrome sync, and the rAF render loop.

import { createScene, getSelected, clearSelection } from "./scene.js";
import { createCamera } from "./camera.js";
import { createHistory } from "./history.js";
import { draw as renderScene, refreshTheme } from "./render.js";
import { attachInteractions } from "./interactions.js";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const scene = createScene();
const history = createHistory(scene);
const camera = createCamera(window.innerWidth, window.innerHeight);

// Size backing store to CSS size * DPR for sharp HiDPI rendering.
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  camera.setViewport(rect.width, rect.height);
  needsRender = true;
}

let needsRender = true;
// True once the draw pipeline is wired, so applyTheme can paint synchronously.
let renderReady = false;
function requestRender() {
  needsRender = true;
}

const THEME_KEY = "sktchy-theme";
const themeToggleBtn = document.getElementById("theme-toggle");

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggleBtn) {
    // Show the icon for the theme you'd switch TO, as a fresh <i> for lucide.
    themeToggleBtn.innerHTML = `<i data-lucide="${isDark ? "sun" : "moon"}"></i>`;
    themeToggleBtn.title = isDark ? "Switch to light theme" : "Switch to dark theme";
    if (window.lucide) window.lucide.createIcons();
  }
  refreshTheme();
  // Paint synchronously so new colors land in the View Transition snapshot; defer if not wired yet.
  if (renderReady) {
    draw();
    needsRender = false;
  } else {
    requestRender();
  }
}

// Animate a theme switch as a circular reveal from the toggle button via the
// View Transition API; degrades to an instant apply when unavailable or reduced-motion.
function switchTheme(theme) {
  const prefersReduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!document.startViewTransition || prefersReduced) {
    applyTheme(theme);
    return;
  }

  // Reveal origin: center of the toggle button (fallback: corner).
  let cx = window.innerWidth;
  let cy = 0;
  if (themeToggleBtn) {
    const rect = themeToggleBtn.getBoundingClientRect();
    cx = rect.left + rect.width / 2;
    cy = rect.top + rect.height / 2;
  }
  // Radius to cover the whole viewport from that origin.
  const endRadius = Math.hypot(
    Math.max(cx, window.innerWidth - cx),
    Math.max(cy, window.innerHeight - cy)
  );

  const transition = document.startViewTransition(() => {
    applyTheme(theme);
  });

  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${cx}px ${cy}px)`,
            `circle(${endRadius}px at ${cx}px ${cy}px)`,
          ],
        },
        {
          duration: 900,
          easing: "cubic-bezier(0.65, 0, 0.35, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    })
    .catch(() => {});
}

function initTheme() {
  let theme = "light";
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") {
      theme = saved;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      theme = "dark";
    }
  } catch (_) {
    // localStorage may be unavailable (private mode); fall back to light.
  }
  return theme;
}

let currentTheme = initTheme();
// Apply before lucide.createIcons() so the correct toggle icon renders.
applyTheme(currentTheme);

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, currentTheme);
    } catch (_) {
      // Ignore persistence failures.
    }
    switchTheme(currentTheme);
    themeToggleBtn.blur();
  });
}

let activeTool = "select";
const getActiveTool = () => activeTool;

const toolButtons = document.querySelectorAll("#toolbar button[data-tool]");
function setActiveTool(tool) {
  const prev = activeTool;
  activeTool = tool;
  for (const btn of toolButtons) {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  }
  // Leaving Select clears the selection so its chrome doesn't linger.
  if (tool !== "select" && prev === "select" && getSelected(scene).length > 0) {
    clearSelection(scene);
    requestRender();
  }
  syncChrome();
  refreshCursor?.(); // guarded: first call runs before attachInteractions is wired
}
for (const btn of toolButtons) {
  btn.addEventListener("click", () => {
    setActiveTool(btn.dataset.tool);
    btn.blur(); // release focus so Space arms force-pan instead of re-clicking
  });
}

if (window.lucide) window.lucide.createIcons();

const zoomLabel = document.getElementById("zoom-label");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const hintLine = document.getElementById("hint-line");

function computeHint() {
  switch (activeTool) {
    case "hand":
      return "Drag to move the canvas";
    case "rect":
      return "Drag to draw a rectangle";
    case "ellipse":
      return "Drag to draw an ellipse";
    case "select":
    default:
      return getSelected(scene).length > 0
        ? "Drag to move - corner handle to resize - Delete to remove"
        : "Click a shape to select - drag empty area to marquee-select";
  }
}

const ZOOM_BTN_STEP = 0.01;

// Factor that shifts scale by +/- delta, for a center-anchored zoom.
function zoomStepFactor(delta) {
  return (camera.scale + delta) / camera.scale;
}

function syncChrome() {
  if (zoomLabel) zoomLabel.textContent = Math.round(camera.scale * 100) + "%";
  if (hintLine) hintLine.textContent = computeHint();
}

if (zoomInBtn) {
  zoomInBtn.addEventListener("click", () => {
    camera.zoomAtPoint(camera.vw / 2, camera.vh / 2, zoomStepFactor(ZOOM_BTN_STEP));
    requestRender();
    syncChrome();
  });
}
if (zoomOutBtn) {
  zoomOutBtn.addEventListener("click", () => {
    camera.zoomAtPoint(camera.vw / 2, camera.vh / 2, zoomStepFactor(-ZOOM_BTN_STEP));
    requestRender();
    syncChrome();
  });
}

const { getOverlay, undo, redo, deleteSelection, refreshCursor } = attachInteractions({
  canvas,
  camera,
  scene,
  history,
  getActiveTool,
  requestRender,
  syncChrome,
});

// Toolbar action buttons reuse the keyboard-shortcut handlers.
const actionHandlers = { undo, redo, delete: deleteSelection };
for (const btn of document.querySelectorAll("#toolbar button[data-action]")) {
  const handler = actionHandlers[btn.dataset.action];
  if (handler) {
    btn.addEventListener("click", () => {
      handler();
      btn.blur();
    });
  }
}

function draw() {
  renderScene(ctx, canvas, camera, scene, getOverlay());
}

function loop() {
  if (needsRender) {
    draw();
    needsRender = false;
  }
  requestAnimationFrame(loop);
}

renderReady = true;
window.addEventListener("resize", resize);
resize();
camera.centerOnOrigin();
setActiveTool(activeTool); // highlight the default (Select) and set its hint
syncChrome();
requestAnimationFrame(loop);
