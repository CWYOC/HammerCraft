import copy
import unittest
import numpy as np
from test_compute import fixture
from mesher import mesh_step
from modal_fem import solve_modal,validate_request

class ModalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.geometry=fixture();cls.geometry['settings']['maxSize']=.008;cls.mesh=mesh_step(cls.geometry)
    def request(self,mesh=None):
        m=mesh or self.mesh;tag=min(m['boundary'],key=lambda g:g['center'][0])['tag']
        return {'kind':'modal-tetra','mesh':m,'youngModulus':70e9,'poissonRatio':.3,'density':2700,'modeCount':8,'boundaries':[{'tag':tag,'type':'fixed'}]}
    def test_sparse_frequencies_match_independent_dense_eigensolve(self):
        from elasticity import prepare_elasticity
        from scipy.linalg import eigh
        q=self.request();r=solve_modal(q)
        points,cells,volumes,mesh,groups,basis,nodal,fixed,D,*rest=prepare_elasticity(q);K=rest[-1]
        # Independently assemble the exact P1 consistent mass matrix from cells.
        M=np.zeros(K.shape)
        for ids,V in zip(cells,volumes):
            for a in range(4):
                for b in range(4):
                    for axis in range(3):M[nodal[axis,ids[a]],nodal[axis,ids[b]]]+=2700*V/20*(2 if a==b else 1)
        free=np.setdiff1d(np.arange(basis.N),D);reference=eigh(K.toarray()[np.ix_(free,free)],M[np.ix_(free,free)],subset_by_index=[0,7])[0]
        np.testing.assert_allclose([m['eigenvalue'] for m in r['modes']],reference,rtol=1e-9)
        self.assertEqual(r['rigidModes'],0);self.assertLess(r['orthogonality'],1e-10)
        for m in r['modes']:
            self.assertAlmostEqual(np.linalg.norm(np.array(m['shape']).reshape((-1,3)),axis=1).max(),1)
            self.assertLess(m['residual'],1e-8)
    def test_frequency_scales_with_stiffness_and_density(self):
        q=self.request();base=np.array([m['frequency'] for m in solve_modal(q)['modes']]);q['youngModulus']*=4
        np.testing.assert_allclose([m['frequency'] for m in solve_modal(q)['modes']],base*2,rtol=1e-8)
        q['density']*=4;np.testing.assert_allclose([m['frequency'] for m in solve_modal(q)['modes']],base,rtol=1e-8)
    def test_free_body_has_six_rigid_modes_and_translational_mass_completeness(self):
        q=self.request();q['boundaries']=[];r=solve_modal(q);self.assertEqual(r['rigidModes'],6)
        self.assertEqual([m['frequency'] for m in r['modes'][:6]],[0]*6);self.assertGreater(r['modes'][6]['frequency'],0)
        np.testing.assert_allclose(np.array([m['effectiveMass'] for m in r['modes'][:6]]).sum(axis=0),r['totalMass'],rtol=1e-8)
    def test_partial_roller_preserves_expected_rigid_motions(self):
        q=self.request();q['boundaries'][0].update(type='displacement',values=[0,None,None]);r=solve_modal(q)
        self.assertEqual(r['rigidModes'],3);self.assertEqual(sum(m['rigid'] for m in r['modes']),3)
    def test_axial_frequency_refines_toward_continuum_bar(self):
        frequencies=[]
        for h in [.008,.004]:
            geometry=copy.deepcopy(self.geometry);geometry['settings']['maxSize']=h;m=mesh_step(geometry);q=self.request(m);q['poissonRatio']=0;q['modeCount']=1
            x_min=q['boundaries'][0]['tag'];q['boundaries']=[{'tag':g['tag'],'type':'displacement','values':[0 if g['tag']==x_min else None,0,0]} for g in m['boundary']]
            frequencies.append(solve_modal(q)['modes'][0]['frequency'])
        exact=np.sqrt(70e9/2700)/(4*.06)
        self.assertGreater(frequencies[0],frequencies[1]);self.assertGreater(frequencies[1],exact);self.assertLess(frequencies[1]/exact-1,.005)
    def test_bad_material_load_modes_and_limits_rejected(self):
        for change in [{'density':0},{'poissonRatio':.5},{'modeCount':0},{'modeCount':13},{'boundaries':[{'tag':self.mesh['boundary'][0]['tag'],'type':'force','values':[1,0,0]}]},{'boundaries':[{'tag':self.mesh['boundary'][0]['tag'],'type':'displacement','values':[1e-9,None,None]}]}]:
            q=self.request();q.update(change)
            with self.assertRaises(ValueError):validate_request(q)
        # Mesh caps reject before allocation, even if a caller supplies large arrays.
        q=self.request();q['mesh']=dict(q['mesh'],nodes=[0]*30003)
        with self.assertRaisesRegex(ValueError,'10,000'):validate_request(q)

if __name__=='__main__':unittest.main()
