// Worker-compatible transport for the optional loopback compute service.
export const COMPUTE_URL='http://127.0.0.1:8766';
export async function computeHealth(fetcher=fetch){
  let response;
  try{response=await fetcher(`${COMPUTE_URL}/health`,{signal:AbortSignal.timeout(4000)});}catch{throw Error('Local mesher is offline. Start the Engineering compute service, then check again.');}
  const data=await response.json();if(!response.ok||data.service!=='hc-engineering-compute'||data.version!==1||data.mesher!=='4.15.2'||!data.capabilities?.includes('gmsh-tetra'))throw Error('The local service does not provide the supported Gmsh 4.15.2 mesher.');return data;
}
export class ComputeWorker {
  constructor(fetcher=fetch,interval=300,timeout=100000){this.timeout=timeout;this.fetcher=(...args)=>fetcher(...args);this.interval=interval;this.stopped=false;this.jobId=null;this.timer=null;this.controller=new AbortController();}
  emit(id,state,detail={}){if(!this.stopped)this.onmessage?.({data:{id,state,...detail}});}
  async postMessage({id,action,options}){
    if(!['volume-mesh','thermal-tetra','structural-tetra','modal-tetra','harmonic-tetra','electric-tetra','cad-step'].includes(action)){this.emit(id,'Failed',{error:'Unsupported local compute action.'});return;}
    try{
      // Keep the bounded queue acknowledgement alive after local cancellation so
      // a late-created remote process can still be explicitly terminated.
      const response=await this.fetcher(`${COMPUTE_URL}/jobs`,{method:'POST',headers:{'Content-Type':'application/json','X-HC-Compute':'1'},body:JSON.stringify(options.request),signal:AbortSignal.timeout(10000)});
      const job=await response.json();if(!response.ok)throw Error(job.error||'Unable to queue the mesh job.');
      if(!/^[a-f0-9-]{36}$/.test(job.id||''))throw Error('Invalid compute job identifier.');
      this.jobId=job.id;
      if(this.stopped){this.cancelRemote();return;}
      const started=Date.now();
      const poll=async()=>{
        if(this.stopped)return;
        try{
          if(Date.now()-started>this.timeout)throw Error('Local computation timed out. Use a coarser mesh and retry.');
          const response=await this.fetcher(`${COMPUTE_URL}/jobs/${this.jobId}`,{headers:{'X-HC-Compute':'1'},signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)])});
          const event=await response.json();if(!response.ok)throw Error(event.error||'Unable to read compute progress.');
          if(event.id!==this.jobId)throw Error('Compute response belongs to another job.');
          if(!['Queued','Preparing','Meshing','Solving','Post-processing','Completed','Failed','Cancelled'].includes(event.state))throw Error('Invalid compute job state.');
          this.emit(id,event.state,{mesh:event.mesh,solution:event.solution,artifact:event.artifact,error:event.error});
          if(!['Completed','Failed','Cancelled'].includes(event.state)&&!this.stopped)this.timer=setTimeout(poll,this.interval);
        }catch(error){if(!this.stopped){this.emit(id,'Failed',{error:error.message});this.cancelRemote();}}
      };
      await poll();
    }catch(error){if(!this.stopped)this.emit(id,'Failed',{error:error instanceof TypeError?'Could not reach the local mesher. Check that the compute service is running.':error.message});}
  }
  cancelRemote(){if(this.jobId)this.fetcher(`${COMPUTE_URL}/jobs/${this.jobId}`,{method:'DELETE',headers:{'X-HC-Compute':'1'},signal:AbortSignal.timeout(5000)}).catch(()=>{});}
  terminate(){this.stopped=true;clearTimeout(this.timer);this.controller.abort();this.cancelRemote();}
}
