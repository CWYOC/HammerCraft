// Register the handler before loading WebAssembly so the first message is retained.
const kernel = import("./cad-kernel.mjs");
let shape, fingerprint;
self.onmessage = async ({ data: request }) => {
  const { id, action } = request;
  try {
    const {buildSolid, describeSolid, exportSolid} = await kernel;
    if (action === "build") {
      shape?.delete();
      shape = null;
      fingerprint = null;
      shape = await buildSolid(request.source);
      const artifact = describeSolid(shape, request.source);
      fingerprint = artifact.fingerprint;
      self.postMessage({ id, artifact });
    } else if (
      action === "export" &&
      shape &&
      fingerprint === request.fingerprint
    ) {
      const blob = exportSolid(shape, request.format, request.name);
      self.postMessage({ id, blob });
    } else throw Error("Regenerate the current solid before exporting.");
  } catch (error) {
    self.postMessage({
      id,
      error:
        typeof error?.message === "string"
          ? error.message
          : "The CAD kernel could not complete this operation.",
    });
  }
};
