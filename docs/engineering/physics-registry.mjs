// Built-in, executable study descriptors. Additional methods register here when implemented.
export const SOLVERS=Object.freeze({
  'hc-electric-fem-1':Object.freeze({id:'hc-electric-fem-1',physics:'dc-conduction',study:'steady-state',mesh:'gmsh-tetra',method:'Finite element',action:'electric-tetra',transport:'local',label:'DC conduction'}),
  'hc-harmonic-fem-1':Object.freeze({id:'hc-harmonic-fem-1',physics:'harmonic-elasticity',study:'frequency-response',mesh:'gmsh-tetra',method:'Finite element',action:'harmonic-tetra',transport:'local',label:'Harmonic response'}),
  'hc-modal-fem-1':Object.freeze({id:'hc-modal-fem-1',physics:'elastic-vibration',study:'eigenfrequency',mesh:'gmsh-tetra',method:'Finite element',action:'modal-tetra',transport:'local',label:'Natural frequencies'}),
  'hc-structural-fem-1':Object.freeze({id:'hc-structural-fem-1',physics:'linear-elasticity',study:'static',mesh:'gmsh-tetra',method:'Finite element',action:'structural-tetra',transport:'local',label:'Static structural'}),
  'hc-thermal-fvm-1':Object.freeze({id:'hc-thermal-fvm-1',physics:'heat-conduction',study:'steady-state',mesh:'structured-hex',method:'Finite volume',action:'solve',transport:'browser',label:'Block conduction'}),
  'hc-thermal-fem-1':Object.freeze({id:'hc-thermal-fem-1',physics:'heat-conduction-tetra',study:'steady-state',mesh:'gmsh-tetra',method:'Finite element',action:'thermal-tetra',transport:'local',label:'CAD solid conduction'}),
});
export function solverDescriptor(id){const solver=SOLVERS[id];if(!solver)throw Error('This solver is not implemented.');return solver;}
export function assertStudy(study,physics,mesh){const s=solverDescriptor(study.solverId);if(s.physics!==physics.type||s.study!==study.type||s.mesh!==mesh.type||study.physicsId!==physics.id||study.meshId!==mesh.id)throw Error('Study physics, mesh or solver is incompatible.');return s;}
export const localAction=action=>action==='volume-mesh'||Object.values(SOLVERS).some(s=>s.action===action&&s.transport==='local');
