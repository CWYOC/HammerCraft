// Keep the initial request while the Rust unit runtime initializes.
const modules=Promise.all([import('./sketch.mjs'),import('./constraints-solver.mjs')]);
self.onmessage=async({data})=>{
  const {id,sketch,values}=data;
  try {
    const [{resolveSketch},{solveConstraintGraph}]=await modules;
    const model=resolveSketch(sketch,new Map(values));
    if(model.profile.type!=='constrained') throw Error('Choose a constrained profile.');
    const solved=await solveConstraintGraph(model.profile.graph);
    self.postMessage({id,solved});
  } catch(error) {
    // A diagnosis is a successful preview response, not an accepted geometry result.
    self.postMessage({id,diagnostic:error.message,report:error.constraintReport||null,geometry:error.constraintGeometry||null});
  }
};
