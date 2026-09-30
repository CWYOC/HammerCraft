// Presentation only. All CAD vertices and dimensions come from the Rust worker.
export function createViewer(canvas) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
    if (!gl)
        throw new Error(
            "This browser does not provide WebGL. Enable hardware acceleration to view the assembly.",
        );
    const shader = (type, source) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(s));
        return s;
    };
    const program = gl.createProgram();
    gl.attachShader(
        program,
        shader(
            gl.VERTEX_SHADER,
            `attribute vec3 point; attribute vec3 normal; uniform mat3 rotation; uniform vec3 scale; varying float light; void main(){ vec3 p=rotation*point; gl_Position=vec4(p*scale,1.0); light=0.42+0.58*abs(dot(normalize(rotation*normal),normalize(vec3(-0.4,0.6,1.0)))); }`,
        ),
    );
    gl.attachShader(
        program,
        shader(
            gl.FRAGMENT_SHADER,
            `precision mediump float; uniform vec4 color; varying float light; void main(){gl_FragColor=vec4(color.rgb*light,color.a);}`,
        ),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error("Unable to initialise 3D renderer.");
    gl.useProgram(program);
    const point = gl.getAttribLocation(program, "point"),
        normal = gl.getAttribLocation(program, "normal");
    const rotation = gl.getUniformLocation(program, "rotation"),
        scale = gl.getUniformLocation(program, "scale"),
        color = gl.getUniformLocation(program, "color");
    let meshes = [],
        yaw = -0.5,
        pitch = 0.35,
        zoom = 1,
        extent = 20,
        selected,
        showShell = true,
        showPaths = true;
    function draw() {
        const rect = canvas.getBoundingClientRect(),
            dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const c = Math.cos(yaw),
            s = Math.sin(yaw),
            cp = Math.cos(pitch),
            sp = Math.sin(pitch);
        // Column-major yaw then pitch, orthographic camera; nearer objects have smaller Z.
        gl.uniformMatrix3fv(
            rotation,
            false,
            new Float32Array([
                c,
                s * sp,
                -s * cp,
                0,
                cp,
                sp,
                s,
                -c * sp,
                c * cp,
            ]),
        );
        const aspect = canvas.width / canvas.height,
            k = (0.78 * zoom) / extent;
        gl.uniform3f(
            scale,
            k / Math.max(aspect, 1),
            k * Math.min(aspect, 1),
            -0.001,
        );
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        for (const m of [
            ...meshes.filter((m) => m.kind !== "shell"),
            ...meshes.filter((m) => m.kind === "shell"),
        ]) {
            if (
                (m.kind === "shell" && !showShell) ||
                (m.kind === "path" && !showPaths)
            )
                continue;
            const isSelected = m.id === selected || m.id === `path:${selected}`;
            const rgba =
                m.kind === "shell"
                    ? [0.72, 0.84, 0.8, 0.16]
                    : m.kind === "path"
                      ? isSelected
                          ? [1, 0.49, 0.19, 1]
                          : [0.7, 0.32, 0.12, 1]
                      : isSelected
                        ? [0.48, 0.76, 0.84, 1]
                        : [0.42, 0.52, 0.56, 1];
            gl.uniform4fv(color, rgba);
            gl.depthMask(m.kind !== "shell");
            if (m.kind === "shell") gl.disable(gl.DEPTH_TEST);
            gl.bindBuffer(gl.ARRAY_BUFFER, m.buffer);
            gl.enableVertexAttribArray(point);
            gl.enableVertexAttribArray(normal);
            gl.vertexAttribPointer(point, 3, gl.FLOAT, false, 24, 0);
            gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
            gl.drawArrays(gl.TRIANGLES, 0, m.count);
        }
        gl.depthMask(true);
    }
    function setParts(parts, selectedId) {
        for (const m of meshes) gl.deleteBuffer(m.buffer);
        extent = 1;
        selected = selectedId;
        meshes = parts.map((p) => {
            const data = [];
            for (const t of p.mesh.triangles) {
                const [a, b, c] = t.map((i) => p.mesh.vertices[i]);
                const u = b.map((v, i) => v - a[i]),
                    v = c.map((v, i) => v - a[i]);
                const n = [
                    u[1] * v[2] - u[2] * v[1],
                    u[2] * v[0] - u[0] * v[2],
                    u[0] * v[1] - u[1] * v[0],
                ];
                const len = Math.hypot(...n) || 1;
                const normal = n.map((x) => x / len);
                for (const point of [a, b, c]) {
                    extent = Math.max(extent, Math.hypot(...point));
                    data.push(...point, ...normal);
                }
            }
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array(data),
                gl.STATIC_DRAW,
            );
            return { id: p.id, kind: p.kind, buffer, count: data.length / 6 };
        });
        draw();
    }
    let drag;
    canvas.addEventListener("pointerdown", (e) => {
        drag = [e.clientX, e.clientY];
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!drag) return;
        yaw += (e.clientX - drag[0]) * 0.008;
        pitch = Math.max(
            -1.5,
            Math.min(1.5, pitch + (e.clientY - drag[1]) * 0.008),
        );
        drag = [e.clientX, e.clientY];
        draw();
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
        canvas.addEventListener(name, () => {
            drag = null;
        });
    canvas.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();
            zoom = Math.max(
                0.2,
                Math.min(8, zoom * Math.exp(-e.deltaY * 0.001)),
            );
            draw();
        },
        { passive: false },
    );
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
        if (e.key === "ArrowUp") pitch -= 0.1;
        if (e.key === "ArrowDown") pitch += 0.1;
        if (e.key === "+") zoom = Math.min(8, zoom * 1.1);
        if (e.key === "-") zoom = Math.max(0.2, zoom / 1.1);
        if (e.key === "0") {
            yaw = -0.5;
            pitch = 0.35;
            zoom = 1;
        }
        draw();
    });
    new ResizeObserver(draw).observe(canvas);
    return {
        setParts,
        select(id) {
            selected = id;
            draw();
        },
        visibility(shell, paths) {
            showShell = shell;
            showPaths = paths;
            draw();
        },
        reset() {
            yaw = -0.5;
            pitch = 0.35;
            zoom = 1;
            draw();
        },
    };
}
