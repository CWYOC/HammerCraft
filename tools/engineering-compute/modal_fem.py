"""Undamped, unprestressed natural modes of one isotropic elastic solid."""
import numpy as np
from fem_mesh import validate_mesh
from structural_fem import scalar,vector
from elasticity import prepare_elasticity

SOLVER={'id':'hc-modal-fem-1','library':'scikit-fem','version':'12.0.2','eigensolver':'SciPy eigsh','scipy':'1.18.1','element':'VectorTetP1','mass':'consistent','relativeTolerance':1e-9,'maxIterations':10000,'normalization':'peak-node-magnitude'}

def validate_request(data):
    if not isinstance(data,dict) or data.get('kind')!='modal-tetra':raise ValueError('Unsupported eigenfrequency job.')
    scalar(data.get('youngModulus'),1e3,1e13,'Young modulus')
    scalar(data.get('poissonRatio'),-.99,.49,'Poisson ratio')
    scalar(data.get('density'),1e-9,1e6,'constant density')
    if type(data.get('modeCount')) is not int or not 1<=data['modeCount']<=12:raise ValueError('Request 1–12 modes, including rigid-body modes.')
    validate_mesh(data.get('mesh'))
    if len(data['mesh']['nodes'])//3>10000 or len(data['mesh']['tetrahedra'])//4>40000:raise ValueError('Eigenfrequency studies support at most 10,000 nodes and 40,000 tetrahedra.')
    boundaries=data.get('boundaries');tags={g['tag'] for g in data['mesh']['boundary']};used=set()
    if not isinstance(boundaries,list) or len(boundaries)>128:raise ValueError('Use at most 128 modal restraint surfaces.')
    for b in boundaries:
        if not isinstance(b,dict) or type(b.get('tag')) is not int or b['tag'] not in tags or b['tag'] in used:raise ValueError('Restraints must reference distinct mesh surfaces.')
        used.add(b['tag'])
        if b.get('type')=='fixed':continue
        if b.get('type')!='displacement':raise ValueError('Unprestressed modes accept fixed or zero-component displacement restraints only.')
        vector(b.get('values'),0,'modal displacement',True)
    return data

def solve_modal(data,status=lambda state:None):
    import skfem,scipy
    if skfem.__version__!=SOLVER['version'] or scipy.__version__!=SOLVER['scipy']:raise ValueError('Install the pinned scikit-fem and SciPy requirements.')
    from skfem import BilinearForm,asm
    from skfem.helpers import dot
    from scipy.sparse.linalg import eigsh,ArpackNoConvergence
    data=validate_request(data);status('Preparing')
    points,cells,volumes,mesh,groups,basis,nodal,fixed,D,origin,span,rank,lam,mu,K=prepare_elasticity(data)
    @BilinearForm
    def mass(u,v,w):return data['density']*dot(u,v)
    M=asm(mass,basis);free=np.setdiff1d(np.arange(basis.N),D);count=data['modeCount']
    if count>=len(free):raise ValueError('Requested modes must be fewer than the unconstrained displacement DOFs.')
    A=K[free][:,free].tocsc();B=M[free][:,free].tocsc();characteristic=data['youngModulus']/data['density']/span**2
    # A negative shift makes free-body rigid modes nonsingular without adding stiffness.
    shift=-1e-6*characteristic;status('Solving')
    try:
        eigenvalues,eigenvectors=eigsh(A,k=count,M=B,sigma=shift,which='LM',tol=1e-9,maxiter=10000,v0=np.random.default_rng(1729).normal(size=len(free)))
    except ArpackNoConvergence as error:raise ValueError('The requested eigenmodes did not converge; no partial mode set was retained.') from error
    order=np.argsort(eigenvalues);eigenvalues=eigenvalues[order];eigenvectors=eigenvectors[:,order]
    rigid=6-rank;total_mass=float(data['density']*volumes.sum());modes=[];mass_vectors=[];status('Post-processing')
    influence=np.zeros((basis.N,3))
    for a in range(3):influence[nodal[a],a]=1
    applied_mass=M@influence
    for i,value in enumerate(eigenvalues):
        if value<-1e-6*characteristic:raise ValueError('Negative elastic eigenvalue; verify material and mesh.')
        is_rigid=i<rigid
        if is_rigid and abs(value)>1e-6*characteristic:raise ValueError('Expected rigid-body modes were not resolved accurately.')
        if not is_rigid and value<=0:raise ValueError('A positive elastic eigenvalue was not resolved.')
        lam_eig=0.0 if is_rigid else float(value)
        phi=np.zeros(basis.N);phi[free]=eigenvectors[:,i]
        phi/=np.linalg.norm(phi[nodal].T,axis=1).max()
        if phi[np.argmax(abs(phi))]<0:phi=-phi
        kphi=K@phi;mphi=M@phi
        residual=float(np.linalg.norm((kphi-lam_eig*mphi)[free]))/max(float(np.linalg.norm((abs(K)@abs(phi)+lam_eig*(abs(M)@abs(phi)))[free])),1e-30)
        if residual>1e-8:raise ValueError('Excessive eigenmode equation backward error.')
        modal_mass=float(phi@mphi)
        gradient=basis.interpolate(phi).grad[:,:,:,0].transpose(2,0,1);strain=(gradient+gradient.transpose(0,2,1))/2
        stress=2*mu*strain+lam*np.trace(strain,axis1=1,axis2=2)[:,None,None]*np.eye(3)[None,:,:]
        stiffness=float(np.sum(stress*strain,axis=(1,2))@volumes)
        if not is_rigid and abs(stiffness/modal_mass/lam_eig-1)>1e-6:raise ValueError('Eigenvalue differs from the independently integrated Rayleigh quotient.')
        participation=(phi@applied_mass)/modal_mass;effective=participation**2*modal_mass
        modes.append({'eigenvalue':lam_eig,'frequency':float(np.sqrt(lam_eig)/(2*np.pi)),'rigid':is_rigid,'shape':phi[nodal].T.flatten().tolist(),'modalMass':modal_mass,'modalStiffness':stiffness,'participation':participation.tolist(),'effectiveMass':effective.tolist(),'residual':residual})
        mass_vectors.append(phi/np.sqrt(modal_mass))
    Q=np.array(mass_vectors).T;orthogonality=float(np.max(abs(Q.T@(M@Q)-np.eye(count))))
    if orthogonality>1e-6:raise ValueError('Eigenmodes failed mass orthogonality.')
    return {'solver':SOLVER,'modes':modes,'totalMass':total_mass,'rigidModes':rigid,'freeDofs':len(free),'shift':shift,'orthogonality':orthogonality}
