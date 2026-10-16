"""Disk-backed STEP preview for files too large for browser strings/WASM memory."""
from pathlib import Path
import math
import hashlib
import tempfile
import os
import numpy as np
MAX_STEP=1_500_000_000


def asset_path(data):
    path=Path(data.get('stepPath',''))
    if not path.is_file() or not 0<path.stat().st_size<=MAX_STEP:
        raise ValueError('The uploaded STEP source is missing or exceeds 1.5 GB. Import it again.')
    return path


def validate_request(data):
    if not isinstance(data,dict) or data.get('kind')!='cad-step':raise ValueError('Unsupported native CAD job.')
    asset_path(data)
    operations=data.get('operations',[])
    if not isinstance(operations,list) or len(operations)>24:raise ValueError('Use at most 24 CAD operations.')
    for op in operations:
        if not isinstance(op,dict) or op.get('type') not in ['step-part','transform','linear-pattern']:raise ValueError('Unsupported native CAD operation.')
        if op['type']=='linear-pattern':
            if type(op.get('count')) is not int or not 2<=op['count']<=20:raise ValueError('A pattern needs 2–20 instances.')
            validate_vector(op.get('spacing'),1e6)
            if math.dist(op['spacing'],[0,0,0])<.001:raise ValueError('Pattern spacing must be at least 1 µm.')
        else:
            validate_vector(op.get('translation'),1e7);validate_vector(op.get('rotation'),36000)
        if op['type']=='step-part':
            asset_path(op)
            if op.get('operation') not in ['add','union','subtract','intersect']:raise ValueError('Unsupported STEP combination.')
    return data


def validate_vector(value,limit):
    if not isinstance(value,list) or len(value)!=3 or any(type(v) not in [int,float] or not math.isfinite(v) or abs(v)>limit for v in value):raise ValueError('Invalid CAD placement or spacing.')


def check_solids(gmsh,solids):
    if not 1<=len(solids)<=64 or any(d!=3 or not math.isfinite(gmsh.model.occ.getMass(d,t)) or gmsh.model.occ.getMass(d,t)<=0 for d,t in solids):raise ValueError('The operation must leave 1–64 closed solid bodies with positive volume.')


def import_solids(gmsh,data):
    before={d:set(gmsh.model.getEntities(d)) for d in range(4)}
    gmsh.model.occ.importShapes(str(asset_path(data)),highestDimOnly=False);gmsh.model.occ.synchronize()
    solids=list(set(gmsh.model.getEntities(3))-before[3]);check_solids(gmsh,solids)
    used=set(solids)
    for dim in [3,2,1]:
        for entity in list(used):
            if entity[0]==dim:used.update((d,abs(t)) for d,t in gmsh.model.getBoundary([entity],combined=False,oriented=False))
    if any(entity not in used for dim in [2,1,0] for entity in set(gmsh.model.getEntities(dim))-before[dim]):raise ValueError('STEP contains loose surfaces, curves or points outside closed solids.')
    return solids


def place(gmsh,solids,op):
    for axis,angle in enumerate(op['rotation']):
        if angle:
            direction=[0,0,0];direction[axis]=1;gmsh.model.occ.rotate(solids,0,0,0,*direction,angle*math.pi/180)
    gmsh.model.occ.translate(solids,*[v/1000 for v in op['translation']])


def store_result(gmsh,folder):
    # The folder derives only from a digest resolved by the Rust service.
    fd,name=tempfile.mkstemp(prefix='cad-',suffix='.step',dir=folder);os.close(fd)
    path=Path(name)
    try:
        gmsh.write(str(path))
        size=path.stat().st_size
        if not 0<size<=MAX_STEP:raise ValueError('The generated STEP exceeds 1.5 GB.')
        digest=hashlib.sha256()
        with path.open('rb') as f:
            for chunk in iter(lambda:f.read(1024*1024),b''):digest.update(chunk)
        sha=digest.hexdigest();path.replace(folder/(sha+'.step'))
        return {'sha256':sha,'bytes':size}
    finally:path.unlink(missing_ok=True)


