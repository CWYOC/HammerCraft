"""Direct complex harmonic elasticity with Rayleigh damping; exp(+i omega t)."""
import numpy as np
from fem_mesh import validate_mesh
from structural_fem import scalar,vector
from elasticity import prepare_elasticity

SOLVER={'id':'hc-harmonic-fem-1','library':'scikit-fem','version':'12.0.2','linearSolver':'SciPy SuperLU','scipy':'1.18.1','element':'VectorTetP1','mass':'consistent','damping':'Rayleigh','phasor':'exp(+i omega t)','amplitudes':'peak'}

def validate_request(data):
    if not isinstance(data,dict) or data.get('kind')!='harmonic-tetra':raise ValueError('Unsupported harmonic job.')
    for key,lo,hi in [('youngModulus',1e3,1e13),('poissonRatio',-.99,.49),('density',1e-9,1e6),('alpha',0,1e8),('beta',0,1e3)]:scalar(data.get(key),lo,hi,key)
    validate_mesh(data.get('mesh'))
    if len(data['mesh']['nodes'])//3>4000 or len(data['mesh']['tetrahedra'])//4>16000:raise ValueError('Direct harmonic studies support at most 4,000 nodes and 16,000 tetrahedra.')
    f=data.get('frequencies')
    if not isinstance(f,list) or not 1<=len(f)<=24:raise ValueError('Use 1–24 harmonic frequencies.')
    for value in f:scalar(value,1e-3,1e7,'frequency')
    if any(a>=b for a,b in zip(f,f[1:])):raise ValueError('Frequencies must increase strictly.')
    tags={g['tag'] for g in data['mesh']['boundary']};used=set();loads=0
    if not isinstance(data.get('boundaries'),list) or not 1<=len(data['boundaries'])<=128:raise ValueError('Assign 1–128 harmonic surface conditions.')
    for b in data['boundaries']:
        if not isinstance(b,dict) or type(b.get('tag')) is not int or b['tag'] not in tags or b['tag'] in used:raise ValueError('Harmonic conditions must reference distinct mesh surfaces.')
        used.add(b['tag']);kind=b.get('type')
        if kind=='fixed':continue
        if kind=='displacement':vector(b.get('values'),0,'harmonic restraint',True);continue
        if kind=='force':vector(b.get('values'),1e12,'harmonic force')
        elif kind=='pressure':scalar(b.get('pressure'),-1e12,1e12,'harmonic pressure')
        else:raise ValueError('Unsupported harmonic condition.')
        scalar(b.get('phase'),-1e6,1e6,'load phase');loads+=1
    if not loads:raise ValueError('Assign at least one harmonic force or pressure.')
    if type(data.get('responseTag')) is not int or data['responseTag'] not in tags:raise ValueError('Select a response surface.')
    if type(data.get('responseAxis')) is not int or data['responseAxis'] not in (0,1,2):raise ValueError('Select a response axis.')
    return data

def harmonic_system(data):
    from skfem import BilinearForm,LinearForm,FacetBasis,asm
    from skfem.helpers import dot
    points,cells,volumes,mesh,groups,basis,nodal,fixed,D,origin,span,rank,lam,mu,K=prepare_elasticity(data)
    @BilinearForm
    def mass(u,v,w):return data['density']*dot(u,v)
    M=asm(mass,basis);F=np.zeros(basis.N,dtype=complex)
    for bc in data['boundaries']:
        if bc['type'] not in ('force','pressure'):continue
        fb=FacetBasis(mesh,basis.elem,facets=groups[bc['tag']])
        if bc['type']=='force':
            traction=np.array(bc['values'])/float(fb.dx.sum())
            @LinearForm
            def load(v,w):return dot(traction[:,None,None],v)
        else:
            pressure=bc['pressure']
            @LinearForm
            def load(v,w):return -pressure*dot(w.n,v)
        F+=asm(load,fb)*np.exp(1j*bc['phase'])
    response=FacetBasis(mesh,basis.elem,facets=groups[data['responseTag']]);area=float(response.dx.sum());weights=[]
    for axis in range(3):
        @LinearForm
        def average(v,w):return v[axis]/area
        weights.append(asm(average,response))
    return points,basis,nodal,D,K,M,F,np.array(weights),float(volumes.sum()*data['density'])

def solve_harmonic(data,status=lambda state:None):
    import skfem,scipy
    if skfem.__version__!=SOLVER['version'] or scipy.__version__!=SOLVER['scipy']:raise ValueError('Install the pinned scikit-fem and SciPy requirements.')
    from scipy.sparse.linalg import splu
    data=validate_request(data);status('Preparing');points,basis,nodal,D,K,M,F,weights,total_mass=harmonic_system(data)
    free=np.setdiff1d(np.arange(basis.N),D)
    if not len(free):raise ValueError('No free displacement DOFs remain.')
    if np.linalg.norm(F[free])==0:raise ValueError('The harmonic load does not act on a free displacement DOF.')
    C=data['alpha']*M+data['beta']*K;responses=[];status('Solving')
    for frequency in data['frequencies']:
        omega=2*np.pi*frequency;A=((1+1j*omega*data['beta'])*K+(-omega**2+1j*omega*data['alpha'])*M).tocsc();u=np.zeros(basis.N,dtype=complex)
        try:u[free]=splu(A[free][:,free]).solve(F[free])
        except RuntimeError as error:raise ValueError('Singular dynamic stiffness. Move off an undamped resonance or specify physical damping.') from error
        residual=A@u-F
        error=float(np.linalg.norm(residual[free]))/max(float(np.linalg.norm((abs(A)@abs(u)+abs(F))[free])),1e-30)
        if not np.all(np.isfinite(u)) or error>1e-8:raise ValueError('Nonfinite harmonic response or excessive equation residual.')
        reaction=np.zeros(basis.N,dtype=complex);reaction[D]=residual[D]
        inertia=-omega**2*(M@u);damping=1j*omega*(C@u)
        totals={key:values[nodal].T.sum(axis=0) for key,values in [('force',F),('reaction',reaction),('inertia',inertia),('damping',damping)]}
        scale=max(1e-12,*[float(np.linalg.norm(values)) for values in totals.values()])
        if np.linalg.norm(totals['force']+totals['reaction']-totals['inertia']-totals['damping'])>1e-6*scale:raise ValueError('Harmonic force balance failed.')
        input_power=float(np.real(np.vdot(F,1j*omega*u))*.5);loss=float(np.real(np.vdot(u,C@u))*.5*omega**2)
        if loss<-1e-10 or abs(input_power-loss)>1e-9+1e-6*max(abs(input_power),abs(loss)):raise ValueError('Harmonic average power balance failed.')
        mean=weights@u
        result={'frequency':frequency,'real':u[nodal].T.real.flatten().tolist(),'imag':u[nodal].T.imag.flatten().tolist(),'residual':error,'meanReal':mean.real.tolist(),'meanImag':mean.imag.tolist(),'inputPower':input_power,'dissipatedPower':max(0,loss),'strainEnergy':float(np.real(np.vdot(u,K@u))*.25),'kineticEnergy':float(np.real(np.vdot(u,M@u))*.25*omega**2)}
        for key,value in totals.items():result[key+'Real']=value.real.tolist();result[key+'Imag']=value.imag.tolist()
        responses.append(result)
    status('Post-processing');return {'solver':SOLVER,'responses':responses,'totalMass':total_mass,'freeDofs':len(free)}
