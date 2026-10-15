"""Shared vector-P1 elastic space, stiffness and geometric restraints."""
import numpy as np
from fem_mesh import prepare_mesh

def prepare_elasticity(data):
    from skfem import Basis,ElementTetP1,ElementVector,asm
    from skfem.models.elasticity import linear_elasticity,lame_parameters
    points,cells,volumes,mesh,groups=prepare_mesh(data['mesh']);element=ElementVector(ElementTetP1())
    basis=Basis(mesh,element);nodal=basis.nodal_dofs;fixed={}
    for bc in data['boundaries']:
        if bc['type'] not in ('fixed','displacement'):continue
        values=[0,0,0] if bc['type']=='fixed' else bc['values']
        nodes=np.unique(mesh.facets[:,groups[bc['tag']]])
        for axis,value in enumerate(values):
            if value is None:continue
            for dof in nodal[axis,nodes]:
                if dof in fixed and abs(fixed[dof]-value)>1e-12:raise ValueError('Conflicting prescribed displacements meet at shared nodes.')
                fixed[int(dof)]=value
    D=np.array(sorted(fixed),dtype=np.int32)
    # Every connected solid needs six independent rigid-body restraints.
    origin=np.mean(points,axis=0);span=float(np.linalg.norm(np.ptp(points,axis=0)));relative=(points-origin)/span
    rigid=np.zeros((basis.N,6))
    for axis in range(3):rigid[nodal[axis],axis]=1
    for rotation in range(3):rigid[nodal.T,rotation+3]=np.cross(np.eye(3)[rotation],relative)
    rank=int(np.linalg.matrix_rank(rigid[D],tol=1e-10)) if len(D) else 0
    lam,mu=lame_parameters(data['youngModulus'],data['poissonRatio'])
    A=asm(linear_elasticity(lam,mu),basis)
    return points,cells,volumes,mesh,groups,basis,nodal,fixed,D,origin,span,rank,lam,mu,A
