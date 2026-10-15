import { resolveSketch, SKETCH_PLANES } from './sketch.mjs';
import { quantity, dimensions } from './units.mjs';
import { renderConstraintPreview, cancelConstraintPreview } from './constraints-view.mjs';

const NS = 'http://www.w3.org/2000/svg';
function svgElement(tag, attrs, text) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}
// Read-only profile rendering, except for explicit polygon handle drags supplied by the editor.
export function renderSketchPreview(parent, input, values, operation, movePoint) {
  if(input.profile.type==='constrained') {renderConstraintPreview(parent,input,values,operation);return;}
  cancelConstraintPreview(parent);
  parent.replaceChildren();
  let sketch, error = '';
  try { sketch = resolveSketch(input, values); } catch (e) { error = e.message; }
  const heading = document.createElement('h2'); heading.textContent = `${input.name || 'Profile sketch'} · ${input.plane}`;
  const description = document.createElement('p');
  description.textContent = error || `${(sketch.area * 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 })} mm² · ${input.profile.type} · dimensioned coordinates`;
  description.className = error ? 'sketch-error' : 'note';
  parent.append(heading, description);
  let profile = sketch?.profile;
  // Keep an invalid polygon visible as a draft so crossing edges can be repaired.
  if (!profile && input.profile.type === 'polygon') {
    try { profile = { points: input.profile.points.map((p) => p.position.map((v) => quantity(v, dimensions.length, values))) }; }
    catch { /* Invalid coordinate expressions have no geometric preview. */ }
  }
  if (!profile) return;
  const pts = profile.points || [
    [profile.center[0] - profile.radiusU, profile.center[1] - profile.radiusV],
    [profile.center[0] + profile.radiusU, profile.center[1] + profile.radiusV],
  ];
  if (!pts.length) return;
  const low = [0, 1].map((a) => Math.min(0, ...pts.map((p) => p[a]))), high = [0, 1].map((a) => Math.max(0, ...pts.map((p) => p[a])));
  const span = Math.max(high[0] - low[0], high[1] - low[1], 0.001);
  const center = high.map((v, i) => (v + low[i]) / 2), scale = 400 / span;
  const project = (p) => [300 + (p[0] - center[0]) * scale, 240 - (p[1] - center[1]) * scale];
  const svg = svgElement('svg', { viewBox: '0 0 600 480', role: 'img', 'aria-label': `${input.plane} sketch profile; U horizontal and V vertical; dimensions in millimetres` });
  const zero = project([0, 0]);
  for (let i = 0; i <= 10; i++) {
    const x = 60 + 48 * i, y = 40 + 40 * i;
    svg.append(svgElement('line', { x1: x, y1: 40, x2: x, y2: 440, class: 'sketch-grid' }), svgElement('line', { x1: 60, y1: y, x2: 540, y2: y, class: 'sketch-grid' }));
  }
  svg.append(svgElement('line', { x1: 30, y1: zero[1], x2: 570, y2: zero[1], class: 'sketch-axis' }), svgElement('line', { x1: zero[0], y1: 20, x2: zero[0], y2: 455, class: operation === 'revolve' ? 'sketch-revolve-axis' : 'sketch-axis' }));
  svg.append(svgElement('text', { x: 570, y: Math.max(20, Math.min(460, zero[1] - 10)), class: 'sketch-axis-label' }, 'U'), svgElement('text', { x: Math.max(30, Math.min(550, zero[0] + 10)), y: 20, class: 'sketch-axis-label' }, operation === 'revolve' ? 'V · revolve axis' : 'V'));
  const style = { class: `sketch-profile${error ? ' invalid' : ''}` };
  if (profile.points) svg.append(svgElement('polygon', { points: profile.points.map((p) => project(p).join(',')).join(' '), ...style }));
  else { const c = project(profile.center); svg.append(svgElement('ellipse', { cx: c[0], cy: c[1], rx: profile.radiusU * scale, ry: profile.radiusV * scale, ...style })); }
  if (input.profile.type === 'polygon') {
    // Source order is retained for editable handles even if the kernel reverses a clockwise wire.
    const points = input.profile.points.map((p) => p.position.map((v) => quantity(v, dimensions.length, values)));
    for (const [i, point] of points.entries()) {
      const p = project(point), handle = svgElement('circle', { cx: p[0], cy: p[1], r: 10, class: 'sketch-handle', 'data-point': i });
      svg.append(handle, svgElement('text', { x: p[0] + 9, y: p[1] - 9, class: 'sketch-point-label' }, String(i + 1)));
    }
    let dragging = null, moved = false, latest;
    svg.addEventListener('pointerdown', (e) => {
      const index = e.target.getAttribute('data-point');
      if (index === null) return;
      dragging = Number(index); moved = false; latest = null; svg.setPointerCapture(e.pointerId); e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      if (dragging === null) return;
      const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      latest = [(point.x - 300) / scale + center[0], (240 - point.y) / scale + center[1]].map((v) => Math.round(v * 2000) / 2);
      const preview = project(latest.map((v) => v / 1000)), handle = svg.querySelector(`[data-point="${dragging}"]`);
      handle.setAttribute('cx', preview[0]); handle.setAttribute('cy', preview[1]); moved = true;
    });
    const end = () => { const index = dragging; dragging = null; if (moved && latest) movePoint(index, latest); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', () => { dragging = null; });
  }
  parent.append(svg);
  const foot = document.createElement('p'); foot.className = 'note';
  const frame = SKETCH_PLANES[input.plane], axis = (v) => `${v.find((n) => n) < 0 ? '−' : '+'}${'XYZ'[v.findIndex((n) => n)]}`;
  foot.textContent = `U = ${axis(frame.u)}, V = ${axis(frame.v)}; extrusion normal = ${axis(frame.normal)}. ${input.profile.type === 'polygon' ? 'Drag numbered points to a 0.5 mm grid, or edit their expressions. Dragging replaces that point’s expressions with coordinates. ' : ''}Apply changes to regenerate the solid.`;
  parent.append(foot);
}
