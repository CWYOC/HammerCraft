import {localAction} from './physics-registry.mjs';
import { ComputeWorker } from './compute-client.mjs';
// Browser and local-service adapters share the same immutable job messages.
export class JobManager {
  constructor(
    onUpdate,
    workerFactory = (action) => localAction(action) ? new ComputeWorker() :
      new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" }),
  ) {
    this.onUpdate = onUpdate;
    this.workerFactory = workerFactory;
    this.active = null;
  }
  start(action, project, options = {}) {
    if (this.active)
      throw Error(
        "A job is already running. Cancel it or wait for completion.",
      );
    const id = crypto.randomUUID();
    const worker = this.workerFactory(action);
    this.active = { id, worker, projectId: project.id, action };
    const finish = (event) => {
      if (this.active?.id !== id) return;
      if (["Completed", "Failed", "Cancelled"].includes(event.state)) {
        worker.terminate();
        this.active = null;
      }
      this.onUpdate({ ...event, id, action });
    };
    worker.onmessage = ({ data }) => {
      if (data.id === id) finish(data);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      finish({
        state: "Failed",
        error: event.message || "The compute worker could not start.",
      });
    };
    worker.onmessageerror = () =>
      finish({ state: "Failed", error: "Unable to read worker response." });
    this.onUpdate({ id, action, state: "Queued" });
    try {
      worker.postMessage({
        id,
        action,
        project: structuredClone({ ...project, results: [], versions: [], sweeps: [], convergenceChecks: [], measurements: [], volumeMeshes: [], femResults: [], structuralResults: [], modalResults: [], harmonicResults: [], electricResults: [] }),
        options: structuredClone(options),
      });
    } catch (error) {
      finish({ state: "Failed", error: error.message });
    }
    return id;
  }
  cancel() {
    if (!this.active) return;
    const { id, worker, action } = this.active;
    worker.terminate();
    this.active = null;
    this.onUpdate({ id, action, state: "Cancelled" });
  }
}
