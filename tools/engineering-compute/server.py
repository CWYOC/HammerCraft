"""Loopback-only, bounded compute service; one isolated numerical process per job."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from importlib.metadata import version
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlparse
import uuid
from runner import validate_request, module

MAX_BYTES=10*1024*1024
JOB_TIMEOUT=90
RETENTION=600

class Jobs:
    def __init__(self):
        self.records={};self.lock=threading.RLock()
    def collect(self):
        with self.lock:
            for key,job in list(self.records.items()):
                if job['process'].poll() is None and time.monotonic()-job['started']>JOB_TIMEOUT:
                    job['process'].kill();job['process'].wait();job['terminal']='Failed';job['error']='Computation exceeded 90 seconds. Use a coarser mesh or simplify the study.'
                if job['process'].poll() is not None and time.monotonic()-job['started']>RETENTION:
                    shutil.rmtree(job['folder'],ignore_errors=True);del self.records[key]
    def start(self,data):
        if isinstance(data,dict) and ("stepPath" in data or "stepAsset" in data or data.get("kind")=="cad-step"):raise ValueError("Stored STEP assets require the Rust service.")
        validate_request(data)
        with self.lock:
            self.collect()
            if any(j['process'].poll() is None for j in self.records.values()):
                raise RuntimeError('A compute job is already running. Cancel it or wait.')
            # Bounded retention even if many tiny jobs are submitted.
            while len(self.records)>=6:
                key=next(iter(self.records));shutil.rmtree(self.records.pop(key)['folder'],ignore_errors=True)
            key=str(uuid.uuid4());folder=Path(tempfile.mkdtemp(prefix='hc-compute-'))
            (folder/'request.json').write_text(json.dumps(data))
            command=[sys.executable,str(Path(__file__).with_name('runner.py')),str(folder/'request.json'),str(folder/'result.json'),str(folder/'status.json')]
            env={**os.environ,'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MKL_NUM_THREADS':'1','VECLIB_MAXIMUM_THREADS':'1'}
            process=subprocess.Popen(command,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            self.records[key]={'folder':folder,'process':process,'started':time.monotonic(),'resultKey':module(data)[2]}
            return {'id':key,'state':'Queued'}
    def read(self,key):
        with self.lock:
            self.collect();job=self.records.get(key)
            if not job:raise KeyError('Job not found or expired.')
            code=job['process'].poll();result=job['folder']/'result.json'
            if job.get('terminal'):return {'id':key,'state':job['terminal'],'error':job.get('error')}
            if code is not None:
                if not result.exists():return {'id':key,'state':'Failed','error':'The compute process stopped before producing a result.'}
                if result.stat().st_size>32*1024*1024:return {'id':key,'state':'Failed','error':'Compute output exceeds 32 MiB.'}
                data=json.loads(result.read_text())
                return {'id':key,'state':'Failed','error':data['error']} if 'error' in data else {'id':key,'state':'Completed',job['resultKey']:data}
            status=job['folder']/'status.json'
            progress=json.loads(status.read_text()) if status.exists() else {'state':'Queued'}
            if progress['state'] in ('Completed','Failed'):progress={'state':'Post-processing'}
            return {'id':key,**progress}
    def cancel(self,key):
        with self.lock:
            job=self.records.get(key)
            if not job:raise KeyError('Job not found or expired.')
            if job['process'].poll() is None:job['process'].terminate();job['process'].wait(timeout=5)
            job['terminal']='Cancelled'
            shutil.rmtree(job['folder'],ignore_errors=True)
            return {'id':key,'state':'Cancelled'}
    def close(self):
        with self.lock:
            for key in list(self.records):self.cancel(key)
            self.records.clear()


def make_server(port=8766,origins=('http://127.0.0.1:8765','http://localhost:8765')):
    jobs=Jobs()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def allowed(self):
            host=self.headers.get('Host','')
            return host in {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'} and (not self.headers.get('Origin') or self.headers['Origin'] in origins)
        def send(self,status,data):
            payload=json.dumps(data,allow_nan=False,separators=(',',':')).encode()
            self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)))
            self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
            if self.headers.get('Origin') in origins:
                self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Vary','Origin')
            self.end_headers();self.wfile.write(payload)
        def do_OPTIONS(self):
            if not self.allowed():return self.send(403,{'error':'Origin or Host is not permitted.'})
            self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers.get('Origin',''))
            self.send_header('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type, X-HC-Compute');self.end_headers()
        def dispatch(self):
            if not self.allowed():return self.send(403,{'error':'Origin or Host is not permitted.'})
            route=urlparse(self.path).path
            try:
                if self.command=='GET' and route=='/health':
                    import gmsh
                    return self.send(200,{'service':'hc-engineering-compute','version':1,'mesher':gmsh.__version__,'capabilities':['gmsh-tetra','thermal-tetra','structural-tetra','modal-tetra','harmonic-tetra'],'thermalSolver':{'scikit-fem':version('scikit-fem'),'scipy':version('scipy')},'maxTetrahedra':100000})
                if self.headers.get('X-HC-Compute')!='1':return self.send(403,{'error':'Compute API header is required.'})
                if self.command=='POST' and route=='/jobs':
                    if self.headers.get('Content-Type')!='application/json':return self.send(415,{'error':'Use application/json.'})
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0<length<=MAX_BYTES:return self.send(413,{'error':'Request exceeds the 10 MiB limit.'})
                    self.connection.settimeout(10)
                    return self.send(202,jobs.start(json.loads(self.rfile.read(length))))
                if route.startswith('/jobs/'):
                    key=route.removeprefix('/jobs/')
                    if self.command=='GET':return self.send(200,jobs.read(key))
                    if self.command=='DELETE':return self.send(200,jobs.cancel(key))
                self.send(404,{'error':'Endpoint not found.'})
            except KeyError as error:self.send(404,{'error':str(error)})
            except RuntimeError as error:self.send(409,{'error':str(error)})
            except (ValueError,TypeError,TimeoutError) as error:self.send(400,{'error':str(error)[:2000]})
            except Exception:self.send(500,{'error':'Compute service could not complete this request.'})
        do_GET=dispatch
        do_POST=dispatch
        do_DELETE=dispatch
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler);server.jobs=jobs
    return server

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8766);parser.add_argument('--origin',action='append',default=[]);args=parser.parse_args()
    server=make_server(args.port,tuple(args.origin) or ('http://127.0.0.1:8765','http://localhost:8765'))
    # A watchdog enforces timeout even when clients close without cancelling.
    stopped=threading.Event()
    def watch():
        while not stopped.wait(1):server.jobs.collect()
    threading.Thread(target=watch,daemon=True).start()
    print(f'Engineering compute: http://127.0.0.1:{server.server_port}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:stopped.set();server.jobs.close();server.server_close()
