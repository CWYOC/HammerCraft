"""Steady isotropic heat conduction on a validated P1 tetrahedral mesh (SI)."""
import math
import numpy as np
from fem_mesh import validate_mesh, prepare_mesh

SOLVER = {'id':'hc-thermal-fem-1','library':'scikit-fem','version':'12.0.2','linearSolver':'SciPy CG','scipy':'1.18.1','element':'TetP1','relativeTolerance':1e-10,'absoluteTolerance':1e-12,'maxIterations':5000}


def scalar(value, low, high, label):
    if type(value) not in (int,float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'Invalid {label}.')
    return value


def validate_request(data):
    if not isinstance(data,dict) or data.get('kind')!='thermal-tetra':raise ValueError('Unsupported thermal compute job.')
    scalar(data.get('conductivity'),1e-6,1e6,'constant isotropic conductivity')
    scalar(data.get('heatGeneration'),-1e12,1e12,'heat generation')
    validate_mesh(data.get('mesh'))
    bcs=data.get('boundaries')
    if not isinstance(bcs,list) or not 1<=len(bcs)<=128:raise ValueError('Assign 1–128 surface conditions.')
    tags={g['tag'] for g in data['mesh']['boundary']};used=set()
    for b in bcs:
        if not isinstance(b,dict) or type(b.get('tag')) is not int or b['tag'] not in tags or b['tag'] in used:raise ValueError('Conditions must reference distinct mesh surfaces.')
        used.add(b['tag'])
        if b.get('type')=='temperature':scalar(b.get('temperature'),0,5000,'prescribed temperature')
        elif b.get('type')=='convection':
            scalar(b.get('ambient'),0,5000,'ambient temperature');scalar(b.get('coefficient'),1e-6,1e8,'convection coefficient')
        else:raise ValueError('Only temperature and convection conditions are supported; all other surfaces are insulated.')
    return data


def solve_thermal(data,status=lambda state:None):
    import skfem, scipy
    if skfem.__version__!=SOLVER['version'] or scipy.__version__!=SOLVER['scipy']:raise ValueError('Install the pinned scikit-fem and SciPy requirements before solving.')
    from skfem import MeshTet, Basis, FacetBasis, ElementTetP1, asm
    from skfem.models.poisson import laplace, mass, unit_load
    from scipy.sparse import diags
    from scipy.sparse.linalg import cg
    data=validate_request(data);raw=data['mesh'];status('Preparing')
    points,cells,volumes,mesh,groups=prepare_mesh(raw)
    basis=Basis(mesh,ElementTetP1());k=data['conductivity'];source=data['heatGeneration']
    A=k*asm(laplace,basis);b=source*asm(unit_load,basis);fixed={};convection=[]
    for bc in data['boundaries']:
        facets=groups[bc['tag']]
        if bc['type']=='temperature':
            for n in basis.get_dofs(facets=facets).all():
                if n in fixed and abs(fixed[n]-bc['temperature'])>1e-8:raise ValueError('Different fixed temperatures meet at shared nodes. Choose non-touching surfaces or equal temperatures.')
                fixed[int(n)]=bc['temperature']
        else:
            fb=FacetBasis(mesh,ElementTetP1(),facets=facets);load=asm(unit_load,fb)
            A=A+bc['coefficient']*asm(mass,fb);b=b+bc['coefficient']*bc['ambient']*load
            convection.append((bc,load))
    # Solve a temperature increment to avoid cancellation of the Kelvin offset.
    reference=float(np.mean([bc.get('temperature',bc.get('ambient')) for bc in data['boundaries']]))
    prescribed=np.array(sorted(fixed),dtype=np.int32);free=np.setdiff1d(np.arange(basis.N),prescribed)
    u=np.zeros(basis.N);u[prescribed]=[fixed[int(i)]-reference for i in prescribed]
    rhs=(b-A@np.full(basis.N,reference)-A@u)[free];reduced=A[free][:,free].tocsr();iterations=0
    status('Solving')
    if free.size:
        diagonal=reduced.diagonal()
        if np.any(diagonal<=0):raise ValueError('The thermal system is not positive definite.')
        def count(_):
            nonlocal iterations
            iterations+=1
        solution,info=cg(reduced,rhs,rtol=SOLVER['relativeTolerance'],atol=SOLVER['absoluteTolerance'],maxiter=SOLVER['maxIterations'],M=diags(1/diagonal),callback=count)
        if info!=0:raise ValueError('Thermal CG did not converge. Refine poor cells or reduce material/boundary contrast.')
        u[free]=solution
    u+=reference;residual=A@u-b
    # Normwise backward error remains meaningful for a zero-load constant field.
    scale=max(float(np.linalg.norm((abs(A)@abs(u)+abs(b))[free])),1e-12)
    relative=float(np.linalg.norm(residual[free]))/scale
    if not np.all(np.isfinite(u)) or np.any(u<0) or np.any(u>1e7) or relative>1e-7:raise ValueError('Nonphysical temperatures or excessive equation residual; no result retained.')
    status('Post-processing')
    gradient=basis.interpolate(u).grad[:,:,0].T;flux=-k*gradient
    generated=source*float(volumes.sum());fixed_out=-float(residual[prescribed].sum())
    conv_out=sum(float(bc['coefficient']*(load@u-bc['ambient']*load.sum())) for bc,load in convection)
    balance=fixed_out+conv_out-generated
    if abs(balance)>1e-7*max(abs(fixed_out),abs(conv_out),abs(generated),1):raise ValueError('Thermal energy balance failed.')
    return {'solver':SOLVER,'temperatures':u.tolist(),'gradients':gradient.flatten().tolist(),'heatFlux':flux.flatten().tolist(),
        'iterations':iterations,'residual':relative,'balance':{'generated':generated,'fixedOutward':fixed_out,'convectionOutward':conv_out,'error':balance},
        'volumeMeanTemperature':float(np.sum(u[cells].mean(axis=1)*volumes)/volumes.sum())}
