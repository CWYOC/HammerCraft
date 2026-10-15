import copy
import unittest
import numpy as np
from test_compute import fixture
from mesher import mesh_step
from harmonic_fem import solve_harmonic,validate_request,harmonic_system

class HarmonicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        geometry=fixture();geometry['settings']['maxSize']=.008;cls.mesh=mesh_step(geometry)
    def request(self,mesh=None):
        m=mesh or self.mesh;lo=min(m['boundary'],key=lambda g:g['center'][0])['tag'];hi=max(m['boundary'],key=lambda g:g['center'][0])['tag']
        return {'kind':'harmonic-tetra','mesh':m,'youngModulus':70e9,'poissonRatio':.3,'density':2700,'alpha':2,'beta':2e-6,'frequencies':[1,1000,4000],
            'boundaries':[{'tag':lo,'type':'fixed'},{'tag':hi,'type':'force','values':[0,0,1],'phase':0}], 'responseTag':hi,'responseAxis':2}
    def test_sparse_complex_solution_matches_dense_and_static_limit(self):
        from structural_fem import solve_structural
        q=self.request();r=solve_harmonic(q);points,basis,nodal,D,K,M,F,weights,total=harmonic_system(q);free=np.setdiff1d(np.arange(basis.N),D)
        for result in r['responses']:
            w=2*np.pi*result['frequency'];A=((1+1j*w*q['beta'])*K+(-w*w+1j*w*q['alpha'])*M).toarray();expected=np.linalg.solve(A[np.ix_(free,free)],F[free]);actual=(np.array(result['real'])+1j*np.array(result['imag'])).reshape((-1,3)).T
            np.testing.assert_allclose(actual.flatten()[np.argsort(nodal.flatten())][free],expected,rtol=1e-8,atol=1e-15)
            self.assertGreater(result['inputPower'],0);self.assertAlmostEqual(result['inputPower'],result['dissipatedPower'],places=10)
        static=solve_structural(dict(q,kind='structural-tetra',gravity=[0,0,0],yieldStrength=None))
        np.testing.assert_allclose(r['responses'][0]['real'],static['displacements'],rtol=2e-6,atol=1e-13)
    def test_load_phase_and_amplitude_scaling(self):
        q=self.request();base=solve_harmonic(q);q['boundaries'][-1].update(values=[0,0,3],phase=np.pi/2);shifted=solve_harmonic(q)
        for a,b in zip(base['responses'],shifted['responses']):
            np.testing.assert_allclose(b['real'],-3*np.array(a['imag']),atol=1e-14)
            np.testing.assert_allclose(b['imag'],3*np.array(a['real']),atol=1e-14)
            self.assertAlmostEqual(b['inputPower'],9*a['inputPower'],places=10)
    def test_damping_regularizes_resonance(self):
        from modal_fem import solve_modal
        q=self.request();modal=solve_modal(dict(q,kind='modal-tetra',modeCount=1,boundaries=q['boundaries'][:1]));q['frequencies']=[modal['modes'][0]['frequency']];q['alpha']=0
        low=solve_harmonic(q)['responses'][0];q['beta']*=4;high=solve_harmonic(q)['responses'][0]
        self.assertGreater(np.hypot(low['meanReal'][2],low['meanImag'][2]),3.8*np.hypot(high['meanReal'][2],high['meanImag'][2]))
    def test_pressure_sign_and_free_body_dynamic_balance(self):
        q=self.request();q['boundaries']=[dict(q['boundaries'][-1],type='pressure',pressure=5000,phase=np.pi/2)];q['frequencies']=[1000]
        r=solve_harmonic(q)['responses'][0];np.testing.assert_allclose(r['forceImag'],[-1,0,0],atol=1e-10)
        np.testing.assert_allclose(r['reactionReal'],0,atol=1e-10);np.testing.assert_allclose(np.array(r['inertiaImag'])+r['dampingImag'],r['forceImag'],atol=1e-8)
    def test_axial_continuum_frequency_response_refinement(self):
        errors=[]
        for size in [.008,.004]:
            geometry=fixture();geometry['settings']['maxSize']=size;m=mesh_step(geometry);q=self.request(m);q.update(poissonRatio=0,alpha=0,beta=2e-6,frequencies=[15000],responseAxis=0)
            lo=q['boundaries'][0]['tag'];hi=q['responseTag'];q['boundaries']=[{'tag':lo,'type':'fixed'},{'tag':hi,'type':'force','values':[1,0,0],'phase':0}]
            w=2*np.pi*15000;effective_E=70e9*(1+1j*w*q['beta']);k=w*np.sqrt(2700/effective_E);exact=np.tan(k*.06)/(effective_E*.0002*k)
            r=solve_harmonic(q)['responses'][0];actual=r['meanReal'][0]+1j*r['meanImag'][0];errors.append(abs(actual/exact-1))
        self.assertLess(errors[1],errors[0]);self.assertLess(errors[1],.01)
    def test_invalid_frequency_damping_load_restraint_and_limits(self):
        for change in [{'frequencies':[0]},{'frequencies':[2,1]},{'frequencies':[1]*25},{'alpha':-1},{'beta':-1},{'responseTag':99999},{'responseAxis':3},{'boundaries':[{'tag':self.mesh['boundary'][0]['tag'],'type':'displacement','values':[1e-9,None,None]}]}]:
            q=self.request();q.update(change)
            with self.assertRaises(ValueError):validate_request(q)
        q=self.request();q['boundaries'][-1]['values']=[0,0,0]
        with self.assertRaisesRegex(ValueError,'free displacement'):solve_harmonic(q)
        q=self.request();q['mesh']=dict(q['mesh'],nodes=[0]*12003)
        with self.assertRaisesRegex(ValueError,'4,000'):validate_request(q)

if __name__=='__main__':unittest.main()
