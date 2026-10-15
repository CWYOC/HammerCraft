// One operation at a time. A new geometry build terminates obsolete work so that
// a late result can never replace the current geometry or produce a wrong export.
export class CadClient {
  constructor(
    factory = () =>
      new Worker(new URL("./cad-worker.mjs", import.meta.url), {
        type: "module",
      }),
    timeout = 60000,
    label = "CAD",
  ) {
    this.factory = factory;
    this.timeout = timeout;
    this.label = label;
    this.sequence = 0;
  }
  reset() {
    this.worker?.terminate();
    this.worker = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error(`${this.label} operation superseded by a newer model.`));
      this.pending = null;
    }
  }
  request(action, data) {
    if (action === "build") this.reset();
    if (this.pending)
      return Promise.reject(Error(`A ${this.label} operation is already running.`));
    return new Promise((resolve, reject) => {
      try {
        this.worker ||= this.factory();
        const id = ++this.sequence;
        const fail = (message) => {
          if (this.pending?.id !== id) return;
          clearTimeout(this.pending.timer);
          this.pending = null;
          this.worker?.terminate();
          this.worker = null;
          reject(Error(message));
        };
        const timer = setTimeout(
          () =>
            fail(
              `${this.label} operation timed out. Simplify the inputs, adjust dimensions, or retry.`,
            ),
          this.timeout,
        );
        this.pending = { id, resolve, reject, timer };
        this.worker.onmessage = ({ data: reply }) => {
          if (this.pending?.id !== id || reply.id !== id) return;
          if (reply.error) return fail(reply.error);
          clearTimeout(timer);
          this.pending = null;
          resolve(reply);
        };
        this.worker.onerror = () =>
          fail(
            `Unable to run the ${this.label} worker. Reload or retry; check that the local WASM asset is available.`,
          );
        this.worker.onmessageerror = () =>
          fail(`Unable to read the ${this.label} worker response.`);
        this.worker.postMessage({ id, action, ...data });
      } catch (error) {
        if (this.pending) clearTimeout(this.pending.timer);
        this.pending = null;
        this.worker?.terminate();
        this.worker = null;
        reject(error);
      }
    });
  }
}
