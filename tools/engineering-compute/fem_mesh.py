"""Shared input and topology checks for tetrahedral field solvers."""
import math
import numpy as np


def validate_mesh(mesh):
    if not isinstance(mesh,dict):raise ValueError('A tetrahedral mesh is required.')
    for key,width,limit in [('nodes',3,50000),('tetrahedra',4,100000)]:
        a=mesh.get(key)
        if not isinstance(a,list) or not width <= len(a) <= width*limit or len(a)%width:raise ValueError(f'Invalid mesh {key} count.')
        if any(type(n) not in (int,float) or not math.isfinite(n) for n in a):raise ValueError(f'Invalid mesh {key}.')
    cells=mesh['tetrahedra'];count=len(mesh['nodes'])//3
    if any(type(i) is not int or i<0 or i>=count for i in cells):raise ValueError('Invalid tetrahedral connectivity.')
    if max(abs(n) for n in mesh['nodes'])>10000:raise ValueError('Mesh bounds exceed supported dimensions.')
    if not isinstance(mesh.get('boundary'),list) or not 1<=len(mesh['boundary'])<=2048:raise ValueError('Invalid mesh boundary groups.')
    tags=set()
    for g in mesh['boundary']:
        if not isinstance(g,dict) or type(g.get('tag')) is not int or g['tag']<1 or g['tag'] in tags:raise ValueError('Invalid or repeated surface group.')
        tags.add(g['tag']);ids=g.get('triangles')
        if not isinstance(ids,list) or not ids or len(ids)%3 or len(ids)>600000 or any(type(n) is not int or n<0 or n>=count for n in ids):raise ValueError('Invalid boundary triangles.')
    return mesh


def prepare_mesh(raw):
    from skfem import MeshTet
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    validate_mesh(raw)
    points=np.array(raw['nodes']).reshape((-1,3));cells=np.array(raw['tetrahedra'],dtype=np.int32).reshape((-1,4))
    p=points[cells];volumes=np.einsum('ij,ij->i',p[:,1]-p[:,0],np.cross(p[:,2]-p[:,0],p[:,3]-p[:,0]))/6
    if np.any(volumes<=0) or not np.all(np.isfinite(volumes)):raise ValueError('Tetrahedra must have finite positive volume.')
    if len(np.unique(np.sort(cells,axis=1),axis=0))!=len(cells) or len(np.unique(cells))!=len(points):raise ValueError('Duplicate tetrahedra or unused nodes.')
    mesh=MeshTet(points.T,cells.T,sort_t=False)
    allfaces=np.sort(cells[:,np.array([[1,2,3],[0,3,2],[0,1,3],[0,2,1]])].reshape((-1,3)),axis=1)
    _,counts=np.unique(allfaces,axis=0,return_counts=True)
    if np.any(counts>2):raise ValueError('Nonmanifold tetrahedral faces.')
    interior=mesh.f2t[:,mesh.f2t[1]>=0]
    graph=coo_matrix((np.ones(interior.shape[1]*2),(np.r_[interior[0],interior[1]],np.r_[interior[1],interior[0]])),shape=(len(cells),len(cells)))
    if connected_components(graph,directed=False,return_labels=False)!=1:raise ValueError('Mesh must be one connected solid.')
    exterior={tuple(sorted(mesh.facets[:,i])):int(i) for i in mesh.boundary_facets()};seen=set();groups={}
    for g in raw['boundary']:
        facets=[]
        for face in np.array(g['triangles']).reshape((-1,3)):
            key=tuple(sorted(face))
            if key not in exterior or key in seen:raise ValueError('Surface groups must cover each exterior face exactly once.')
            seen.add(key);facets.append(exterior[key])
        groups[g['tag']]=np.array(facets,dtype=np.int32)
    if len(seen)!=len(exterior):raise ValueError('Missing exterior boundary triangles.')
    return points,cells,volumes,mesh,groups
