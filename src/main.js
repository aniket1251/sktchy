// Bootstrap: canvas setup, DPR-aware resize, and a requestAnimationFrame render loop.
// Nothing domain-specific yet. Build the camera, nodes, interactions, etc. on top of this.

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Resize the canvas backing store to match its CSS size * devicePixelRatio,
// so rendering stays sharp on HiDPI screens.
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  needsRender = true;
}

let needsRender = true;
function requestRender() {
  needsRender = true;
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // TODO: apply camera transform and draw the scene here.
}

function loop() {
  if (needsRender) {
    draw();
    needsRender = false;
  }
  requestAnimationFrame(loop);
}

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(loop);
