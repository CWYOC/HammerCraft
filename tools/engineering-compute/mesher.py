"""Isolated Gmsh job. All geometry and mesh coordinates are SI metres."""
import hashlib
import json
import math
from pathlib import Path
import sys

MAX_NODES = 50000
MAX_TETS = 100000
MAX_STEP = 8 * 1024 * 1024


def validate_request(data):
    if not isinstance(data, dict) or data.get('kind') != 'gmsh-tetra':
        raise ValueError('Unsupported compute job.')
    step = data.get('step')
    if data.get('stepPath'):
        from cad_step import asset_path
        asset_path(data)
        step = None
    if not data.get('stepPath') and (not isinstance(step, str) or len(step.encode('utf-8')) > MAX_STEP or not step.lstrip('\ufeff \r\n\t').startswith('ISO-10303-21;') or not step.rstrip().endswith('END-ISO-10303-21;')):
        raise ValueError('Provide a complete text STEP solid, at most 8 MiB.')
    if any(ord(c) < 32 and c not in '\r\n\t' for c in (step or '')):
        raise ValueError('STEP contains unsupported control characters.')
    settings = data.get('settings', {})
    if not isinstance(settings, dict):
        raise ValueError('Mesh settings must be an object.')
    for key in ('minSize', 'maxSize'):
        value = settings.get(key)
        if type(value) not in (float, int) or not math.isfinite(value) or not 1e-6 <= value <= 1000:
            raise ValueError('Element sizes must be 1 micrometre–1000 metres.')
    if settings['minSize'] > settings['maxSize']:
        raise ValueError('Minimum size must not exceed maximum size.')
    if type(settings.get('curvature')) is not int or not 0 <= settings['curvature'] <= 64:
        raise ValueError('Curvature resolution must be an integer from 0 to 64.')
    expected = data.get('expectedVolume')
    if type(expected) not in (float, int) or not math.isfinite(expected) or expected <= 0:
        raise ValueError('A positive CAD volume is required.')
    if expected / settings['maxSize']**3 * 6 > MAX_TETS:
        raise ValueError('Requested size is too small for the 100,000-tetrahedron limit. Increase maximum size.')
    return data


