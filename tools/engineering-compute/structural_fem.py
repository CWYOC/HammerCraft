"""Small-strain, isotropic static elasticity using scikit-fem TetP1 elements."""
import numpy as np
from fem_mesh import validate_mesh,prepare_mesh
from thermal_fem import scalar

SOLVER={'id':'hc-structural-fem-1','library':'scikit-fem','version':'12.0.2','linearSolver':'SciPy CG','scipy':'1.18.1','element':'VectorTetP1','relativeTolerance':1e-10,'absoluteTolerance':1e-12,'maxIterations':10000}


def vector(value,limit,label,partial=False):
    if not isinstance(value,list) or len(value)!=3:raise ValueError(f'Provide three components for {label}.')
    for n in value:
        if n is None and partial:continue
        scalar(n,-limit,limit,label)
    if partial and all(n is None for n in value):raise ValueError('Prescribe at least one displacement component.')
    return value


def validate_request(data):
    if not isinstance(data,dict) or data.get('kind')!='structural-tetra':raise ValueError('Unsupported structural compute job.')
    scalar(data.get('youngModulus'),1e3,1e13,'Young modulus (1 kPa–10 TPa)')
    scalar(data.get('poissonRatio'),-.99,.49,'Poisson ratio (-0.99–0.49)')
    scalar(data.get('density'),1e-9,1e6,'constant density')
    if data.get('yieldStrength') is not None:scalar(data['yieldStrength'],1e-9,1e15,'yield strength')
    vector(data.get('gravity'),1e6,'gravity acceleration')
    validate_mesh(data.get('mesh'));tags={g['tag'] for g in data['mesh']['boundary']}
    bcs=data.get('boundaries')
    if not isinstance(bcs,list) or not 1<=len(bcs)<=128:raise ValueError('Assign 1–128 structural surface conditions.')
    used=set()
    for b in bcs:
        if not isinstance(b,dict) or type(b.get('tag')) is not int or b['tag'] not in tags or b['tag'] in used:raise ValueError('Conditions must reference distinct mesh surfaces.')
        used.add(b['tag']);kind=b.get('type')
        if kind=='fixed':continue
        if kind=='displacement':vector(b.get('values'),1000,'prescribed displacement',True)
        elif kind=='force':vector(b.get('values'),1e12,'surface resultant force')
        elif kind=='pressure':scalar(b.get('pressure'),-1e12,1e12,'surface pressure')
        else:raise ValueError('Unsupported structural boundary condition.')
    return data


def solve_structural(data,status=lambda state:None):
    import skfem,scipy
    if skfem.__version__!=SOLVER['version'] or scipy.__version__!=SOLVER['scipy']:raise ValueError('Install the pinned scikit-fem and SciPy requirements.')
    from skfem import Basis,FacetBasis,ElementTetP1,ElementVector,LinearForm,asm
    from skfem.models.elasticity import linear_elasticity,lame_parameters
    from skfem.helpers import dot
    from scipy.sparse import diags
    from scipy.sparse.linalg import cg
    data=validate_request(data);status('Preparing')
    from elasticity import prepare_elasticity
    points,cells,volumes,mesh,groups,basis,nodal,fixed,D,origin,span,rank,lam,mu,A=prepare_elasticity(data)
    element=basis.elem
    if rank<6:raise ValueError('The solid is under-constrained: remove all six rigid-body motions using fixed or prescribed displacement surfaces.')
    @LinearForm
    def body(v,w):return dot(np.array(data['gravity'])[:,None,None]*data['density'],v)
    b=asm(body,basis)
    for bc in data['boundaries']:
        if bc['type'] not in ('force','pressure'):continue
        fb=FacetBasis(mesh,element,facets=groups[bc['tag']])
        if bc['type']=='force':
            traction=np.array(bc['values'])/float(fb.dx.sum())
            @LinearForm
            def load(v,w):return dot(traction[:,None,None],v)
        else:
            pressure=bc['pressure']
            @LinearForm
            def load(v,w):return -pressure*dot(w.n,v)
        b+=asm(load,fb)
    u=np.zeros(basis.N);u[D]=[fixed[int(i)] for i in D];free=np.setdiff1d(np.arange(basis.N),D)
    rhs=(b-A@u)[free];reduced=A[free][:,free].tocsr();iterations=0;status('Solving')
    if len(free):
        diag=reduced.diagonal()
        if np.any(diag<=0):raise ValueError('The structural system is not positive definite.')
        def count(_):
            nonlocal iterations
            iterations+=1
        solved,info=cg(reduced,rhs,M=diags(1/diag),rtol=1e-10,atol=1e-12,maxiter=10000,callback=count)
        if info!=0:raise ValueError('Structural CG did not converge. Improve restraints or mesh quality; no result was retained.')
        u[free]=solved
    residual=A@u-b
    relative_error=float(np.linalg.norm(residual[free]))/max(float(np.linalg.norm((abs(A)@abs(u)+abs(b))[free])),1e-12)
    if not np.all(np.isfinite(u)) or relative_error>1e-7:raise ValueError('Nonfinite displacement or excessive equation residual.')
    status('Post-processing');gradient=basis.interpolate(u).grad[:,:,:,0].transpose(2,0,1)
    strain=(gradient+gradient.transpose(0,2,1))/2
    stress=2*mu*strain+lam*np.trace(strain,axis1=1,axis2=2)[:,None,None]*np.eye(3)[None,:,:]
    principal=np.linalg.eigvalsh(stress)[:,::-1]
    deviator=stress-np.trace(stress,axis1=1,axis2=2)[:,None,None]*np.eye(3)[None,:,:]/3
    vm=np.sqrt(1.5*np.sum(deviator**2,axis=(1,2)))
    reaction=np.zeros(basis.N);reaction[D]=residual[D]
    applied=b[nodal].T;reactions=reaction[nodal].T;displacement=u[nodal].T
    force_a=applied.sum(axis=0);force_r=reactions.sum(axis=0);moment_a=np.cross(points-origin,applied).sum(axis=0);moment_r=np.cross(points-origin,reactions).sum(axis=0)
    scale=max(float(np.linalg.norm(applied,axis=1).sum()),float(np.linalg.norm(reactions,axis=1).sum()),1e-9)
    if np.linalg.norm(force_a+force_r)>1e-6*scale or np.linalg.norm(moment_a+moment_r)>1e-6*scale*span:raise ValueError('Structural force or moment balance failed.')
    energy=float(.5*np.sum(stress*strain,axis=(1,2))@volumes)
    if not np.isfinite(energy) or energy<0:raise ValueError('Invalid strain energy.')
    # Tensor shear strains, not engineering shear; explicit documented component order.
    packed=lambda a:a[:,[0,1,2,0,1,0],[0,1,2,1,2,2]].flatten().tolist()
    return {'solver':SOLVER,'displacements':displacement.flatten().tolist(),'reactions':reactions.flatten().tolist(),
        'strains':packed(strain),'stresses':packed(stress),'principal':principal.flatten().tolist(),'vonMises':vm.tolist(),
        'strainEnergy':energy,'iterations':iterations,'residual':relative_error,
        'balance':{'origin':origin.tolist(),'appliedForce':force_a.tolist(),'reactionForce':force_r.tolist(),'appliedMoment':moment_a.tolist(),'reactionMoment':moment_r.tolist()},
        'maxStrain':float(np.max(abs(np.linalg.eigvalsh(strain)))),'maxDisplacementRatio':float(np.linalg.norm(displacement,axis=1).max())/span}
