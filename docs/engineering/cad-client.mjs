import {usesNativeCAD} from './part-features.mjs';
import {cadDefinition,cadFingerprint,pruneSketches} from './cad-model.mjs';
import {uploadSTEP} from './native-cad.mjs';
import {NativeCadClient} from "./native-cad.mjs";
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
    this.native = new NativeCadClient();
    this.nativeActive = false;
  }
  reset() {
    this.preparing?.reset(); this.preparing=null;
    this.prepareController?.abort(); this.prepareController=null;
    this.native?.reset();
    this.nativeActive = false;
    this.worker?.terminate();
    this.worker = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error(`${this.label} operation superseded by a newer model.`));
      this.pending = null;
    }
  }
  async prepareNative(source) {
    const controller=new AbortController();this.prepareController=controller;
    const index=source.features.findIndex(f=>!f.suppressed&&f.stepAsset);
    let stepAsset=source.features[0].stepAsset;
    const definition=cadDefinition(source);
    let steps=definition.steps||[];
    if(index>0){
      const prefix=structuredClone(source);prefix.features=prefix.features.slice(0,index);pruneSketches(prefix);
      const client=new CadClient(this.factory,this.timeout,this.label);this.preparing=client;
      try {
        await client.request('build',{source:prefix});
        const {blob}=await client.request('export',{format:'step',fingerprint:cadFingerprint(prefix),name:'Assembly base'});
        stepAsset=await uploadSTEP(blob,controller.signal);
      }finally{client.reset();if(this.preparing===client)this.preparing=null;}
      const first=source.features[index].id;steps=steps.slice(steps.findIndex(s=>s.id===first));
    }
    if(controller.signal.aborted)throw Error('CAD operation superseded by a newer model.');
    return this.native.request('build',{source,stepAsset,steps});
  }
  request(action, data) {
    if (action === "build") {
      this.reset();
      this.nativeActive = usesNativeCAD(data.source);
      if(this.nativeActive)return this.prepareNative(data.source);
    }
    if(this.nativeActive)return this.native.request(action,data);
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
