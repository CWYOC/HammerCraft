import copy
import unittest
import numpy as np
from mesher import mesh_step
from test_compute import fixture
from structural_fem import solve_structural

class StructuralTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.mesh=mesh_step(fixture())
    def surface(self,axis,side,mesh=None):
        groups=(mesh or self.mesh)['boundary'];return (max if side else min)(groups,key=lambda g:g['center'][axis])['tag']
    def request(self,mesh=None):
        m=mesh or self.mesh
        return {'kind':'structural-tetra','mesh':m,'youngModulus':70e9,'poissonRatio':.3,'density':2700,'yieldStrength':250e6,'gravity':[0,0,0],
            'boundaries':[{'tag':self.surface(i,0,m),'type':'displacement','values':[0 if i==j else None for j in range(3)]} for i in range(3)]+[{'tag':self.surface(0,1,m),'type':'force','values':[100,0,0]}]}
    def test_uniaxial_patch_displacement_stress_poisson_reactions_energy(self):
        q=self.request();r=solve_structural(q);p=np.array(self.mesh['nodes']).reshape((-1,3));stress=100/(.02*.01);strain=stress/70e9
        np.testing.assert_allclose(np.array(r['displacements']).reshape((-1,3)),p*[strain,-.3*strain,-.3*strain],atol=1e-13)
        np.testing.assert_allclose(np.array(r['stresses']).reshape((-1,6)),np.tile([stress,0,0,0,0,0],(len(r['vonMises']),1)),atol=.05)
        np.testing.assert_allclose(r['vonMises'],stress,atol=.05);np.testing.assert_allclose(r['balance']['reactionForce'],[-100,0,0],atol=1e-7)
        self.assertAlmostEqual(r['strainEnergy'],100**2*.06/(2*70e9*.02*.01),places=10)
    def test_pressure_sign_and_uniform_distribution(self):
        q=self.request();q['boundaries'][-1]={'tag':self.surface(0,1),'type':'pressure','pressure':500000};r=solve_structural(q)
        np.testing.assert_allclose(r['balance']['appliedForce'],[-100,0,0],atol=1e-8)
        np.testing.assert_allclose(np.array(r['stresses']).reshape((-1,6))[:,0],-500000,atol=.05)
    def test_gravity_load_and_moment_balance(self):
        q=self.request();q['boundaries']=[{'tag':self.surface(0,0),'type':'fixed'}];q['gravity']=[0,0,-9.81];r=solve_structural(q)
        np.testing.assert_allclose(r['balance']['appliedForce'],[0,0,-2700*9.81*.000012],atol=1e-10)
        np.testing.assert_allclose(np.array(r['balance']['reactionForce'])+r['balance']['appliedForce'],0,atol=1e-8)
        np.testing.assert_allclose(np.array(r['balance']['reactionMoment'])+r['balance']['appliedMoment'],0,atol=1e-10)
        self.assertGreater(r['strainEnergy'],0)
    def test_prescribed_extension_and_stress_principals(self):
        q=self.request();q['boundaries'][-1]={'tag':self.surface(0,1),'type':'displacement','values':[1e-6,None,None]};r=solve_structural(q)
        np.testing.assert_allclose(np.array(r['principal']).reshape((-1,3))[:,0],70e9*1e-6/.06,atol=.1)
        self.assertGreater(r['strainEnergy'],0);np.testing.assert_allclose(r['balance']['reactionForce'],0,atol=1e-7)
    def test_zero_load_returns_zero_fields(self):
        q=self.request();q['boundaries']=[{'tag':self.surface(0,0),'type':'fixed'}];r=solve_structural(q)
        self.assertTrue(all(v==0 for v in r['displacements']+r['stresses']+r['vonMises']));self.assertEqual(r['strainEnergy'],0)
    def test_cantilever_refinement_approaches_beam_deflection(self):
        request=fixture();deflections=[]
        for size in [.008,.004,.002]:
            request['settings']['maxSize']=size;mesh=mesh_step(request);q=self.request(mesh)
            q['boundaries']=[{'tag':self.surface(0,0,mesh),'type':'fixed'},{'tag':self.surface(0,1,mesh),'type':'force','values':[0,0,-10]}]
            r=solve_structural(q)
            # Uniform end traction: 2U/F is the work-conjugate mean tip deflection.
            deflections.append(2*r['strainEnergy']/10)
            np.testing.assert_allclose(r['balance']['reactionForce'],[0,0,10],atol=1e-6)
        # Beam bending + shear is an approximation, not an exact 3D clamped-solid solution.
        reference=10*.06**3/(3*70e9*(.02*.01**3/12))+10*.06/((5/6)*(70e9/2.6)*.02*.01)
        self.assertTrue(deflections[0]<deflections[1]<deflections[2]<reference)
        self.assertLess(abs(deflections[2]/reference-1),.16)
        self.assertGreater(abs(deflections[0]/reference-1),.5)
    def test_rigid_motion_and_conflicting_constraints_fail(self):
        q=self.request();q['boundaries']=[q['boundaries'][0],q['boundaries'][-1]]
        with self.assertRaisesRegex(ValueError,'under-constrained'):solve_structural(q)
        q=self.request();q['boundaries']=[{'tag':self.surface(0,0),'type':'fixed'},{'tag':self.surface(1,0),'type':'displacement','values':[1e-3,None,None]}]
        with self.assertRaisesRegex(ValueError,'Conflicting'):solve_structural(q)
    def test_material_and_input_limits_fail(self):
        for change in [{'youngModulus':0},{'poissonRatio':.5},{'gravity':[1,2]},{'density':-1},{'yieldStrength':-1}]:
            q=self.request();q.update(change)
            with self.assertRaises(ValueError):solve_structural(q)

if __name__=='__main__':unittest.main()
