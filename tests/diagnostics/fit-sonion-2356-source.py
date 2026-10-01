"""Reproduce the provisional 2356 source fit (numpy/scipy, offline only).

python tests/diagnostics/fit-sonion-2356-source.py /tmp/2356-fit.json
This optimizes the guide curves, so its residuals are training errors, not
independent validation. Positive circuit elements constrain the source to be
passive. Source parameters are not uniquely identified by magnitude data.
"""
import sys
import json,numpy as np
from scipy.optimize import least_squares
from pathlib import Path
root=Path(__file__).resolve().parents[2]
example=json.loads((root/'tests/fixtures/sonion-2356-design-example.json').read_text())
library=json.loads((root/'tests/fixtures/driver-library.json').read_text())
receiver=next(row for row in library if row['manufacturer']=='Sonion' and row['model']=='2356')
f=np.unique(np.r_[np.geomspace(100,8000,240),2573.253,4885.35]); w=2*np.pi*f; rho=1.2929*273.15/293.15;c=331.3+.606*20+.0124*50

def tube(length,diam):
 r=diam*.0005;z0=rho*c/(np.pi*r*r)/1e8;k=w/c
 ev=np.minimum(np.sqrt(2*1.84e-5/(rho*w))/r,1.5);et=np.minimum(np.sqrt(2*1.84e-5/(rho*w))/.71**.5/r,1.5)
 pc=.5*(ev+.4*et);ic=.5*(ev-.4*et);zc=z0*(1+ic-1j*ic);gl=k*(pc+1j*(1+pc))*length*.001
 a=np.cosh(gl);s=np.sinh(gl);return np.array([[a,zc*s],[s/zc,a]]).transpose(2,0,1)
def eye():return np.tile(np.eye(2,dtype=complex),(len(f),1,1))
def path(position=None):
 m=eye();distance=0;inserted=False
 for t in example['tube_sections_mm']:
  l=t['length'];d=t['diameter'];offset=0 if position is None else position-distance
  if position is not None and not inserted and 0<=offset<=l:
   m=m@tube(offset,d);damper=eye();damper[:,0,1]=1.5;m=m@damper@tube(l-offset,d);inserted=True
  else:m=m@tube(l,d)
  distance+=l
 return m@coupler()
def series(z):
 m=eye();m[:,0,1]=z;return m
def shunt(y):
 m=eye();m[:,1,0]=y;return m
def zc(c):return -1j/(w*c)/1e8
# Gazzola et al., DOI 10.61782/fa.2023.0485, Fig.2/Table2.
# Impedance is normalized to 1e8 SI for numerical conditioning.
def coupler():
 y1=1/(.00422+zc(.7e-12))+1/(.5566+1j*w*9400/1e8+zc(2.34e-12))
 y2=1/(.00422+zc(1.5e-12))+1/(.2799+1j*w*983.8/1e8+zc(2.73e-12))
 return series(1j*w*82.9/1e8)@shunt(y1)@series(1j*w*130.3/1e8)@shunt(y2)@series(1j*w*133.4/1e8)
base=path();damped=path(8.25);reference=tube(4.5,1.4)@tube(11,1.9)@coupler()
zm=.00422+zc(1.517e-12)
# C5/(R5+C5) cancels in these same-coupler transfer ratios.
def h(m,zs):return zm/(m[:,0,0]*zm+m[:,0,1]+zs*(m[:,1,0]*zm+m[:,1,1]))
def interp(data,ff='frequency',dd='db'):return np.interp(np.log(f),np.log([p[ff] for p in data]),[p[dd] for p in data])
und=interp(example['undamped']);damp=interp(example['damped']);target=damp-und
raw=interp(receiver['fr'],'frequency_hz','magnitude_db')

def z(logx):
 x=np.exp(logx);R,M,K=x[:3];zs=R+1j*(M*f/1000-K*1000/f)
 for i in range(3,len(x),3):
  Rp,fp,Q=x[i:i+3];zs+=Rp/(1+1j*Q*(f/fp-fp/f))
 return zs

def residual(logx):
 zs=z(logx);delta=20*np.log10(abs(h(damped,zs)/h(base,zs)))
 undcalc=raw+20*np.log10(abs(h(base,zs)/h(reference,zs)))
 # Joint constraint prevents a damping-only fit from breaking changed tubing.
 return np.r_[delta-target, undcalc-und, undcalc+delta-damp]
rng=np.random.default_rng(49)
for modes in [1]:
 lo=np.log([.0001,.0001,.0001]+[.0001,600,.05]*modes)
 hi=np.log([30,50,500]+[500,7500,100]*modes)
 best=None
 for i in range(12):
  x0=np.log([.2,1,10]+[5,3500,2]*modes)+rng.normal(0,1,len(lo));x0=np.clip(x0,lo+.001,hi-.001)
  result=least_squares(residual,x0,bounds=(lo,hi),max_nfev=1000)
  cost=np.mean(result.fun**2)
  if best is None or cost<best[0]:best=(cost,result.x)
 cost,x=best;zs=z(x);delta=20*np.log10(abs(h(damped,zs)/h(base,zs)));undcalc=raw+20*np.log10(abs(h(base,zs)/h(reference,zs)))
 report={'modes':modes,'parameters':np.exp(x).tolist(),'delta_rms':float(np.sqrt(np.mean((delta-target)**2))),'undamped_rms':float(np.sqrt(np.mean((undcalc-und)**2))),'damped_rms':float(np.sqrt(np.mean((undcalc+delta-damp)**2))),'frequency':f.tolist(),'delta':delta.tolist(),'guide_delta':target.tolist(),'undamped':undcalc.tolist()}
 if len(sys.argv)>1: Path(sys.argv[1]).write_text(json.dumps(report,indent=2)+'\n')
 print({k:v for k,v in report.items() if not isinstance(v,list) or k=='parameters'},flush=True)
