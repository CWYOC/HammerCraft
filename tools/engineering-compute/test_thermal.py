import copy
import unittest
import numpy as np
from mesher import mesh_step
from test_compute import fixture
from thermal_fem import solve_thermal

class ThermalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.mesh=mesh_step(fixture())
    def request(self,mesh=None):
        m=mesh or self.mesh
        ends=sorted(m['boundary'],key=lambda g:g['center'][0])
        return {'kind':'thermal-tetra','mesh':m,'conductivity':167,'heatGeneration':0,'boundaries':[
            {'tag':ends[0]['tag'],'type':'temperature','temperature':353.15},
            {'tag':ends[-1]['tag'],'type':'temperature','temperature':293.15}]}
    def test_linear_patch_and_flux(self):
        r=solve_thermal(self.request());p=np.array(self.mesh['nodes']).reshape((-1,3))
        np.testing.assert_allclose(r['temperatures'],353.15-1000*p[:,0],atol=1e-7)
        np.testing.assert_allclose(np.array(r['heatFlux']).reshape((-1,3)),np.tile([167000,0,0],(len(self.mesh['tetrahedra'])//4,1)),atol=.01)
        self.assertAlmostEqual(r['volumeMeanTemperature'],323.15,places=7);self.assertLess(abs(r['balance']['error']),1e-8)
    def test_convection_series_resistance(self):
        q=self.request();q['boundaries'][1]={'tag':q['boundaries'][1]['tag'],'type':'convection','ambient':293.15,'coefficient':100}
        r=solve_thermal(q);p=np.array(self.mesh['nodes']).reshape((-1,3));flux=60/(.06/167+1/100)
        np.testing.assert_allclose(r['temperatures'],353.15-flux*p[:,0]/167,atol=1e-7)
        self.assertAlmostEqual(r['balance']['convectionOutward'],flux*.02*.01,places=7)
    def test_all_robin_and_generation(self):
        q=self.request();q['heatGeneration']=1e6;q['boundaries']=[{'tag':g['tag'],'type':'convection','ambient':293.15,'coefficient':100} for g in self.mesh['boundary']]
        r=solve_thermal(q);self.assertGreater(min(r['temperatures']),293.15);self.assertAlmostEqual(r['balance']['generated'],12,places=9)
        self.assertAlmostEqual(r['balance']['convectionOutward'],12,places=7)
    def test_generation_converges_to_parabola(self):
        errors=[]
        for size in [.01,.004]:
            f=fixture();f['settings']['maxSize']=size;m=mesh_step(f);q=self.request(m);q['heatGeneration']=1e7
            r=solve_thermal(q);p=np.array(m['nodes']).reshape((-1,3));exact=353.15-1000*p[:,0]+1e7/(2*167)*p[:,0]*(.06-p[:,0])
            errors.append(float(np.sqrt(np.mean((r['temperatures']-exact)**2))))
        self.assertLess(errors[1],errors[0]*.5);self.assertLess(errors[1],.1)
    def test_hole_constant_solution(self):
        m=mesh_step(fixture('hole'));q=self.request(m);q['boundaries']=[{'tag':g['tag'],'type':'temperature','temperature':300} for g in m['boundary']]
        r=solve_thermal(q);np.testing.assert_allclose(r['temperatures'],300,atol=1e-8);np.testing.assert_allclose(r['heatFlux'],0,atol=1e-6)
    def test_drilled_solid_converges_toward_axial_conduction(self):
        # Curved walls become planar triangles whose normals are not exactly radial.
        # Surface refinement should reduce the geometric error against the cylinder solution.
        errors=[]
        for curvature in [12,24]:
            f=fixture('hole');f['settings']['curvature']=curvature;m=mesh_step(f);q=self.request(m);ends=sorted(m['boundary'],key=lambda g:g['center'][2]);q['boundaries']=[{'tag':ends[0]['tag'],'type':'temperature','temperature':350},{'tag':ends[-1]['tag'],'type':'temperature','temperature':300}]
            r=solve_thermal(q);p=np.array(m['nodes']).reshape((-1,3));error=np.array(r['temperatures'])-(350-5000*p[:,2]);errors.append(float(np.sqrt(np.mean(error**2))))
            self.assertLess(float(np.max(abs(error))),.05)
            self.assertLess(float(np.max(abs(np.array(r['heatFlux']).reshape((-1,3))-[0,0,835000])))/835000,.01)
        self.assertLess(errors[1],errors[0]*.5)
    def test_invalid_conditions_and_mesh_fail(self):
        for edit in [lambda q:q.update(conductivity=0),lambda q:q.update(boundaries=[]),lambda q:q['boundaries'][0].update(tag=999),lambda q:q['boundaries'][0].update(type='radiation'),lambda q:q['mesh']['boundary'][0]['triangles'].pop()]:
            q=copy.deepcopy(self.request());edit(q)
            with self.assertRaises(ValueError):solve_thermal(q)
        q=self.request();q['boundaries'][1]['tag']=next(g['tag'] for g in self.mesh['boundary'] if g['center'][1]<1e-10)
        with self.assertRaisesRegex(ValueError,'shared nodes'):solve_thermal(q)

if __name__=='__main__':unittest.main()
