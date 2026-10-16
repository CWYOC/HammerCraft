import initOC from "./vendor/replicad_single.mjs";
import * as cad from "./vendor/replicad.mjs";
import { cadDefinition, cadFingerprint } from "./cad-model.mjs";
import { validateSTEPText } from "./step-input.mjs";
import { solveConstraintGraph } from "./constraints-solver.mjs";
import { describeEdges, applyEdgeTreatment } from './cad-edges.mjs';
import { EDGE_KINDS } from './topology.mjs';

let ready;
const constraintDiagnostics = new WeakMap();
export function loadKernel() {
  ready ||= initOC({ print: () => {}, printErr: () => {} }).then((oc) => {
    cad.setOC(oc);
    return oc;
  });
  return ready;
}
export async function buildSolid(source) {
  const oc = await loadKernel(),
    { size, holes = [], stepText, stepAsset, sketch, steps = [] } = cadDefinition(source);
  if(stepAsset)throw Error("Stored STEP assets require the local native CAD service.");
  let multiple = !!stepText;
  const solvedSketches = new Map();
  async function prepareSketch(definition) {
    if (definition.profile.type !== 'constrained') return definition;
    let solved = solvedSketches.get(definition.id);
    if (!solved) { solved = await solveConstraintGraph(definition.profile.graph); solvedSketches.set(definition.id, solved); }
    if (definition.operation.type === 'revolve' && (solved.bounds[0][0] < 0 || (!solved.profile.points && solved.bounds[0][0] < 1e-6)))
      throw Error('The solved profile must stay on the positive U side of the revolve axis; curved profiles need 1 µm clearance.');
    const p = solved.profile, mm = p => p.map(v => v * 1000);
    return {...definition,profile:p.points ? {...p,points:p.points.map(mm)} : {...p,center:mm(p.center),radiusU:p.radiusU*1000,radiusV:p.radiusV*1000}};
  }
  let shape = stepText
    ? await readSTEP(stepText)
    : sketch ? buildSketchSolid(await prepareSketch(sketch)) : cad.makeBox([0, 0, 0], size);
  try {
    validateSolid(shape, oc, multiple);
    if (stepText) {
      assertNoLooseGeometry(shape,oc);
    }
    for (const step of [...holes.map((hole) => ({ id: hole.id, type: "hole", hole })), ...steps]) {
      let tool;
      try {
        let next;
        if(step.type==='step-part'||step.type==='linear-pattern')multiple=true;
        if(step.type==='transform') next=placed(shape,step);
        else if(step.type==='linear-pattern') {
          if(countSolids(shape)*step.count>64)throw Error('Use at most 64 solid bodies.');
          const copies=[];
          try {for(let i=0;i<step.count;i++)copies.push(shape.clone().translate(step.spacing.map(v=>v*i)));next=compound(copies,oc);}finally{copies.forEach(s=>s.delete());}
        }
        else if(step.type==='step-part') {
          if(step.stepAsset)throw Error('Stored STEP parts require the local CAD service.');
          const original=await readSTEP(step.stepText);
          try {validateSolid(original,oc,true);assertNoLooseGeometry(original,oc);tool=placed(original,step);}finally{original.delete();}
          next=step.operation==='add'?compound([shape,tool],oc):step.operation==='union'?shape.fuse(tool):step.operation==='intersect'?shape.intersect(tool):shape.cut(tool);
        }
        else if (EDGE_KINDS.includes(step.type)) next = applyEdgeTreatment(shape,step);
        else {
          tool = step.type === "hole" ? holeTool(step.hole, size) : buildSketchSolid(await prepareSketch(step.sketch));
          validateSolid(tool, oc);
          next = step.type === "union" ? shape.fuse(tool)
            : step.type === "intersect" ? shape.intersect(tool) : shape.cut(tool);
        }
        shape.delete(); shape = next;
        // An empty or disconnected intermediate feature must not be hidden by later operations.
        validateSolid(shape, oc, multiple);
      } catch (error) {
        const name = source.features.find((f) => f.id === step.id)?.name || step.id;
        const reason = (error.message || `CAD ${step.type} operation failed${EDGE_KINDS.includes(step.type) ? '; reduce the size or choose compatible edges' : ''}`).replace(/[.\s]+$/, "");
        throw Error(`Feature ${name} (${step.type}) failed: ${reason}. Edit, reorder or suppress this feature.`);
      } finally { tool?.delete(); }
    }
    validateSolid(shape, oc, multiple);
    solidBounds(shape);
    constraintDiagnostics.set(shape, [...solvedSketches].map(([id, s]) => ({id,report:s.report})));
    return shape;
  } catch (error) {
    shape.delete();
    throw error;
  }
}
function countSolids(shape){const solids=shape.solids;const count=solids.length;solids.forEach(s=>s.delete());return count;}
function compound(shapes,oc){
  const raw=new oc.TopoDS_Compound(),builder=new oc.TopoDS_Builder();
  try{builder.MakeCompound(raw);for(const shape of shapes)builder.Add(raw,shape.wrapped);return cad.cast(raw);}finally{builder.delete();raw.delete();}
}
function placed(shape,placement){
  let result=shape.clone();
  try {
    for(let axis=0;axis<3;axis++){const direction=[0,0,0];direction[axis]=1;if(placement.rotation[axis])result=result.rotate(placement.rotation[axis],[0,0,0],direction);}
    return result.translate(placement.translation);
  } catch(error){result.delete();throw error;}
}
function assertNoLooseGeometry(shape,oc){
      for (const kind of ["TopAbs_FACE", "TopAbs_EDGE", "TopAbs_VERTEX"]) {
        const explorer = new oc.TopExp_Explorer(
          shape.wrapped,
          oc.TopAbs_ShapeEnum[kind],
          oc.TopAbs_ShapeEnum.TopAbs_SOLID,
        );
        try {
          if (explorer.More())
            throw Error(
              "STEP contains loose surfaces, curves or points outside the solid. Export closed solid bodies only.",
            );
        } finally {
          explorer.delete();
        }
      }
}
function validateSolid(shape, oc, multiple = false) {
    const solids = shape.solids;
    const solidCount = solids.length;
    let positiveVolumes;
    try {positiveVolumes=solids.every(s=>{const volume=cad.measureVolume(s);return Number.isFinite(volume)&&volume>0;});}finally{solids.forEach((s) => s.delete());}
    if (solidCount < 1 || solidCount > (multiple ? 64 : 1))
      throw Error(
        `Import or create ${multiple ? "1–64 closed solid bodies" : "exactly one closed solid"} with positive volume. Found ${solidCount} solid bodies. Curved faces are supported; export watertight solids without open surfaces.`,
      );
    if(!positiveVolumes)throw Error('Every solid body must have positive volume and outward face orientation.');
    const check = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, true);
    try {
      if (!check.IsValid(shape.wrapped))
        throw Error(
          "The CAD kernel found invalid face or edge topology. Curved surfaces are supported; check for gaps, self-intersections or broken seams in the source CAD tool, then export a repaired closed STEP solid.",
        );
    } finally {
      check.delete();
    }
    const volume = cad.measureVolume(shape);
    if (!Number.isFinite(volume) || volume <= 0)
      throw Error(
        "Import or create exactly one closed solid with positive volume. Multi-solid assemblies and open surfaces are not supported.",
      );
}
function holeTool(hole, size) {
  const padding = Math.max(0.001, size[hole.axis] * 0.01), origin = [0, 0, 0], direction = [0, 0, 0];
  origin[hole.axis] = -padding;
  hole.plane.forEach((a, i) => { origin[a] = hole.center[i]; });
  direction[hole.axis] = 1;
  return cad.makeCylinder(hole.diameter / 2, size[hole.axis] + 2 * padding, origin, direction);
}
function buildSketchSolid(definition) {
  const { profile, operation, origin, u, v, normal } = definition;
  let drawing;
  if (profile.points) {
    let pen = cad.draw(profile.points[0]);
    for (const point of profile.points.slice(1)) pen = pen.lineTo(point);
    drawing = pen.close();
  } else {
    drawing = profile.type === "circle" ? cad.drawCircle(profile.radiusU)
      : profile.radiusU >= profile.radiusV ? cad.drawEllipse(profile.radiusU, profile.radiusV)
        : cad.drawEllipse(profile.radiusV, profile.radiusU).rotate(90);
    drawing = drawing.translate(profile.center);
  }
  const plane = new cad.Plane(origin, u, normal);
  let sketch;
  try {
    sketch = drawing.sketchOnPlane(plane);
    return operation.type === "extrude" ? sketch.extrude(operation.distance)
      : sketch.revolve(v, { origin, angle: operation.angle });
  } finally {
    sketch?.delete();
    plane.delete();
  }
}
export function describeSolid(shape, source) {
  const bounds = solidBounds(shape),
    size = bounds[1].map((v, i) => v - bounds[0][i]);
  const tolerance = Math.max(0.00001, Math.min(...size) / 200);
  const options = { tolerance, angularTolerance: 0.15 };
  const mesh = shape.mesh(options),
    edges = shape.meshEdges(options);
  if (mesh.triangles.length > 1500000)
    throw Error("The surface mesh exceeds the viewer limit.");
  let edgeCatalog = [], edgeCatalogError = '';
  try {edgeCatalog = describeEdges(shape,true);} catch(error) {edgeCatalogError = error.message;}
  return {
    fingerprint: cadFingerprint(source),
    kernel: "Open CASCADE / replicad 1.1.0",
    constrainedSketches: constraintDiagnostics.get(shape) || [],
    edgeCatalog, edgeCatalogError,
    solidCount: countSolids(shape),
    volume: cad.measureVolume(shape) / 1e9, // SI cubic metres
    bounds: bounds.map((p) => p.map((v) => v / 1000)),
    faceCount: mesh.faceGroups.length,
    triangleCount: mesh.triangles.length / 3,
    tolerance: tolerance / 1000,
    mesh: {
      vertices: mesh.vertices,
      normals: mesh.normals,
      triangles: mesh.triangles,
    },
    edges: edges.lines,
  };
}
function solidBounds(shape) {
  const box = shape.boundingBox;
  try {
    const bounds = box.bounds,
      size = bounds[1].map((v, i) => v - bounds[0][i]);
    if (
      bounds.flat().some((v) => !Number.isFinite(v) || Math.abs(v) > 1e7) ||
      size.some((v) => v < 0.000999 || v > 1e6 + 0.001) ||
      Math.max(...size) / Math.min(...size) > 10001
    )
      throw Error(
        "CAD bounds must span 1 µm–1000 m per axis, have aspect ratio at most 10,000 and lie within 10 km of the origin.",
      );
    return bounds;
  } finally {
    box.delete();
  }
}
async function readSTEP(stepText) {
  validateSTEPText(stepText);
  const oc = await loadKernel();
  const path = `/engineering-${globalThis.crypto.randomUUID()}.step`;
  const reader = new oc.STEPControl_Reader();
  let raw;
  try {
    oc.FS.writeFile(path, new TextEncoder().encode(stepText));
    if (reader.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone)
      throw Error(
        "The STEP parser could not read this file. Export a complete STEP solid from the source CAD tool.",
      );
    // STEP may declare metres or inches. Explicitly transfer to millimetres.
    reader.SetSystemLengthUnit(1);
    const roots = reader.NbRootsForTransfer();
    if (roots < 1 || reader.TransferRoots() !== roots)
      throw Error(
        "The STEP file contains missing or unsupported geometry; not all roots could be transferred.",
      );
    raw = reader.OneShape();
    if (raw.IsNull())
      throw Error("The STEP file contains no transferable solid geometry.");
    return cad.cast(raw);
  } finally {
    raw?.delete();
    reader.delete();
    try {
      oc.FS.unlink(path);
    } catch {
      /* File creation may have failed. */
    }
  }
}
export function exportSolid(shape, format, name = "Engineering solid") {
  if (format === "step")
    return cad.exportSTEP([{ shape, name }], { unit: "MM", modelUnit: "MM" });
  if (format === "stl")
    return shape.blobSTL({
      binary: true,
      tolerance: 0.02,
      angularTolerance: 0.15,
    });
  throw Error("Choose STEP or STL export.");
}
// Used by the real-kernel regression suite to verify the exchange file independently.
export const importSTEP = cad.importSTEP;
export const measureVolume = cad.measureVolume;
