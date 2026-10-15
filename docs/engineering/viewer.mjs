// Generic presentation layer. Geometry and numerical fields are supplied by the model.
// Orthographic rotation and keyboard navigation follow the existing workshop viewer.
import { surfaceMesh, temperatureSampler } from "./thermal.mjs";
import { pickVisibleEdge } from './edge-picking.mjs';
export function heatColor(value) {
  const t = Math.max(0, Math.min(1, value)),
    stops = [
      [0.16, 0.34, 0.87],
      [0.1, 0.76, 0.84],
      [0.92, 0.86, 0.33],
      [0.94, 0.27, 0.17],
    ];
  const i = Math.min(2, Math.floor(t * 3)),
    f = t * 3 - i;
  return stops[i].map((v, k) => v * (1 - f) + stops[i + 1][k] * f);
}
export function createEngineeringViewer(canvas, onSelect) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
  if (!gl)
    throw Error(
      "WebGL is unavailable. Enable hardware acceleration to use the 3D viewport.",
    );
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw Error("Unable to initialize the viewport shader.");
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(
    program,
    compile(
      gl.VERTEX_SHADER,
      `attribute vec3 position; attribute vec3 normal; attribute vec3 color; uniform mat3 rotation; uniform vec3 scale; uniform float field; varying vec3 tint; void main(){ vec3 p=rotation*position; gl_Position=vec4(p*scale,1.); float light=.55+.45*abs(dot(normalize(rotation*normal),normalize(vec3(-.4,.6,1.)))); tint=color*mix(light,1.,field); }`,
    ),
  );
  gl.attachShader(
    program,
    compile(
      gl.FRAGMENT_SHADER,
      "precision mediump float; varying vec3 tint; void main(){gl_FragColor=vec4(tint,1.);}",
    ),
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw Error("Unable to link the viewport program.");
  const uniforms = Object.fromEntries(
    ["rotation", "scale", "field"].map((n) => [
      n,
      gl.getUniformLocation(program, n),
    ]),
  );
  const attrs = ["position", "normal", "color"].map((n) =>
    gl.getAttribLocation(program, n),
  );
  const fill = gl.createBuffer(),
    lines = gl.createBuffer();
  let yaw = -0.55,
    pitch = 0.43,
    zoom = 1,
    faces = [],
    matrix = [],
    scale = [],
    fillCount = 0,
    lineCount = 0,
    field = false,
    showMesh = false,
    current, edgePick = null;
  function draw() {
    const rect = canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const c = Math.cos(yaw),
      s = Math.sin(yaw),
      cp = Math.cos(pitch),
      sp = Math.sin(pitch),
      aspect = canvas.width / canvas.height;
    matrix = [c, s * sp, -s * cp, 0, cp, sp, s, -c * sp, c * cp];
    scale = [
      (0.83 * zoom) / Math.max(aspect, 1),
      0.83 * zoom * Math.min(aspect, 1),
      -0.2,
    ];
    gl.useProgram(program);
    gl.uniformMatrix3fv(uniforms.rotation, false, matrix);
    gl.uniform3fv(uniforms.scale, scale);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    const bind = (buffer) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      attrs.forEach((a, i) => {
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 36, i * 12);
      });
    };
    bind(fill);
    gl.uniform1f(uniforms.field, field ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, fillCount);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (showMesh || !field) {
      bind(lines);
      gl.uniform1f(uniforms.field, 1);
      gl.drawArrays(gl.LINES, 0, lineCount);
    }
  }
  function setModel(options) {
    current = options;
    edgePick = null;
    const { size, cells, axis, result, range, selected } = options;
    field = !!result || !!options.field;
    showMesh = options.showMesh;
    let radius = Math.hypot(...size) / 2;
    const sample = result ? temperatureSampler(result) : null;
    if (options.empty || options.cad) {
      faces = [];
      const filled = [],
        wire = [],
        geometry = options.cad;
      if (geometry) {
        // Fit the displayed solid itself; a box-diagonal sphere wastes space
        // around round imported parts. Coordinates remain unchanged.
        const center = size.map((v, i) =>
          geometry.bounds
            ? (geometry.bounds[0][i] + geometry.bounds[1][i]) / 2
            : v / 2,
        );
        radius = 1e-12;
        for (let i = 0; i < geometry.mesh.vertices.length; i += 3)
          radius = Math.max(
            radius,
            Math.hypot(
              ...center.map(
                (c, axis) => geometry.mesh.vertices[i + axis] / 1000 - c,
              ),
            ),
          );
      }
      if(Number.isFinite(options.displayRadius)&&options.displayRadius>0)radius=options.displayRadius;
      const point = (array, offset) =>
        [0, 1, 2].map(
          (i) =>
            (array[offset + i] / 1000 -
              (geometry?.bounds
                ? (geometry.bounds[0][i] + geometry.bounds[1][i]) / 2
                : size[i] / 2)) /
            radius,
        );
      if (geometry) {
        const { vertices, normals, triangles } = geometry.mesh;
        for (const index of triangles)
          filled.push(
            ...point(vertices, index * 3),
            ...normals.slice(index * 3, index * 3 + 3),
            ...(geometry.mesh.colors?.slice(index*3,index*3+3)||[0.72,0.76,0.78]),
          );
        if(options.onSurfaceSelect)for(let i=0;i<triangles.length;i+=3)faces.push({tag:geometry.surfaceTags?.[i/3],points:triangles.slice(i,i+3).map(n=>point(vertices,n*3))});
        const linePoint = (p) => wire.push(...p, 0, 0, 1, 0.17, 0.24, 0.28);
        if (showMesh) {
          for (let i = 0; i < triangles.length; i += 3)
            for (const [a, b] of [
              [0, 1],
              [1, 2],
              [2, 0],
            ]) {
              linePoint(point(vertices, triangles[i + a] * 3));
              linePoint(point(vertices, triangles[i + b] * 3));
            }
        } else if(options.onEdgeSelect && geometry.edgeCatalog) {
          edgePick={edges:[],vertices:[],triangles};
          for(let i=0;i<vertices.length;i+=3)edgePick.vertices.push(...point(vertices,i));
          for(const edge of geometry.edgeCatalog){
            const selected=options.selectedEdges?.includes(edge.index),line=[];
            for(let i=0;i<edge.lines.length;i+=3){const p=point(edge.lines,i);line.push(...p);wire.push(...p,0,0,1,...(selected?[1,.7,.27]:[.17,.24,.28]));}
            edgePick.edges.push({index:edge.index,lines:line});
          }
        } else {
          for (let i = 0; i < geometry.edges.length; i += 3)
            linePoint(point(geometry.edges, i));
        }
      }
      upload(filled, wire);
      return;
    }
    const raw = surfaceMesh(size, field || showMesh ? cells : [1, 1, 1]);
    const filled = [],
      wire = [];
    faces = raw.map((face) => {
      const points = face.points.map((p) =>
        p.map((v, i) => (v - size[i] / 2) / radius),
      );
      const base =
        face.axis === axis
          ? face.side
            ? [0.23, 0.65, 0.78]
            : [0.95, 0.58, 0.25]
          : [0.57, 0.64, 0.67];
      const color =
        selected === `${face.axis}:${face.side}` ? [0.95, 0.84, 0.56] : base;
      const colors = face.points.map((p) =>
        field
          ? heatColor(
              (sample(p) - range[0]) / Math.max(range[1] - range[0], 1e-12),
            )
          : color,
      );
      for (const i of [0, 1, 2, 0, 2, 3])
        filled.push(...points[i], ...face.normal, ...colors[i]);
      for (let i = 0; i < 4; i++)
        for (const index of [i, (i + 1) % 4])
          wire.push(
            ...points[index],
            ...face.normal,
            ...(field ? [0.14, 0.2, 0.25] : [0.2, 0.26, 0.29]),
          );
      return { ...face, points };
    });
    upload(filled, wire);
  }
  function upload(filled, wire) {
    gl.bindBuffer(gl.ARRAY_BUFFER, fill);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(filled), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, lines);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wire), gl.STATIC_DRAW);
    fillCount = filled.length / 9;
    lineCount = wire.length / 9;
    draw();
  }
  function pick(clientX, clientY) {
    if(edgePick && current?.onEdgeSelect){
      const rect=canvas.getBoundingClientRect();
      const index=pickVisibleEdge(edgePick.edges,edgePick.vertices,edgePick.triangles,matrix,scale,rect.width,rect.height,[clientX-rect.left,clientY-rect.top]);
      if(index!==null)current.onEdgeSelect(index);return;
    }
    const rect = canvas.getBoundingClientRect(),
      x = ((clientX - rect.left) / rect.width) * 2 - 1,
      y = 1 - ((clientY - rect.top) / rect.height) * 2;
    let hit,
      depth = -Infinity;
    for (const face of faces) {
      const p = face.points.map((v) =>
        [0, 1, 2].map(
          (i) => matrix[i] * v[0] + matrix[3 + i] * v[1] + matrix[6 + i] * v[2],
        ),
      );
      for (const ids of (face.points.length===3?[[0,1,2]]:[[0,1,2],[0,2,3]])) {
        const [a, b, c] = ids.map((i) => [
          p[i][0] * scale[0],
          p[i][1] * scale[1],
          p[i][2],
        ]);
        const den =
          (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(den) < 1e-12) continue;
        const u =
          ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
        const v =
            ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den,
          w = 1 - u - v;
        if (u >= 0 && v >= 0 && w >= 0) {
          const z = u * a[2] + v * b[2] + w * c[2];
          if (z > depth) {
            depth = z;
            hit = face;
          }
        }
      }
    }
    if(hit?.tag!=null&&current?.onSurfaceSelect)current.onSurfaceSelect(hit.tag);
    else if (hit && hit.axis!==undefined) onSelect(hit.axis, hit.side);
  }
  let drag;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    yaw += (e.clientX - drag.x) * 0.008;
    pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag.y) * 0.008));
    drag.x = e.clientX;
    drag.y = e.clientY;
    draw();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (
      drag &&
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4
    )
      pick(e.clientX, e.clientY);
    drag = null;
  });
  for (const event of ["pointercancel", "lostpointercapture"])
    canvas.addEventListener(event, () => {
      drag = null;
    });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.max(0.25, Math.min(5, zoom * Math.exp(-e.deltaY * 0.001)));
      draw();
    },
    { passive: false },
  );
  function reset() {
    yaw = -0.55;
    pitch = 0.43;
    zoom = 1;
    draw();
  }
  canvas.addEventListener("keydown", (e) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "-",
        "0",
      ].includes(e.key)
    )
      return;
    e.preventDefault();
    if (e.key === "ArrowLeft") yaw -= 0.1;
    if (e.key === "ArrowRight") yaw += 0.1;
    if (e.key === "ArrowUp") pitch = Math.max(-1.5, pitch - 0.1);
    if (e.key === "ArrowDown") pitch = Math.min(1.5, pitch + 0.1);
    if (e.key === "+") zoom = Math.min(5, zoom * 1.1);
    if (e.key === "-") zoom = Math.max(0.25, zoom / 1.1);
    if (e.key === "0") reset();
    draw();
  });
  new ResizeObserver(draw).observe(canvas);
  return {
    setModel,
    reset,
    select(axis, side) {
      if (current) setModel({ ...current, selected: `${axis}:${side}` });
    },
  };
}
