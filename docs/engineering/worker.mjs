// Install the listener synchronously; module imports initialize Rust WebAssembly.
const modules=Promise.all([import("./project.mjs"),import("./thermal.mjs"),import("./sweep.mjs"),import("./convergence.mjs")]);
self.onmessage = async ({ data }) => {
  const { id, action } = data;
  const send = (state, detail = {}) =>
    self.postMessage({ id, state, ...detail });
  try {
    send("Preparing");
    const [{validateProject},{meshInfo,solveThermal,makeResult},{runSweep},{runConvergence}]=await modules;
    const project = validateProject(data.project);
    if (action === "convergence") {
      const convergence = runConvergence(project, data.options?.convergence, id, (detail) => send("Refining", detail));
      send("Completed", { convergence });
      return;
    }
    if (action === "sweep") {
      const sweep = runSweep(project, data.options?.sweep, id, (detail) => send("Sweeping", detail));
      send("Completed", { sweep });
      return;
    }
    send("Meshing");
    const mesh = meshInfo(project.source);
    if (action === "mesh") {
      send("Completed", { mesh, fingerprint: JSON.stringify(project.source) });
      return;
    }
    if (action !== "solve") throw Error("Unsupported job action.");
    send("Solving", { cells: mesh.count });
    const solution = solveThermal(project.source, (detail) =>
      send("Solving", detail),
    );
    send("Post-processing");
    const result = makeResult(project, solution, id);
    send("Completed", { result, mesh });
  } catch (error) {
    send("Failed", { error: error.message || String(error) });
  }
};
