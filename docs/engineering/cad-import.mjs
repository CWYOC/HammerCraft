import { validateSource } from "./project.mjs";
import { validateSTEPText } from "./step-input.mjs";
import { CadClient } from "./cad-client.mjs";

export function stepSource(
  source,
  stepText,
  fileName,
  featureId = globalThis.crypto.randomUUID(),
) {
  const next = structuredClone(validateSource(source).source);
  const base = next.features[0];
  delete next.sketches;
  next.features = [
    {
      id: featureId,
      bodyId: base.bodyId,
      type: "imported-step",
      name: "Imported STEP solid",
      fileName,
      stepText: validateSTEPText(stepText),
      materialId: base.materialId,
    },
  ];
  return validateSource(next).source;
}

// Validate in an independent worker while the current model stays usable.
// The caller's guard covers accepted edits, draft edits and project replacement.
export class CadImport {
  constructor(client = new CadClient()) {
    this.client = client;
    this.active = null;
  }
  cancel() {
    this.active = null;
    this.client.reset();
  }
  async run(source, isCurrent, commit) {
    this.cancel();
    const token = {};
    this.active = token;
    try {
      const candidate = validateSource(source).source;
      const { artifact } = await this.client.request("build", {
        source: candidate,
      });
      if (this.active !== token) throw Error("CAD import cancelled.");
      if (!isCurrent())
        throw Error(
          "The project changed during import. Your newer edits were kept; import the file again.",
        );
      await commit(
        candidate,
        artifact,
        () => this.active === token && isCurrent(),
      );
      return artifact;
    } catch (error) {
      if (this.active !== token) return null;
      throw error;
    } finally {
      if (this.active === token) {
        this.active = null;
        this.client.reset();
      }
    }
  }
}
