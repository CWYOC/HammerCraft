import contextlib
import copy
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import time
import unittest
import gmsh
import numpy as np
from mesher import mesh_step,validate_request
from server import Jobs


def fixture(kind='box',unit='MM'):
    with tempfile.TemporaryDirectory() as folder:
        gmsh.initialize(['fixture','-nopopup'],readConfigFiles=False)
        try:
            gmsh.option.setNumber('General.Terminal',0)
            gmsh.option.setString('Geometry.OCCTargetUnit',unit)
            scale=1 if unit=='MM' else .001
            box=gmsh.model.occ.addBox(0,0,0,60*scale,20*scale,10*scale)
            if kind=='hole':
                tool=gmsh.model.occ.addCylinder(30*scale,10*scale,0,0,0,10*scale,4*scale)
                gmsh.model.occ.cut([(3,box)],[(3,tool)])
            if kind=='multiple':gmsh.model.occ.addBox(100*scale,0,0,10*scale,10*scale,10*scale)
            if kind=='loose':gmsh.model.occ.addRectangle(100*scale,0,0,10*scale,10*scale)
            gmsh.model.occ.synchronize();path=Path(folder)/'fixture.step';gmsh.write(str(path));step=path.read_text()
        finally:gmsh.finalize()
    volume=(12000-(math.pi*16*10 if kind=='hole' else 0))*1e-9
    return {'kind':'gmsh-tetra','step':step,'settings':{'minSize':.001,'maxSize':.004,'curvature':20},'expectedVolume':volume}


def mesh_volume(mesh):
    p=np.array(mesh['nodes']).reshape((-1,3))[np.array(mesh['tetrahedra']).reshape((-1,4))]
    v=np.einsum('ij,ij->i',p[:,1]-p[:,0],np.cross(p[:,2]-p[:,0],p[:,3]-p[:,0]))/6
    return v

class ComputeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.box=fixture();cls.hole=fixture('hole')
    def test_box_volume_and_boundary(self):
        mesh=mesh_step(self.box);volumes=mesh_volume(mesh)
        self.assertTrue(np.all(volumes>0));self.assertAlmostEqual(float(volumes.sum()),.000012,places=15)
        self.assertEqual(len(mesh['boundary']),6);self.assertEqual(mesh['mesher']['version'],'4.15.2')
        points=np.array(mesh['nodes']).reshape((-1,3));np.testing.assert_allclose(points.max(axis=0),[.06,.02,.01],atol=1e-12)
    def test_curved_hole_is_meshed_as_a_hole(self):
        mesh=mesh_step(self.hole);self.assertEqual(len(mesh['boundary']),7)
        volume=float(mesh_volume(mesh).sum());self.assertLess(abs(volume/self.hole['expectedVolume']-1),.005)
        p=np.array(mesh['nodes']).reshape((-1,3));centers=p[np.array(mesh['tetrahedra']).reshape((-1,4))].mean(axis=1)
        self.assertTrue(np.all(np.linalg.norm(centers[:,:2]-[.03,.01],axis=1)>.0039))
    def test_refining_increases_elements_and_preserves_exact_box_volume(self):
        coarse=copy.deepcopy(self.box);coarse['settings']['maxSize']=.008
        a=mesh_step(coarse);b=mesh_step(self.box);self.assertGreater(len(b['tetrahedra']),len(a['tetrahedra']))
        self.assertAlmostEqual(float(mesh_volume(a).sum()),float(mesh_volume(b).sum()),places=15)
    def test_repeatable_single_thread_mesh(self):
        self.assertEqual(mesh_step(self.box),mesh_step(self.box))
    def test_step_metres_and_millimetres_transfer_to_SI(self):
        metres=mesh_step(fixture(unit='M'));self.assertAlmostEqual(metres['cadVolume'],.000012,places=15)
        self.assertAlmostEqual(float(mesh_volume(metres).sum()),.000012,places=15)
    def test_bad_units_multiple_solids_and_loose_surfaces_fail(self):
        wrong=copy.deepcopy(self.box);wrong['expectedVolume']=.000024
        with self.assertRaisesRegex(ValueError,'differs'):mesh_step(wrong)
        for kind in ('multiple','loose'):
            with self.assertRaises(ValueError):mesh_step(fixture(kind))
    def test_limits_and_malformed_requests_fail_before_meshing(self):
        for edits in ({'minSize':0},{'maxSize':1e-6},{'curvature':65},{'minSize':.1},{'maxSize':float('nan')}):
            bad=copy.deepcopy(self.box);bad['settings'].update(edits)
            with self.assertRaises(ValueError):validate_request(bad)
        for data in ({},[],{'kind':'gmsh-tetra','step':'garbage'},dict(self.box,settings=[])):
            with self.assertRaises(ValueError):validate_request(data)
    def test_process_cancellation_and_single_job_limit(self):
        jobs=Jobs()
        try:
            record=jobs.start(self.box);job=jobs.records[record['id']]
            self.assertIsNone(job['process'].poll())
            with self.assertRaises(RuntimeError):jobs.start(self.box)
            self.assertEqual(jobs.cancel(record['id'])['state'],'Cancelled');self.assertIsNotNone(job['process'].poll())
            self.assertFalse(job['folder'].exists());self.assertEqual(jobs.read(record['id'])['state'],'Cancelled')
        finally:jobs.close()
    def test_timeout_kills_process_and_retains_diagnostic(self):
        jobs=Jobs()
        try:
            record=jobs.start(self.box);job=jobs.records[record['id']];job['started']-=91;jobs.collect()
            self.assertIsNotNone(job['process'].poll());self.assertEqual(jobs.read(record['id'])['state'],'Failed')
            self.assertIn('90 seconds',jobs.read(record['id'])['error'])
        finally:jobs.close()

if __name__=='__main__':
    if len(sys.argv)>2 and sys.argv[1]=='--fixture-file':
        request=fixture();mesh=mesh_step(request);Path(sys.argv[2]).write_text(json.dumps({'request':request,'mesh':mesh}))
    else:unittest.main()