def mesh_step(data, status=lambda state: None):
    import gmsh
    import numpy as np
    import tempfile
    data = validate_request(data)
    settings = data['settings']
    with tempfile.TemporaryDirectory(prefix='hc-gmsh-') as folder:
        path = Path(folder) / 'solid.step'
        if data.get('stepPath'):
            from cad_step import asset_path
            path=asset_path(data)
        else:path.write_text(data['step'], encoding='utf-8')
        gmsh.initialize(['hc-mesher', '-nopopup'], readConfigFiles=False)
        try:
            gmsh.option.setNumber('General.Terminal', 0)
            gmsh.option.setNumber('General.NumThreads', 1)
            gmsh.option.setNumber('Mesh.MaxNumThreads1D', 1)
            gmsh.option.setNumber('Mesh.MaxNumThreads2D', 1)
            gmsh.option.setNumber('Mesh.MaxNumThreads3D', 1)
            gmsh.option.setNumber('Mesh.RandomSeed', 1)
            gmsh.option.setString('Geometry.OCCTargetUnit', 'M')
            gmsh.model.add('engineering-solid')
            status('Preparing')
            gmsh.model.occ.importShapes(str(path), highestDimOnly=False)
            gmsh.model.occ.synchronize()
            solids = gmsh.model.getEntities(3)
            if len(solids) != 1:
                raise ValueError('Volume meshing requires exactly one CAD solid.')
            solid = solids[0]
            surfaces = gmsh.model.getBoundary([solid], combined=False, oriented=False)
            if {tag for _, tag in surfaces} != {tag for _, tag in gmsh.model.getEntities(2)}:
                raise ValueError('STEP contains loose surfaces outside its solid.')
            volume = gmsh.model.occ.getMass(*solid)
            if not math.isfinite(volume) or abs(volume / data['expectedVolume'] - 1) > 1e-5:
                raise ValueError('Transferred STEP volume differs from the CAD snapshot; check units and regenerate.')
            bounds = [list(gmsh.model.getBoundingBox(*solid)[:3]), list(gmsh.model.getBoundingBox(*solid)[3:])]
            if any(b-a < 1e-6 or b-a > 1000 for a,b in zip(*bounds)) or any(abs(x)>10000 for row in bounds for x in row):
                raise ValueError('CAD bounds exceed supported dimensions.')
            for name, value in {'Mesh.MeshSizeMin':settings['minSize'], 'Mesh.MeshSizeMax':settings['maxSize'],
                'Mesh.MeshSizeFromCurvature':settings['curvature'], 'Mesh.Algorithm':6, 'Mesh.Algorithm3D':1,
                'Mesh.ElementOrder':1, 'Mesh.Optimize':1, 'Mesh.MeshSizeFromPoints':0, 'Mesh.MeshSizeExtendFromBoundary':1}.items():
                gmsh.option.setNumber(name, value)
            status('Meshing')
            gmsh.model.mesh.generate(3)
            status('Post-processing')
            tags, coords, _ = gmsh.model.mesh.getNodes()
            types, element_tags, connectivity = gmsh.model.mesh.getElements(3, solid[1])
            if list(types) != [4] or not len(element_tags[0]):
                raise ValueError('Mesher did not produce first-order tetrahedra.')
            if len(tags) > MAX_NODES or len(element_tags[0]) > MAX_TETS:
                raise ValueError('Mesh exceeds 50,000 nodes or 100,000 tetrahedra. Increase element sizes.')
            points = np.asarray(coords).reshape((-1,3))
            lookup = {int(tag):i for i,tag in enumerate(tags)}
            cells = np.array([lookup[int(tag)] for tag in connectivity[0]], dtype=np.int64).reshape((-1,4))
            p = points[cells]
            determinant = np.einsum('ij,ij->i',p[:,1]-p[:,0],np.cross(p[:,2]-p[:,0],p[:,3]-p[:,0]))
            if not np.all(np.isfinite(determinant)) or np.any(determinant == 0):
                raise ValueError('Mesher produced zero-volume or nonfinite elements.')
            negative = determinant < 0
            cells[negative, 0], cells[negative, 1] = cells[negative, 1].copy(), cells[negative, 0].copy()
            mesh_volume = float(np.sum(np.abs(determinant))/6)
            if abs(mesh_volume / volume - 1) > .05:
                raise ValueError('Mesh volume differs from CAD by over 5%. Refine the surface/curvature resolution.')
            boundary = []
            for _,tag in sorted(surfaces):
                kinds, _, surface_nodes = gmsh.model.mesh.getElements(2,tag)
                if list(kinds) != [2]:
                    raise ValueError('Boundary mesh is not first-order triangles.')
                boundary.append({'tag':int(tag),'type':gmsh.model.getType(2,tag),
                    'area':gmsh.model.occ.getMass(2,tag),'center':list(gmsh.model.occ.getCenterOfMass(2,tag)),
                    'triangles':[lookup[int(i)] for i in surface_nodes[0]]})
            return {'nodes':points.flatten().tolist(),'tetrahedra':cells.flatten().tolist(),'boundary':boundary,
                'cadVolume':volume,'stepSha256':data['stepAsset']['sha256'] if data.get('stepPath') else hashlib.sha256(data['step'].encode()).hexdigest(),
                'mesher':{'id':'gmsh-tetra-1','version':gmsh.__version__,'algorithm':'Delaunay','order':1,'threads':1}}
        finally:
            gmsh.finalize()


def main():
    request_path, result_path, status_path = map(Path,sys.argv[1:4])
    def status(state):
        pending=status_path.with_suffix('.tmp');pending.write_text(json.dumps({'state':state}));pending.replace(status_path)
    try:
        status('Preparing')
        output=mesh_step(json.loads(request_path.read_text()),status)
        result_path.write_text(json.dumps(output,allow_nan=False,separators=(',',':')))
        status('Completed')
    except Exception as error:
        status('Failed')
        result_path.write_text(json.dumps({'error':str(error)[:2000]}))
        sys.exit(1)

if __name__=='__main__':
    main()