def preview_step(data,status=lambda state:None):
    import gmsh
    validate_request(data)
    gmsh.initialize(['hc-cad','-nopopup'],readConfigFiles=False)
    try:
        gmsh.option.setNumber('General.Terminal',0)
        gmsh.option.setNumber('General.NumThreads',1)
        gmsh.option.setString('Geometry.OCCTargetUnit','M')
        gmsh.model.add('uploaded-solid')
        status('Preparing')
        solids=import_solids(gmsh,data)
        for op in data.get('operations',[]):
            status('Preparing')
            if op['type']=='step-part':
                tool=import_solids(gmsh,op);place(gmsh,tool,op)
                if op['operation']=='add':solids+=tool
                else:
                    fn={'union':gmsh.model.occ.fuse,'subtract':gmsh.model.occ.cut,'intersect':gmsh.model.occ.intersect}[op['operation']]
                    solids,_=fn(solids,tool)
            elif op['type']=='transform':place(gmsh,solids,op)
            else:
                original=list(solids)
                if len(original)*op['count']>64:raise ValueError('Use at most 64 solid bodies.')
                for i in range(1,op['count']):
                    copies=gmsh.model.occ.copy(original);gmsh.model.occ.translate(copies,*[v*i/1000 for v in op['spacing']]);solids+=copies
            gmsh.model.occ.synchronize()
            check_solids(gmsh,solids)
        gmsh.model.occ.synchronize()
        check_solids(gmsh,solids)
        surfaces=gmsh.model.getBoundary(solids,combined=False,oriented=True)
        volume=sum(gmsh.model.occ.getMass(*solid) for solid in solids)
        boxes=[gmsh.model.getBoundingBox(*solid) for solid in solids]
        bounds=[[min(b[i] for b in boxes) for i in range(3)],[max(b[i+3] for b in boxes) for i in range(3)]]
        size=np.subtract(bounds[1],bounds[0]);span=float(np.linalg.norm(size))
        if min(size)<.999e-6 or max(size)>1000.001 or max(size)/min(size)>10001 or max(abs(v) for p in bounds for v in p)>10000:raise ValueError('CAD bounds exceed the supported dimensions.')
        result_asset=store_result(gmsh,asset_path(data).parent) if data.get('operations') else data.get('stepAsset')
        h=span/35
        for key,value in {'Mesh.MeshSizeMin':h/10,'Mesh.MeshSizeMax':h,'Mesh.MeshSizeFromCurvature':20,'Mesh.MeshSizeFromPoints':0,'Mesh.ElementOrder':1,'Mesh.Algorithm':6,'Mesh.MaxNumThreads1D':1,'Mesh.MaxNumThreads2D':1}.items():gmsh.option.setNumber(key,value)
        status('Meshing');gmsh.model.mesh.generate(2)
        tags,coords,_=gmsh.model.mesh.getNodes();points=np.asarray(coords).reshape((-1,3));lookup={int(t):i for i,t in enumerate(tags)};triangles=[]
        for _,tag in surfaces:
            kinds,_,conn=gmsh.model.mesh.getElements(2,abs(tag))
            if list(kinds)!=[2]:raise ValueError('CAD surface could not be tessellated into triangles.')
            cells=np.asarray([lookup[int(t)] for t in conn[0]],dtype=np.int64).reshape((-1,3))
            if tag<0:cells=cells[:,[0,2,1]]
            triangles.extend(cells.tolist())
            if len(triangles)>150000 or len(points)>200000:raise ValueError('The solid exceeds the preview complexity limit. Simplify the source model.')
        status('Post-processing');triangles=np.asarray(triangles,dtype=np.int64)
        if not len(triangles):raise ValueError('The solid has no displayable surface.')
        p=points[triangles];normal=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]);length=np.linalg.norm(normal,axis=1)
        if np.any(length<=0) or not np.all(np.isfinite(length)):raise ValueError('The solid produced degenerate surface triangles.')
        edges=np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]]);_,counts=np.unique(np.sort(edges,axis=1),axis=0,return_counts=True)
        if np.any(counts!=2):raise ValueError('The STEP surface is not watertight. Repair or sew the faces into one closed solid in the source CAD tool.')
        normals=np.zeros_like(points)
        for a in range(3):np.add.at(normals,triangles[:,a],normal)
        lens=np.linalg.norm(normals,axis=1);normals[lens>0]/=lens[lens>0,None]
        lines=[]
        for _,tag in gmsh.model.getEntities(1):
            kinds,_,conn=gmsh.model.mesh.getElements(1,tag)
            for kind,c in zip(kinds,conn):
                if kind==1:lines.extend((points[[lookup[int(t)] for t in c]]*1000).flatten().tolist())
        return {'kernel':'Open CASCADE / Gmsh '+gmsh.__version__,'volume':volume,'solidCount':len(solids),'operationsApplied':len(data.get('operations',[])),'stepAsset':result_asset,'bounds':bounds,'faceCount':len(surfaces),'triangleCount':len(triangles),'tolerance':h,'constrainedSketches':[],
                'edgeCatalog':[],'edgeCatalogError':'Edge treatments require a browser model. STEP part Booleans, transforms and linear patterns are available for stored sources.',
                'mesh':{'vertices':(points*1000).flatten().tolist(),'normals':normals.flatten().tolist(),'triangles':triangles.flatten().tolist()},'edges':lines}
    finally:gmsh.finalize()
