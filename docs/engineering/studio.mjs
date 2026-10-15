import {renderElectricEditor} from './electric-fem-editor.mjs';
import {electricRequest,electricCSV,electricVTK} from './electric-fem-data.mjs';
import {electricDisplay} from './electric-fem-view.mjs';
import {runtime as rustRuntime} from './rust-runtime.mjs';
let rustParameterEditor=null;
import {renderHarmonicEditor,renderHarmonicPlot} from './harmonic-fem-editor.mjs';
import {harmonicRequest,harmonicCSV,harmonicVTK} from './harmonic-fem-data.mjs';
import {createHarmonicDisplay,HarmonicAnimation} from './harmonic-fem-view.mjs';
import {renderModalEditor} from './modal-fem-editor.mjs';
import {modalRequest,modalCSV,modalVTK} from './modal-fem-data.mjs';
import {createModalDisplay,ModeAnimation} from './modal-fem-view.mjs';
import {renderStructuralEditor} from './structural-fem-editor.mjs';
import {structuralRequest,structuralCSV,structuralVTK} from './structural-fem-data.mjs';
import {structuralField,structuralDisplay} from './structural-fem-view.mjs';
import {renderFemEditor} from './thermal-fem-editor.mjs';
import {femRequest,femCSV,femVTK} from './thermal-fem-data.mjs';
import {reusableFemMesh} from './thermal-fem.mjs';
import {femDisplay,femField,fieldRange} from './thermal-fem-view.mjs';
import { computeHealth } from './compute-client.mjs';
import { inspectVolumeMesh, resolveVolumeMesh, volumeMeshDisplay, volumeMeshMSH } from './volume-mesh.mjs';
import { renderVolumeMeshEditor } from './volume-mesh-editor.mjs';
import { BOOLEAN_OPERATIONS, addSketchOperation, removeFeature, moveFeature, rebindSketch, detachSketch } from "./features.mjs";
import { defaultSketch } from "./sketch.mjs";
import { renderConstraintEditor } from "./constraints-editor.mjs";
import { renderSketchPreview } from "./sketch-view.mjs";
import {
  createProject,
  validateProject,
  validateSource,
  ProjectHistory,
  fingerprint,
  isCurrent,
  faceId,
  PRESETS,
  THERMAL_GEOMETRY_LIMIT,
  thermalSourceIssue,
  requireThermalSource,
} from "./project.mjs";
import { renderMaterialEditor } from "./material-editor.mjs";
import { materialSnapshot, importMaterialSnapshot, densityDescription } from "./materials.mjs";
import { dimensionLabel } from "./units.mjs";
import { meshInfo, summarize, sampleTemperature } from "./thermal.mjs";
import { createEngineeringViewer } from "./viewer.mjs";
import { renderEdgeEditor } from './edge-editor.mjs';
import { EDGE_KINDS } from './topology.mjs';
import { JobManager } from "./jobs.mjs";
import { openProjectStore } from "./storage.mjs";
import { cadFingerprint } from "./cad-model.mjs";
import { CadClient } from "./cad-client.mjs";
import { CadImport, stepSource } from "./cad-import.mjs";
import { MAX_STEP_BYTES, MAX_PROJECT_BYTES } from "./step-input.mjs";
import { createSweep } from "./sweep.mjs";
import { resolveSweep, sweepSource, sweepCSV, siExpression, SWEEP_OBJECTIVES } from "./sweep-data.mjs";
import { renderSweepComparison, drawSweepPlot } from "./sweep-view.mjs";
import { refinementSettings } from "./convergence-data.mjs";
import { createConvergence, convergenceCSV } from "./convergence.mjs";
import { renderConvergenceComparison, drawConvergencePlot } from "./convergence-view.mjs";
import { MAX_MEASUREMENT_BYTES, XY_QUANTITIES, parseMeasurementTable, resolveMeasurement, createMeasurement, measurementCSV } from "./measurement-data.mjs";
import { compareMeasurement, measurementComparisonCSV } from "./measurement.mjs";
import { renderMeasurementReport, renderMeasurementMetrics, solutionLabel } from "./measurement-view.mjs";

const $ = (id) => document.getElementById(id),
  clone = structuredClone;
const number = (value, digits = 4) =>
  value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 1e9)
    ? Number(value).toExponential(digits - 1)
    : Number(value).toLocaleString(undefined, {
        maximumSignificantDigits: digits,
      });
const celsius = (k) => number(k - 273.15);
let history,
  viewer,
  store,
  workspace = "Design",
  node = "parameters",
  selectedFace,
  selectedResultId,
  meshArtifact;
let selectedVolumeMeshId=null, volumeMeshService='Not checked', volumeMeshPreparing=null, volumeMeshJob=null;
const volumeMeshCut={axis:0,fraction:1}, volumeMeshStats=new WeakMap();
let volumeMeshViewCache=null;
const volumeMeshRecord=()=>project().volumeMeshes.find(m=>m.id===selectedVolumeMeshId)||project().volumeMeshes.at(-1);
const viewingVolumeMesh=()=>workspace==='Simulate'&&node==='volumeMesh';
const volumeMeshInfo=r=>{if(!volumeMeshStats.has(r))volumeMeshStats.set(r,inspectVolumeMesh(r.mesh).stats);return volumeMeshStats.get(r);};
let electricJob=null,selectedElectricId=null,electricOutput='potential';
const electricCut={axis:0,fraction:1};
const viewingElectric=()=>['electricStudy','electricResults'].includes(node);
const electricResult=()=>project().electricResults.find(r=>r.id===selectedElectricId)||project().electricResults.at(-1);
function electricReadiness(){try{const mesh=femMesh();if(!mesh)return 'Generate a verified tetrahedral mesh for this geometry and sizing.';electricRequest(validateSource(project().source),mesh.mesh);return '';}catch(error){return error.message;}}
let harmonicJob=null,selectedHarmonicId=null,harmonicIndex=0,harmonicScale=1,harmonicRate=1,harmonicPhase=0,harmonicField='displacement',harmonicPlot='displacement',harmonicViewCache=null;
const harmonicCut={axis:0,fraction:1},harmonicAnimation=new HarmonicAnimation(drawHarmonicPhase);
const viewingHarmonic=()=>['harmonicStudy','harmonicResults'].includes(node);
const harmonicResult=()=>project().harmonicResults.find(r=>r.id===selectedHarmonicId)||project().harmonicResults.at(-1);
function harmonicReadiness(){try{const mesh=femMesh();if(!mesh)return 'Generate a verified tetrahedral mesh for this geometry and sizing.';harmonicRequest(validateSource(project().source),mesh.mesh);return '';}catch(error){return error.message;}}
let modalJob=null,selectedModalId=null,modalMode=0,modalAmplitude=.05,modalRate=1,modalPhase=1,modalViewCache=null;
const modalCut={axis:0,fraction:1},modalAnimation=new ModeAnimation(drawModalPhase);
const viewingModal=()=>['modalStudy','modalResults'].includes(node);
const modalResult=()=>project().modalResults.find(r=>r.id===selectedModalId)||project().modalResults.at(-1);
function modalReadiness(){try{const mesh=femMesh();if(!mesh)return 'Generate a verified tetrahedral mesh for this geometry and sizing.';modalRequest(validateSource(project().source),mesh.mesh);return '';}catch(error){return error.message;}}
let structuralJob=null,selectedStructuralId=null,structuralOutput='vonMises',structuralRange=null,structuralDeformation=0;
const structuralCut={axis:0,fraction:1};
const viewingStructural=()=>['structuralStudy','structuralResults'].includes(node);
const structuralResult=()=>project().structuralResults.find(r=>r.id===selectedStructuralId)||project().structuralResults.at(-1);
function structuralReadiness(){try{const mesh=femMesh();if(!mesh)return 'Generate a verified tetrahedral mesh for this geometry and sizing.';structuralRequest(validateSource(project().source),mesh.mesh);return '';}catch(error){return error.message;}}
let femJob=null,selectedFemId=null,selectedSurface=null,femOutput='temperature',femRange=null;
const femCut={axis:0,fraction:1};
const viewingFem=()=>['femStudy','femResults'].includes(node);
const femResult=()=>project().femResults.find(r=>r.id===selectedFemId)||project().femResults.at(-1);
const femMesh=()=>[...project().volumeMeshes].reverse().find(r=>reusableFemMesh(project(),r));
function femReadiness(){try{const mesh=femMesh();if(!mesh)return 'Generate a verified mesh for the current CAD geometry and sizing.';femRequest(validateSource(project().source),mesh.mesh);return '';}catch(error){return error.message;}}
function selectFemSurface(tag){if(!flushDraft())return;selectedSurface=tag;renderProperties();renderViewport();}
let sketchMode = true, selectedOperationId = null, selectedMaterialId = null;
let draft = false,
  activeForm,
  saveTimer,
  saveGeneration = 0,
  saved = false,
  resultRange,
  storageWarning = "",
  downloadUrl;
const events = [];
let sweepLive = null, selectedSweepId = null, sweepDraft = null;
const sweepRecord = () => sweepLive || project().sweeps.find((s) => s.id === selectedSweepId) || project().sweeps.at(-1);
let convergenceLive = null, selectedConvergenceId = null, convergenceDraft = null;
const convergenceRecord = () => convergenceLive || project().convergenceChecks.find((s) => s.id === selectedConvergenceId) || project().convergenceChecks.at(-1);
const viewingConvergence = () => workspace === "Simulate" && node === "convergence";
let selectedMeasurementId = null, measurementPending = null, measurementReadToken = 0, measurementSolutionIds = null;
const viewingMeasurements = () => workspace === "Analyze" && node === "measurements";
const measurement = () => project().measurements.find((m) => m.id === selectedMeasurementId) || project().measurements.at(-1);
const measurementSolutions = () => measurementSolutionIds === null ? (result() ? [result()] : [])
  : measurementSolutionIds.map((id) => project().results.find((r) => r.id === id)).filter(Boolean);
const cadClient = new CadClient();
const cadImport = new CadImport();
let editGeneration = 0,
  importGeneration = 0;
let cadState = { key: null, artifact: null, status: "idle", error: "" };
let newEdgeKind = null, disposeEdgeEditor = null, edgePreview = null, edgeSelectionActive = false;
const project = () => history.project;
const result = () =>
  project().results.find((r) => r.id === selectedResultId) ||
  project().results.at(-1);
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function button(text, handler, className) {
  const el = element("button", text, className);
  el.type = "button";
  el.onclick = () => attempt(handler);
  return el;
}
function message(text, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
}
function attempt(fn) {
  try {
    const value = fn();
    if (value?.catch) value.catch((error) => message(error.message, true));
    return value;
  } catch (error) {
    message(error.message, true);
  }
}
function field(parent, label, value, type = "text") {
  const wrap = element("label", label),
    input = element("input");
  input.type = type;
  input.value = value;
  if (type === "number") input.step = "any";
  wrap.append(input);
  parent.append(wrap);
  return input;
}
function select(parent, label, items, value) {
  const wrap = element("label", label),
    input = element("select");
  for (const [id, name] of items) {
    const option = element("option", name);
    option.value = id;
    input.append(option);
  }
  input.value = value;
  wrap.append(input);
  parent.append(wrap);
  return input;
}
function note(parent, text, className = "note") {
  parent.append(element("p", text, className));
}
function pair(parent, label, value) {
  const row = element("div", undefined, "key-value");
  row.append(element("span", label), element("span", value));
  parent.append(row);
}
function form(parent, submit, label = "Apply changes", local = false) {
  const el = element("form");
  parent.append(el);
  if (!local) {
    activeForm = el;
    el.addEventListener("input", markDraft);
    el.addEventListener("change", markDraft);
  }
  el.onsubmit = (e) => {
    e.preventDefault();
    attempt(() => {
      submit();
      if (!local) {
        draft = false;
        // Reverting a draft to its saved values creates no new history entry or autosave.
        if ($("saveState").textContent === "Unapplied edits") {
          $("saveState").textContent = saved && store ? "Saved on this device" : "Export to save";
        }
        render();
      }
    });
  };
  const apply = element("button", label, "primary");
  apply.type = "submit";
  return { el, finish: () => el.append(apply) };
}
function markDraft() {
  editGeneration++;
  draft = true;
  $("saveState").textContent = "Unapplied edits";
}
function flushDraft() {
  if (draft && activeForm) activeForm.requestSubmit();
  return !draft;
}
function update(mutator, name = project().name) {
  const source = clone(project().source);
  mutator(source);
  const inputsChanged =
    JSON.stringify(source) !== JSON.stringify(project().source);
  if (history.update(source, name)) {
    scheduleSave();
    message(
      inputsChanged
        ? "Changes applied. Affected meshes and solutions are now outdated."
        : "Project name updated. Simulation inputs are unchanged.",
    );
  }
}
function scheduleSave() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  $("downloadLink").hidden = true;
  saved = false;
  saveGeneration++;
  clearTimeout(saveTimer);
  $("saveState").textContent = store ? "Autosave pending…" : "Export to save";
  saveTimer = setTimeout(() => attempt(persist), 450);
}
async function persist() {
  clearTimeout(saveTimer);
  if (!store) {
    $("saveState").textContent = "Export to save";
    return;
  }
  const generation = saveGeneration,
    snapshot = clone(project());
  try {
    await store.save(snapshot);
    if (generation === saveGeneration) {
      saved = true;
      $("saveState").textContent = draft
        ? "Unapplied edits"
        : "Saved on this device";
    }
    $("recoverProject").disabled = false;
  } catch (error) {
    saved = false;
    $("saveState").textContent = "Autosave failed";
    message(
      `Local save failed: ${error.message}. Export your project to keep it.`,
      true,
    );
  }
}
function download(name, contents, type = "application/json") {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([contents], { type }));
  const link = $("downloadLink");
  link.href = downloadUrl;
  link.download = name;
  link.textContent = `Download ${name}`;
  link.hidden = false;
  link.click();
}
function fileName(suffix) {
  return `${
    project()
      .name.replace(/[^a-z0-9_-]/gi, "_")
      .slice(0, 80) || "engineering"
  }${suffix}`;
}
function currentCAD() {
  return cadState.key === cadFingerprint(project().source)
    ? cadState.artifact
    : null;
}
function displayedSize(model, artifact = currentCAD()) {
  return (
    model.thermalSupported ? model.size : artifact?.bounds[1].map((v, i) => v - artifact.bounds[0][i])
  );
}
function unchangedProject() {
  const { id, revision } = project(),
    generation = editGeneration;
  return () =>
    project().id === id &&
    project().revision === revision &&
    editGeneration === generation;
}
async function acceptCADImport(source, guard, commit) {
  const generation = ++importGeneration;
  $("importSTEP").disabled = true;
  $("cancelImport").hidden = false;
  message(
    "Validating the CAD file in a local worker. Your current model remains available.",
  );
  try {
    await cadImport.run(source, guard, commit);
  } finally {
    if (generation === importGeneration) {
      $("importSTEP").disabled = false;
      $("cancelImport").hidden = true;
    }
  }
}
function ensureCAD(force = false) {
  const source = clone(project().source),
    key = cadFingerprint(source);
  if (!force && cadState.key === key) return;
  const state = { key, artifact: null, status: "building", error: "" };
  cadState = state;
  cadClient
    .request("build", { source })
    .then(({ artifact }) => {
      if (cadState !== state) return;
      state.artifact = artifact;
      state.status = "ready";
      syncStudyControls();
      renderViewport();
      if (!draft && !edgeSelectionActive && !(viewingVolumeMesh() && volumeMeshRecord()) && !viewingFem() && !viewingStructural() && !viewingModal() && !viewingHarmonic() && !viewingElectric()) renderProperties();
    })
    .catch((error) => {
      if (cadState !== state) return;
      state.status = "failed";
      state.error = error.message;
      syncStudyControls();
      renderViewport();
      if (!draft && !edgeSelectionActive && !(viewingVolumeMesh() && volumeMeshRecord()) && !viewingFem() && !viewingStructural() && !viewingModal() && !viewingHarmonic() && !viewingElectric()) renderProperties();
    });
}
async function exportCAD(format) {
  if (!flushDraft()) return;
  const artifact = currentCAD();
  if (!artifact)
    throw Error(
      "Wait for the CAD solid to finish regenerating before exporting.",
    );
  const key = cadState.key,
    projectId = project().id,
    name = project().name;
  const filename = fileName(`.${format}`);
  message(`Preparing ${format.toUpperCase()} from the current CAD solid…`);
  let blob;
  try {
    ({ blob } = await cadClient.request("export", {
      format,
      fingerprint: key,
      name,
    }));
  } catch (error) {
    if (cadState.key === key) {
      cadState.artifact = null;
      cadState.status = "failed";
      cadState.error = error.message;
      renderViewport();
      if (!draft) renderProperties();
    }
    throw error;
  }
  if (project().id !== projectId || cadFingerprint(project().source) !== key)
    throw Error(
      "The geometry changed during export. Export the current model again.",
    );
  download(filename, blob, format === "step" ? "model/step" : "model/stl");
  message(
    `${format.toUpperCase()} prepared from the current CAD solid in millimetres.`,
  );
}
function cadStatus(panel) {
  const artifact = currentCAD();
  pair(
    panel,
    "CAD solid",
    artifact
      ? "Validated · Open CASCADE"
      : cadState.status === "failed"
        ? "Regeneration failed"
        : "Regenerating…",
  );
  if (artifact) {
    pair(panel, "Volume", `${number(artifact.volume * 1e9, 7)} mm³`);
    for (const entry of artifact.constrainedSketches || []) {
      const sketch = project().source.sketches?.find(sk => sk.id === entry.id);
      pair(panel, sketch?.name || "Sketch constraints", `${entry.report.status === "fully-constrained" ? "Fully constrained" : "Under-constrained"} · ${entry.report.dof} DOF`);
    }
    pair(
      panel,
      "Surface",
      `${artifact.faceCount} faces · ${artifact.triangleCount} triangles`,
    );
  } else if (cadState.status === "failed") {
    note(panel, cadState.error, "callout");
    panel.append(
      button("Retry CAD regeneration", () => {
        ensureCAD(true);
        render();
      }),
    );
  } else
    note(
      panel,
      "Loading or regenerating the local CAD kernel. First load includes a 22 MB WASM asset.",
    );
}
function syncStudyControls() {
  const issue = thermalSourceIssue(validateSource(project().source));
  for (const id of ["solve", "generateMesh", "generateVolumeMesh", "runSweep", "runConvergence", "solveFem", "solveStructural", "solveModal", "solveHarmonic", "solveElectric"]) {
    if (!$(id)) continue;
    const electric=id==='solveElectric'||id==='solve'&&viewingElectric(),electricIssue=electric?electricReadiness():'';
    const harmonic=id==='solveHarmonic'||id==='solve'&&viewingHarmonic(),harmonicIssue=harmonic?harmonicReadiness():'';
    const modal=id==='solveModal'||id==='solve'&&viewingModal(),modalIssue=modal?modalReadiness():'';
    const structural=id==='solveStructural'||id==='solve'&&viewingStructural(),structuralIssue=structural?structuralReadiness():'';
    const fem=id==='solveFem'||id==='solve'&&viewingFem(),femIssue=fem?femReadiness():'';
    const volume = id === 'generateVolumeMesh' || id === 'generateMesh' && (viewingVolumeMesh()||viewingFem()||viewingStructural()||viewingModal()||viewingHarmonic()||viewingElectric());
    $(id).disabled = !!jobs.active || !!volumeMeshPreparing || (electric ? !!electricIssue : harmonic ? !!harmonicIssue : modal ? !!modalIssue : structural ? !!structuralIssue : fem ? !!femIssue : volume ? !currentCAD() : !!issue);
    $(id).title = electric ? electricIssue || 'Solve DC conduction in Rust.' : harmonic ? harmonicIssue || 'Solve harmonic response.' : modal ? modalIssue || 'Solve natural modes.' : structural ? structuralIssue || 'Solve static structural FEM.' : fem ? femIssue || 'Solve the CAD thermal study on a compatible tetrahedral mesh.' : volume ? 'Generate a CAD tetrahedral mesh with the local Gmsh service.' : issue;
  }
  if($('cadMeshWait'))$('cadMeshWait').hidden=!!currentCAD();
}
function renderTree() {
  $("solve").textContent=viewingElectric()?"▶ Solve electrical":viewingHarmonic()?"▶ Solve harmonic":viewingModal()?"▶ Solve modes":viewingStructural()?"▶ Solve structural":"▶ Solve thermal";
  $("projectName").value = project().name;
  $("treeName").textContent = project().name;
  $("revision").textContent = `r${project().revision}`;
  $("parameterCount").textContent = project().source.parameters.length;
  $("resultCount").textContent = project().results.length;
  $("convergenceCount").textContent = project().convergenceChecks.length;
  $("measurementCount").textContent = project().measurements.length;
  for (const b of document.querySelectorAll("[data-node]"))
    b.classList.toggle("active", b.dataset.node === node);
  for (const b of document.querySelectorAll("[data-workspace]")) {
    if (b.dataset.workspace === workspace)
      b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  $("undo").disabled = !history.past.length;
  $("redo").disabled = !history.future.length;
  syncStudyControls();
  $("holeCount").textContent = project().source.features.filter((f) => f.type === "through-hole").length;
  $("operationCount").textContent = project().source.features.length - 1;
  $("bodyLabel").textContent =
    project().source.features[0].type === "imported-step"
      ? "Imported STEP solid"
      : ["extrude", "revolve"].includes(project().source.features[0].type) ? "Sketch-based solid" : "Parametric block";
  $("versions").replaceChildren(
    ...project().versions.map((v) => {
      const row = element("div", undefined, "version-row");
      row.append(
        button(`↶ ${v.name}`, async () => {
          if (!flushDraft()) return;
          const restore = () => {
            history.update(v.source);
            scheduleSave();
            render();
            message(
              `Restored “${v.name}”. Undo can return to the previous design.`,
            );
          };
          if (v.source.features[0].type === "imported-step")
            await acceptCADImport(v.source, unchangedProject(), restore);
          else restore();
        }),
      );
      return row;
    }),
  );
}
function renderProperties() {
  rustParameterEditor?.free();rustParameterEditor=null;
  disposeEdgeEditor?.();disposeEdgeEditor=null;
  const panel = $("propertiesBody");
  panel.replaceChildren();
  activeForm = null;
  const model = validateSource(project().source),
    feature = project().source.features[0];
  $("propertiesHeading").textContent = node === "electricStudy" ? "DC CONDUCTION" : node === "electricResults" ? "ELECTRICAL RESULTS" : node === "harmonicStudy" ? "FORCED VIBRATION" : node === "harmonicResults" ? "FREQUENCY RESPONSE" : node === "modalStudy" ? "EIGENFREQUENCY STUDY" : node === "modalResults" ? "NATURAL MODES" : node === "structuralStudy" ? "STATIC STRUCTURAL" : node === "structuralResults" ? "STRUCTURAL RESULTS" : node === "femStudy" ? "CAD THERMAL STUDY" : node === "femResults" ? "CAD THERMAL RESULTS" : node === "volumeMesh" ? "CAD VOLUME MESH" :
    workspace === "Optimize" || workspace === "Manufacture"
      ? workspace.toUpperCase()
      : node.toUpperCase();
  if(viewingElectric()){renderElectricProperties(panel,model);return;}
  if(viewingHarmonic()){renderHarmonicProperties(panel,model);return;}
  if(viewingModal()){renderModalProperties(panel,model);return;}
  if(viewingStructural()){renderStructuralProperties(panel,model);return;}
  if(viewingFem()){renderFemProperties(panel,model);return;}
  if (workspace === "Optimize") {
    renderSweepSetup(panel, model);
    return;
  }
  if (viewingMeasurements()) {
    renderMeasurementSetup(panel);
    return;
  }
  if (node === "convergence") {
    renderConvergenceSetup(panel, model);
    return;
  }
  if (workspace === "Manufacture") {
    panel.append(element("h2", "Solid export"));
    note(
      panel,
      "Export the current CAD solid as STEP with exact surfaces, or a triangulated STL for manufacturing tools.",
    );
    pair(
      panel,
      "Dimensions",
      displayedSize(model)
        ?.map((n) => `${number(n * 1000)} mm`)
        .join(" × ") || "Awaiting CAD solid",
    );
    cadStatus(panel);
    pair(
      panel,
      model.material.densityAt ? "Reference mass" : "Mass",
      currentCAD()
        ? `${number(currentCAD().volume * model.material.rho * 1000)} g`
        : "Awaiting CAD solid",
    );
    if (model.material.densityAt) note(panel, densityDescription(model.material));
    for (const format of ["step", "stl"]) {
      const b = button(
        `Export ${format.toUpperCase()} · millimetres`,
        () => exportCAD(format),
        "primary full",
      );
      b.disabled = !currentCAD();
      panel.append(b);
    }
    note(
      panel,
      "STL contains no unit metadata. Choose millimetres when importing into a slicer.",
    );
    note(
      panel,
      "STEP includes the final solid, not the editable feature history. Export the project to preserve features and embedded STEP data. Printer profiles, wall checks, slicing and CAM are unavailable.",
      "callout",
    );
    return;
  }
  if (node === "parameters") {
    rustParameterEditor=new rustRuntime.ParameterEditor(panel,JSON.stringify(project().source.parameters),model.imported,data=>{
      update(s=>{s.parameters=JSON.parse(data);});draft=false;render();
    },markDraft);
    activeForm=rustParameterEditor.form();return;
  }
  if (node === "operations") { renderOperations(panel, model); return; }
  if (node === "sketch" || (node === "body" && model.sketchBased)) {
    renderSketchEditor(panel, model);
    return;
  }
  if (node === "body") {
    if (model.imported) {
      panel.append(element("h2", "Imported STEP solid"));
      note(
        panel,
        "The original STEP data is embedded in this project. Its coordinates and units are preserved; the viewer fits the camera around its bounds.",
      );
      pair(panel, "Source file", feature.fileName);
      pair(
        panel,
        "STEP data",
        `${number(new TextEncoder().encode(feature.stepText).length / 1024)} KiB`,
      );
      cadStatus(panel);
      const size = displayedSize(model),
        bounds = currentCAD()?.bounds;
      if (size)
        pair(
          panel,
          "Bounding dimensions",
          size.map((n) => `${number(n * 1000)} mm`).join(" × "),
        );
      if (bounds)
        for (const [i, name] of ["Minimum XYZ", "Maximum XYZ"].entries())
          pair(
            panel,
            name,
            bounds[i].map((n) => `${number(n * 1000)} mm`).join(" / "),
          );
      note(
        panel,
        "Material density determines mass. Imported material metadata, colors, assemblies and editable source features are not imported. Edit the assigned material in Material.",
      );
      note(
        panel,
        "Add sketch-based union, subtract or intersect features in Solid operations. Use CAD thermal study to solve on a tetrahedral mesh. Face-level direct edits remain unavailable.",
        "callout",
      );
      panel.append(
        button(
          "Use a new parametric block",
          () => {
            update((s) => {
              const base = s.features[0];
              delete s.sketches;
              s.features = [
                {
                  id: crypto.randomUUID(),
                  bodyId: base.bodyId,
                  type: "block",
                  name: "Parametric block",
                  dimensions: ["60 mm", "20 mm", "10 mm"],
                  materialId: base.materialId,
                },
              ];
            });
            render();
            message(
              "Created a 60 × 20 × 10 mm parametric block. Undo restores the imported solid.",
            );
          },
          "full",
        ),
      );
      return;
    }
    panel.append(element("h2", "Parametric block"));
    note(
      panel,
      "The base rectangular solid. Editing its dimensions regenerates the downstream feature history. Uncut blocks retain their six thermal face references.",
    );
    const f = form(panel, () =>
      update((s) => {
        s.features[0].dimensions = inputs.map((i) => i.value);
        s.features[0].materialId = material.value;
      }),
    );
    const inputs = ["X / LENGTH", "Y / WIDTH", "Z / HEIGHT"].map((label, i) =>
      field(f.el, label, feature.dimensions[i]),
    );
    const material = select(
      f.el,
      "MATERIAL",
      project().source.materials.map((m) => [m.id, m.name]),
      feature.materialId,
    );
    f.finish();
    cadStatus(panel);
    pair(panel, "Feature ID", feature.id);
    note(
      panel,
      "Add union, subtract and intersect features in Solid operations, or cylindrical cuts in Hole features. Create a different base in Sketch & solid, or replace it with Import STEP. Multiple independent bodies and direct face editing remain unavailable.",
      "callout",
    );
    return;
  }
  if (node === "holes") {
    if (model.imported || model.sketchBased) {
      panel.append(element("h2", "Sketch-based cuts"));
      note(
        panel,
        "The original through-hole tool requires a parametric block. For imported or sketch-based solids, use a subtract operation with a circle profile and set its extrusion depth in Solid operations.",
        "callout",
      );
      panel.append(
        button(
          "Add a sketch-based cut",
          () => navigate("Design", "operations"),
          "primary full",
        ),
      );
      return;
    }
    renderHoles(panel, model);
    return;
  }
  if (node === 'volumeMesh') {
    const record=volumeMeshRecord();
    renderVolumeMeshEditor(panel,model,{
      service:volumeMeshService,size:displayedSize(model),cadReady:!!currentCAD(),busy:!!jobs.active||!!volumeMeshPreparing,
      checkService:async()=>{try{const health=await computeHealth();volumeMeshService=`Ready · Gmsh ${health.mesher}`;message('Local mesher is ready.');}catch(error){volumeMeshService='Offline';message(error.message,true);}if(!draft)renderProperties();},
      records:project().volumeMeshes,record,stats:record?volumeMeshInfo(record):null,current:record&&isCurrent(project(),record),cut:volumeMeshCut,
      generate:startVolumeMesh,selectRecord:id=>{if(!flushDraft())return;selectedVolumeMeshId=id;renderProperties();renderViewport();},
      setCut:(axis,fraction)=>{volumeMeshCut.axis=axis;volumeMeshCut.fraction=fraction;renderViewport();},
      exportMesh:()=>{if(!flushDraft())return;download(fileName(`-mesh-${record.id}.msh`),volumeMeshMSH(record.mesh),'text/plain');message('Exported first-order tetrahedra and boundary groups. MSH coordinates are metres.');}
    },{element,field,select,button,note,pair,form,markDraft,number,commit:definition=>update(source=>{
      resolveVolumeMesh(definition,model.values,source.features[0].bodyId);
      const index=source.meshes.findIndex(m=>m.type==='gmsh-tetra');if(index<0)source.meshes.push(definition);else source.meshes[index]=definition;
    })});
    return;
  }
  if (node === "material") {
    renderMaterialLibrary(panel, model);
    return;
  }
  if (["physics", "study", "mesh"].includes(node) && thermalSourceIssue(model)) {
    panel.append(element("h2", model.thermalSupported ? "Study requires constant conductivity" : "Study requires an uncut block"));
    note(panel, thermalSourceIssue(model), "callout");
    if (model.thermalSupported) {
      panel.append(button("Edit material", () => navigate("Design", "material"), "primary full"));
      return;
    }
    note(
      panel,
      "Your original boundary references and study settings are retained. They are not reassigned to imported, sketch-based or drilled faces. Saved results remain available in Analyze with their original geometry.",
    );
    panel.append(
      button(
        "Edit CAD operations",
        () => navigate("Design", "operations"),
        "primary full",
      ),
    );
    return;
  }
  if (node === "physics" || node === "study") {
    panel.append(element("h2", "Steady thermal study"));
    note(
      panel,
      "Assign temperature or convection to each end face. The remaining four faces are insulated.",
    );
    const physics = project().source.physics[0];
    const f = form(panel, () =>
      update((s) => {
        const p = s.physics[0],
          a = Number(axis.value);
        p.boundaries = boundaryInputs.map((input, side) => ({
          entityId: faceId(feature.bodyId, a, side), type: input.type.value,
          ...(input.type.value === "temperature" ? { expression: input.temperature.value }
            : { ambient: input.temperature.value, coefficient: input.coefficient.value }),
        }));
        p.heatGeneration = source.value;
      }),
    );
    const axis = select(
      f.el,
      "CONDUCTION AXIS",
      [
        ["0", "X · length"],
        ["1", "Y · width"],
        ["2", "Z · height"],
      ],
      String(model.axis),
    );
    const boundaryInputs = physics.boundaries.map((boundary, side) => {
      const label = side ? "MAXIMUM" : "MINIMUM", group = element("fieldset", undefined, "thermal-boundary");
      group.append(element("legend", `${side ? "Maximum" : "Minimum"} face`)); f.el.append(group);
      const type = select(group, `${label} FACE CONDITION`, [["temperature", "Prescribed temperature"], ["convection", "Convection to ambient"]], boundary.type);
      const temperature = field(group, `${label} FACE TEMPERATURE`, boundary.expression ?? boundary.ambient);
      const coefficient = field(group, `${label} HEAT-TRANSFER COEFFICIENT`, boundary.coefficient ?? "20 W/(m^2*K)");
      const sync = () => {
        const convection = type.value === "convection";
        temperature.parentElement.firstChild.textContent = `${label} ${convection ? "AMBIENT TEMPERATURE" : "FACE TEMPERATURE"}`;
        coefficient.parentElement.hidden = !convection;
        coefficient.disabled = !convection;
      };
      type.onchange = sync; sync();
      return { type, temperature, coefficient };
    });
    const source = field(f.el, "UNIFORM HEAT GENERATION", physics.heatGeneration);
    f.el.append(
      button("Use selected face pair", () => {
        if (!selectedFace) throw Error("Select a face in the viewport first.");
        axis.value = selectedFace.axis;
        markDraft();
      }),
    );
    f.finish();
    pair(panel, "Method", "3D cell-centred finite volume");
    pair(panel, "Solver", "Conjugate gradient / Jacobi");
    pair(panel, "Relative tolerance", "1 × 10⁻¹⁰");
    note(
      panel,
      "Select a face in the viewport or choose the axis above. Convection uses q″ = h(Tsurface − Tambient), with positive heat leaving the solid. Enter h in W/(m^2*K); it may reference a global parameter.",
    );
    note(
      panel,
      "The convection coefficient is a specified input, not computed from airflow. Radiation, contact, transient studies and convection on the four side faces are unavailable.",
      "callout",
    );
    return;
  }
  if (node === "mesh") {
    panel.append(element("h2", "Volume mesh"));
    note(
      panel,
      "Uniform hexahedral control volumes. Mesh lines show the surface of the volume discretization.",
    );
    const mesh = meshInfo(project().source),
      f = form(panel, () =>
        update((s) => {
          s.meshes[0].cells = inputs.map((i) => Number(i.value));
        }),
      );
    const selected =
      Object.keys(PRESETS).find(
        (k) => JSON.stringify(PRESETS[k]) === JSON.stringify(model.cells),
      ) || "Custom";
    const preset = select(
      f.el,
      "PRESET",
      [...Object.keys(PRESETS).map((k) => [k, k]), ["Custom", "Custom"]],
      selected,
    );
    const group = element("div", undefined, "numbers");
    f.el.append(group);
    const inputs = ["X CELLS", "Y CELLS", "Z CELLS"].map((label, i) => {
      const input = field(group, label, model.cells[i], "number");
      input.min = 2;
      input.max = 64;
      input.step = 1;
      input.required = true;
      input.oninput = () => {
        preset.value = "Custom";
      };
      return input;
    });
    preset.onchange = () => {
      if (PRESETS[preset.value])
        inputs.forEach((el, i) => {
          el.value = PRESETS[preset.value][i];
        });
    };
    f.finish();
    pair(panel, "Volume cells", mesh.count.toLocaleString());
    pair(panel, "Grid vertices", mesh.nodes.toLocaleString());
    pair(
      panel,
      "Cell size",
      mesh.spacing.map((n) => `${number(n * 1000, 3)} mm`).join(" × "),
    );
    pair(
      panel,
      "Mesh state",
      meshArtifact?.fingerprint === fingerprint(project().source)
        ? "Generated for current inputs"
        : "Preview · generate or solve",
    );
    note(
      panel,
      "Maximum 32,768 volume cells. Local refinement, curved boundaries and adaptive meshes are unavailable. Mesh convergence should be checked by solving at finer resolutions.",
    );
    panel.append(button("Check mesh convergence", () => navigate("Simulate", "convergence"), "full"));
    return;
  }
  if (node === "results") renderResults(panel);
}
function renderMaterialLibrary(panel, model) {
  panel.append(element("h2", "Material library"));
  note(panel, "Included values are illustrative. Record the grade, conditions and data source for your own materials.");
  const materials = project().source.materials, assigned = model.source.features[0].materialId;
  if (!materials.some(m => m.id === selectedMaterialId)) selectedMaterialId = assigned;
  const id = selectedMaterialId, material = materials.find(m => m.id === id);
  const picker = select(panel, "LIBRARY MATERIAL", materials.map(m => [m.id, `${m.name}${m.id === assigned ? " · assigned to body" : ""}`]), id);
  picker.onchange = () => {
    const next = picker.value;
    if (!flushDraft()) { picker.value = id; return; }
    selectedMaterialId = next; renderProperties();
  };
  if (id === assigned) note(panel, "Assigned to the current body.");
  else panel.append(button("Assign to body", () => {
    if (!flushDraft()) return;
    update(s => { s.features[0].materialId = id; }); render();
  }, "primary full"));
  renderMaterialEditor(panel, material, model.values, { element, field, select, button, note, form, markDraft,
    commit: next => update(s => { s.materials[s.materials.findIndex(m => m.id === id)] = next; }) });
  panel.append(button("Duplicate material", () => {
    if (!flushDraft()) return;
    const nextId = crypto.randomUUID();
    update(s => { const base = s.materials.find(m => m.id === id); s.materials.push({ ...clone(base), id: nextId, name: `${base.name.slice(0, 150)} copy` }); });
    selectedMaterialId = nextId; render();
    message("Created an independent library copy. Edit it, then assign it to the body when ready.");
  }, "full"));
  const remove = button("Remove from library", () => {
    if (!flushDraft()) return;
    update(s => { if (s.features[0].materialId === id) throw Error("Assign another material before removing this one."); s.materials = s.materials.filter(m => m.id !== id); });
    selectedMaterialId = null;
  selectedFemId=null;selectedSurface=null;femRange=null;selectedStructuralId=null;structuralRange=null;structuralDeformation=0;selectedModalId=null;modalMode=0;modalPhase=1;modalViewCache=null;selectedElectricId=null;electricOutput="potential";selectedHarmonicId=null;harmonicIndex=0;harmonicPhase=0;harmonicScale=1;harmonicViewCache=null;
  selectedVolumeMeshId = null;
  volumeMeshViewCache=null; render();
  }, "full");
  remove.disabled = id === assigned; remove.title = id === assigned ? "Assign another material before removing this one." : "Undo restores the material."; panel.append(remove);
  panel.append(button("Export material JSON", () => {
    if (!flushDraft()) return;
    const current = validateSource(project().source), source = current.source.materials.find(m => m.id === id);
    download(fileName("-material.json"), JSON.stringify(materialSnapshot(source, current.values), null, 2));
    message("Exported a portable material snapshot with resolved SI values. Project JSON retains parameter expressions.");
  }, "full"));
  const file = element("input"); file.type = "file"; file.accept = ".json,application/json"; file.hidden = true;
  let guard;
  file.onchange = () => attempt(async () => {
    const selected = file.files?.[0]; if (!selected) return;
    if (selected.size > 512 * 1024) throw Error("Material files must be at most 512 KiB.");
    const imported = importMaterialSnapshot(JSON.parse(await selected.text()));
    if (!guard?.()) throw Error("The project changed during import. Select the material file again.");
    update(s => { s.materials.push(imported); }); selectedMaterialId = imported.id; render();
    message("Imported material into the library. Assign it to the body when ready.");
  });
  panel.append(file, button("Import material JSON", () => { if (!flushDraft()) return; guard = unchangedProject(); file.value = ""; if (!file.isConnected) panel.append(file); file.click(); }, "full"));
  note(panel, "Material snapshots contain resolved SI values and source notes. Project files preserve the original parameter expressions. Up to 32 materials per project.");
}
function renderResults(panel) {
  panel.append(element("h2", "Solution inspector"));
  const r = result();
  if (!r) {
    note(
      panel,
      !thermalSourceIssue(validateSource(project().source))
        ? "No solutions yet. Set the thermal boundaries and run Solve thermal."
        : "No saved solutions. The current geometry or conductivity is unsupported by the block thermal solver. Inspect its requirements in Simulate.",
    );
    return;
  }
  const picker = select(
    panel,
    "SAVED SOLUTION",
    project().results.map((s, i) => [
      s.id,
      `${i + 1}. Revision ${s.provenance.revision} · ${new Date(s.provenance.createdAt).toLocaleTimeString()}`,
    ]),
    r.id,
  );
  picker.onchange = () => {
    selectedResultId = picker.value;
    resultRange = null;
    render();
  };
  const current = isCurrent(project(), r),
    sum = summarize(r),
    status = !r.verified
      ? "Imported · unverified"
      : current
        ? "Current inputs"
        : "Outdated inputs";
  panel.append(
    element(
      "span",
      status,
      `result-status${current && r.verified ? "" : " stale"}`,
    ),
  );
  pair(panel, "Minimum temperature", `${celsius(sum.min)} °C`);
  pair(panel, "Maximum temperature", `${celsius(sum.max)} °C`);
  pair(panel, "Surface / min face", `${celsius(sum.boundaryTemperatures[0])} °C`);
  pair(panel, "Surface / max face", `${celsius(sum.boundaryTemperatures[1])} °C`);
  pair(panel, "Heat out / min face", `${number(sum.heatOut[0])} W`);
  pair(panel, "Heat out / max face", `${number(sum.heatOut[1])} W`);
  pair(panel, "Generated heat", `${number(sum.generatedHeat)} W`);
  pair(panel, "Energy imbalance", `${number(sum.balanceError, 3)} W`);
  pair(
    panel,
    "Iterations / residual",
    `${r.iterations} / ${r.residual.toExponential(2)}`,
  );
  note(
    panel,
    "Heat out is positive leaving the block. Negative values mean heat entering. The graph averages each cell layer and ends at the solved solid surface temperatures. Ambient temperatures are not solid extrema.",
  );
  panel.append(
    button(
      "Export temperature profile CSV",
      () => {
        const rows = [
          "position_m,temperature_K,temperature_C",
          ...sum.profile.map(([x, t]) => `${x},${t},${t - 273.15}`),
        ];
        download(
          fileName(`-r${r.provenance.revision}-profile.csv`),
          rows.join("\n"),
          "text/csv",
        );
      },
      "full",
    ),
  );
  panel.append(element("h3", "Temperature probe"));
  const probe = element("div", undefined, "numbers");
  panel.append(probe);
  const coords = ["X / mm", "Y / mm", "Z / mm"].map((label, i) =>
    field(probe, label, String(sum.model.size[i] * 500), "number"),
  );
  const output = element(
    "p",
    "Enter a point inside the solved geometry.",
    "note",
  );
  panel.append(
    button(
      "Read probe",
      () => {
        if (coords.some((i) => !i.value.trim()))
          throw Error("Enter all three probe coordinates.");
        const t = sampleTemperature(
          r,
          coords.map((i) => Number(i.value) * 0.001),
        );
        output.textContent = `${number(t - 273.15, 7)} °C (${number(t, 7)} K) · revision ${r.provenance.revision}`;
      },
      "full",
    ),
    output,
  );
  panel.append(element("h3", "Legend range"));
  const range = resultRange || [
    sum.min,
    sum.max === sum.min ? sum.max + 1 : sum.max,
  ];
  const f = form(
    panel,
    () => {
      const low = Number(lo.value) + 273.15,
        high = Number(hi.value) + 273.15;
      if (
        !lo.value.trim() ||
        !hi.value.trim() ||
        !Number.isFinite(low) ||
        !Number.isFinite(high) ||
        low >= high
      )
        throw Error("Enter a legend maximum greater than its minimum.");
      resultRange = [low, high];
      renderViewport();
    },
    "Apply display range",
    true,
  );
  const lo = field(f.el, "MINIMUM / °C", range[0] - 273.15, "number"),
    hi = field(f.el, "MAXIMUM / °C", range[1] - 273.15, "number");
  f.finish();
  const details = element("details"),
    summary = element("summary", "Reproducibility record"),
    pre = element("pre", JSON.stringify(r.provenance, null, 2));
  details.append(summary, pre);
  panel.append(details);
  note(
    panel,
    "This record includes the original dimensions, parameters, material, geometric boundaries, mesh settings and solver settings. Imported results remain unverified until you solve again.",
  );
}
function renderOperations(panel, model) {
  panel.append(element("h2", "Solid operation history"));
  note(panel, "Build on the current body with sketch tools and edge treatments. Every enabled stage must remain one closed solid.");
  const editEdges = (feature,kind) => {
    disposeEdgeEditor = renderEdgeEditor(panel,model.source,feature,kind,{element,field,button,note,form,markDraft,
      getSource:()=>project().source,currentArtifact:currentCAD,
      selectionActive:value=>{edgeSelectionActive=value;},
      preview:(value,refresh=true)=>{edgePreview=value;if(refresh)renderViewport();},
      cancel:()=>{draft=false;newEdgeKind=null;$("saveState").textContent=saved&&store?'Saved on this device':'Export to save';message('Unapplied edge edits discarded.');render();},
      commit:value=>{update(s=>{if(feature)s.features[s.features.findIndex(f=>f.id===feature.id)]=value;else s.features.push(value);});selectedOperationId=value.id;newEdgeKind=null;},
    });
  };
  if(newEdgeKind){editEdges(null,newEdgeKind);return;}
  const addSection = element("div", undefined, "operation-add");
  addSection.append(element("h3", "Add a sketch tool"));
  const combine = select(addSection, "NEW BOOLEAN OPERATION", BOOLEAN_OPERATIONS, "subtract");
  const add = button("Add solid operation", () => {
    if (!flushDraft()) return;
    const bounds = currentCAD()?.bounds;
    update((s) => { selectedOperationId = addSketchOperation(s, combine.value, bounds); });
    sketchMode = false; selectedFace = null; render();
  }, "primary full");
  add.disabled = !currentCAD() || model.source.features.length >= 25;
  addSection.append(add); note(addSection, "Starts from the current solid bounds; no face attachment. Up to 24 operations, including eight block holes.");
  panel.append(addSection);
  const treatments=element('div',undefined,'operation-controls');
  for(const kind of EDGE_KINDS){const b=button(`New ${kind}`,()=>{if(!flushDraft())return;newEdgeKind=kind;sketchMode=false;render();});b.disabled=!currentCAD()||model.source.features.length>=25;treatments.append(b);}
  panel.append(treatments);
  const operations = model.source.features.slice(1);
  let selected = operations.find((f) => f.id === selectedOperationId) || operations.at(-1);
  selectedOperationId = selected?.id || null;
  if (selected) {
    const picker = select(panel, "HISTORY FEATURE", operations.map((f, i) => [f.id, `${i + 1}. ${f.name}${f.suppressed ? " · suppressed" : ""}`]), selected.id);
    picker.onchange = () => { if (!flushDraft()) return; selectedOperationId = picker.value; render(); };
    const controls = element("div", undefined, "operation-controls");
    controls.append(button(selected.suppressed ? "Enable feature" : "Suppress feature", () => {
      if (!flushDraft()) return; update((s) => { const f = s.features.find((f) => f.id === selected.id); f.suppressed = !f.suppressed; }); render();
    }));
    for (const [offset, label] of [[-1, "Move earlier"], [1, "Move later"]]) {
      const b = button(label, () => { if (!flushDraft()) return; update((s) => moveFeature(s, selected.id, offset)); render(); });
      b.disabled = offset === -1 ? operations[0].id === selected.id : operations.at(-1).id === selected.id; controls.append(b);
    }
    controls.append(button("Remove feature", () => {
      if (!flushDraft()) return; update((s) => removeFeature(s, selected.id)); selectedOperationId = null; render();
    }));
    panel.append(controls);
    if (selected.type === "through-hole") {
      note(panel, "This existing cylindrical cut uses the base block dimensions. Its position in this history determines which earlier additions it cuts.");
      panel.append(button("Edit hole dimensions", () => navigate("Design", "holes"), "full"));
    } else if(EDGE_KINDS.includes(selected.type)) {
      editEdges(selected,selected.type);cadStatus(panel);
    } else {
      const reuse = select(panel, "REFERENCED SKETCH", model.source.sketches.map((sk) => [sk.id, sk.name]), selected.sketchId);
      reuse.onchange = () => { if (!flushDraft()) return; update((s) => rebindSketch(s, selected.id, reuse.value)); render(); };
      renderSketchEditor(panel, model, selected.id);
    }
  } else note(panel, "No downstream operations yet. Add a sketch tool or edge treatment above.");
  if (!selected || selected.type === "through-hole") cadStatus(panel);
}
function renderSketchEditor(panel, model, featureId = model.source.features[0].id) {
  const base = model.source.features.find((f) => f.id === featureId), featureIndex = model.source.features.indexOf(base);
  const hasSketch = ["extrude", "revolve"].includes(base?.type);
  panel.append(element("h2", hasSketch ? "Sketch & solid" : "Create a profile solid"));
  if (!hasSketch) {
    note(panel, "Create a dimensioned 2D profile, then extrude or revolve it with the CAD kernel. This replaces the current base solid and downstream features as one undoable edit. Saved solutions and named versions keep their original inputs.");
    const kind = select(panel, "STARTING PROFILE", [["rectangle", "Rectangle"], ["circle", "Circle"], ["ellipse", "Ellipse"], ["polygon", "Polygon / L bracket"], ["constrained", "Constrained rectangle"]], "rectangle");
    panel.append(button("Create sketch-based solid", () => {
      if (!flushDraft()) return;
      update((s) => {
        const base = s.features[0], sk = defaultSketch(crypto.randomUUID(), kind.value);
        s.sketches = [sk];
        s.features = [{ id: crypto.randomUUID(), bodyId: base.bodyId, type: "extrude", name: "Profile extrusion", sketchId: sk.id, distance: "10 mm", materialId: base.materialId }];
      });
      selectedFace = null; sketchMode = true; render();
    }, "primary full"));
    note(panel, "Profiles support rectangles, circles, ellipses, polygons and constrained line/circle geometry. Arcs, splines and multiple profile loops remain unavailable. Add downstream features from Solid operations.", "callout");
    return;
  }
  const original = model.source.sketches.find((sk) => sk.id === base.sketchId);
  note(panel, "Edit unit-aware dimensions or parameter expressions. The referenced sketch regenerates its downstream solid. Polygon points can also be dragged in the 2D view.");
  let readProfile, rows = [];
  const f = form(panel, () => update((s) => {
    s.sketches = s.sketches.map((sk) => sk.id === original.id ? readSketch() : sk);
    s.features[featureIndex] = { id: base.id, bodyId: base.bodyId, name: featureName.value, type: operation.value, sketchId: original.id,
      ...(featureIndex === 0 ? { materialId: base.materialId } : { operation: combine.value, suppressed: base.suppressed }),
      ...(operation.value === "extrude" ? { distance: distance.value } : { angle: angle.value }) };
  }));
  const name = field(f.el, "SKETCH NAME", original.name), featureName = field(f.el, "SOLID FEATURE NAME", base.name);
  const plane = select(f.el, "SKETCH PLANE", [["XY", "XY · normal +Z"], ["XZ", "XZ · normal −Y"], ["YZ", "YZ · normal +X"]], original.plane);
  const origin = original.origin.map((v, i) => field(f.el, `ORIGIN ${"XYZ"[i]}`, v));
  const type = select(f.el, "PROFILE TYPE", [["rectangle", "Rectangle"], ["circle", "Circle"], ["ellipse", "Ellipse"], ["polygon", "Closed polygon"], ["constrained", "Constrained lines & circles"]], original.profile.type);
  const profilePanel = element("div", undefined, "sketch-fields"); f.el.append(profilePanel);
  function fields(profile) {
    profilePanel.replaceChildren(); rows = [];
    if (profile.type === "constrained") {
      readProfile = renderConstraintEditor(profilePanel, profile, {element, field, select, button, markDraft, changed: preview, key: original.id});
    } else if (profile.type === "polygon") {
      const pointList = element("div"); profilePanel.append(pointList);
      const addRow = (point) => {
        const group = element("fieldset", undefined, "sketch-point-row");
        group.append(element("legend", `Point ${rows.length + 1}`));
        const u = field(group, "U", point.position[0]), v = field(group, "V", point.position[1]);
        const row = { id: point.id, u, v, group }; rows.push(row);
        group.append(button("Remove point", () => { rows.splice(rows.indexOf(row), 1); group.remove(); rows.forEach((r, i) => r.group.querySelector("legend").textContent = `Point ${i + 1}`); markDraft(); preview(); }));
        pointList.append(group);
      };
      profile.points.forEach(addRow);
      profilePanel.append(button("Add polygon point", () => {
        if (rows.length >= 64) throw Error("A polygon supports at most 64 points.");
        addRow({ id: crypto.randomUUID(), position: ["0 mm", "40 mm"] }); markDraft(); preview();
      }, "full"));
      readProfile = () => ({ type: "polygon", points: rows.map((r) => ({ id: r.id, position: [r.u.value, r.v.value] })) });
    } else if (profile.type === "rectangle") {
      const corner = profile.corner.map((v, i) => field(profilePanel, `CORNER ${"UV"[i]}`, v));
      const width = field(profilePanel, "PROFILE WIDTH", profile.width), height = field(profilePanel, "PROFILE HEIGHT", profile.height);
      readProfile = () => ({ type: "rectangle", corner: corner.map((i) => i.value), width: width.value, height: height.value });
    } else {
      const center = profile.center.map((v, i) => field(profilePanel, `CENTER ${"UV"[i]}`, v));
      const radiusU = field(profilePanel, profile.type === "circle" ? "RADIUS" : "U RADIUS", profile.radius || profile.radiusU);
      const radiusV = profile.type === "ellipse" ? field(profilePanel, "V RADIUS", profile.radiusV) : null;
      readProfile = () => ({ type: profile.type, center: center.map((i) => i.value), ...(radiusV ? { radiusU: radiusU.value, radiusV: radiusV.value } : { radius: radiusU.value }) });
    }
  }
  fields(original.profile);
  const combine = featureIndex ? select(f.el, "BOOLEAN OPERATION", BOOLEAN_OPERATIONS, base.operation) : null;
  const operation = select(f.el, "SOLID OPERATION", [["extrude", "Extrude along plane normal"], ["revolve", "Revolve about sketch V axis"]], base.type);
  const distance = field(f.el, "EXTRUSION DISTANCE", base.distance || "10 mm"), angle = field(f.el, "REVOLUTION ANGLE", base.angle || "360 deg");
  function readSketch() { return { id: original.id, name: name.value, plane: plane.value, origin: origin.map((i) => i.value), profile: readProfile() }; }
  function preview() {
    distance.parentElement.hidden = operation.value !== "extrude"; angle.parentElement.hidden = operation.value !== "revolve";
    renderSketchPreview($("sketchPreview"), readSketch(), model.values, operation.value, (index, point) => {
      rows[index].u.value = `${point[0]} mm`; rows[index].v.value = `${point[1]} mm`; markDraft(); preview();
    });
  }
  const profileDrafts = { [original.profile.type]: original.profile };
  let previousType = original.profile.type;
  type.onchange = () => { profileDrafts[previousType] = readProfile(); previousType = type.value; fields(profileDrafts[type.value] || defaultSketch(original.id, type.value).profile); preview(); };
  f.el.addEventListener("input", preview); f.el.addEventListener("change", preview);
  f.finish(); preview();
  cadStatus(panel);
  pair(panel, "Sketch reference", original.id);
  const users = model.source.features.filter((f) => f.sketchId === original.id);
  pair(panel, "Used by", users.map((f) => f.name).join(", "));
  if (users.length > 1) {
    note(panel, "This sketch is shared. Editing its profile or placement regenerates every feature listed above.", "callout");
    panel.append(button("Make sketch independent", () => { if (!flushDraft()) return; update((s) => detachSketch(s, base.id)); render(); }, "full"));
  }
  note(panel, "Coordinate profiles use explicit dimensions. Constrained lines & circles use driving constraints, fixed points and movable seed geometry. Extrusion accepts negative distance; revolution stays on the positive U side and rotates 0.01–360° around V. Thermal solving still requires an uncut base block.", "callout");
  if (featureIndex === 0) panel.append(button("Use a new parametric block", () => {
    if (!flushDraft()) return;
    update((s) => { delete s.sketches; s.features = [{ id: crypto.randomUUID(), bodyId: base.bodyId, type: "block", name: "Parametric block", dimensions: ["60 mm", "20 mm", "10 mm"], materialId: base.materialId }]; });
    node = "body"; selectedFace = null; render();
  }, "full"));
}
function renderHoles(panel, model) {
  panel.append(element("h2", "Hole features"));
  note(
    panel,
    "Cylindrical Boolean cuts span the original base block along X, Y or Z. Dimensions and center offsets accept parameter equations. Later additions are not automatically cut; edit their order in Solid operations.",
  );
  const rows = [];
  if (model.holes.length) {
    const f = form(
      panel,
      () =>
        update((s) => {
          const edits = new Map(rows.map((r) => [r.feature.id, {
            id: r.feature.id, bodyId: s.features[0].bodyId, type: "through-hole", name: r.name.value.trim(),
            axis: Number(r.axis.value), center: r.center.map((i) => i.value), diameter: r.diameter.value, suppressed: r.suppressed.checked,
          }]));
          s.features = s.features.flatMap((f) => f.type === "through-hole" ? (edits.has(f.id) ? [edits.get(f.id)] : []) : [f]);
        }),
      "Apply hole features",
    );
    project()
      .source.features.filter((f) => f.type === "through-hole")
      .forEach((feature, index) => {
        const group = element("fieldset", undefined, "hole-feature");
        group.append(element("legend", `${index + 1}. ${feature.name}`));
        f.el.append(group);
        const name = field(group, "FEATURE NAME", feature.name);
        name.maxLength = 160;
        const axis = select(
          group,
          "HOLE AXIS",
          [
            ["0", "X · through length"],
            ["1", "Y · through width"],
            ["2", "Z · through height"],
          ],
          String(feature.axis),
        );
        const center = feature.center.map((value, i) =>
          field(group, `CENTER ${"XYZ"[model.holes[index].plane[i]]}`, value),
        );
        axis.onchange = () => {
          const plane = [0, 1, 2].filter((a) => a !== Number(axis.value));
          center.forEach((input, i) => {
            input.parentElement.firstChild.textContent = `CENTER ${"XYZ"[plane[i]]}`;
          });
        };
        const diameter = field(group, "DIAMETER", feature.diameter);
        const suppressed = field(group, "Suppress this hole", "", "checkbox");
        suppressed.checked = feature.suppressed;
        suppressed.parentElement.classList.add("check-field");
        rows.push({ feature, name, axis, center, diameter, suppressed });
        group.append(
          button("Remove hole", () => {
            // Remove from the draft first, so an invalid hole can still be removed.
            rows.splice(
              rows.findIndex((r) => r.feature.id === feature.id),
              1,
            );
            group.remove();
            markDraft();
            f.el.requestSubmit();
          }),
        );
        note(group, `ID · ${feature.id}`, "feature-id");
      });
    f.finish();
  }
  const add = button(
    "＋ Add through-hole",
    () => {
      if (!flushDraft()) return;
      update((s) => {
        const resolved = validateSource(s);
        s.features.push({
          id: crypto.randomUUID(),
          bodyId: s.features[0].bodyId,
          type: "through-hole",
          name: `Hole ${s.features.length}`,
          axis: 2,
          center: [
            `(${s.features[0].dimensions[0]}) / 2`,
            `(${s.features[0].dimensions[1]}) / 2`,
          ],
          diameter: `${Number((Math.min(...resolved.size.slice(0, 2)) * 250).toPrecision(8))} mm`,
          suppressed: false,
        });
      });
      selectedFace = null;
      render();
    },
    "primary full",
  );
  add.disabled = model.holes.length >= 8 || model.source.features.length >= 25;
  panel.append(add);
  cadStatus(panel);
  note(
    panel,
    "Centers are measured from the block's minimum corner in the two axes perpendicular to the hole. Keep each hole inside the side walls. Up to eight holes may intersect; the kernel computes their union when cutting.",
  );
  note(panel, THERMAL_GEOMETRY_LIMIT, "callout");
}
function renderElectricProperties(panel,model){
  const r=electricResult();renderElectricEditor(panel,model,{analyze:node==='electricResults',mesh:femMesh(),issue:electricReadiness(),selected:selectedSurface,busy:!!jobs.active||!!volumeMeshPreparing,results:project().electricResults,result:r,current:r&&isCurrent(project(),r),field:electricOutput,cut:electricCut,
    setup:()=>navigate('Simulate','electricStudy'),mesher:()=>navigate('Simulate','volumeMesh'),material:()=>{selectedMaterialId=project().source.features[0].materialId;navigate('Design','material');},analyzeResults:()=>navigate('Analyze','electricResults'),solve:startElectric,selectSurface:selectFemSurface,
    chooseResult:id=>{selectedElectricId=id;renderProperties();renderViewport();renderBottom();},setField:value=>{electricOutput=value;renderProperties();renderViewport();},setCut:(axis,fraction)=>{electricCut.axis=axis;electricCut.fraction=fraction;renderViewport();},
    exportCSV:()=>download(fileName('-electrical-potential.csv'),electricCSV(r),'text/csv'),exportVTK:()=>download(fileName('-electrical.vtk'),electricVTK(r),'text/plain')
  },{element,field,select,button,note,pair,form,number,commit:mutator=>{update(mutator);render();}});
}
function renderElectricViewport(){
  const r=node==='electricResults'?electricResult():null,mesh=r?.mesh||femMesh()?.mesh;
  $('showMesh').disabled=false;$('toggleSketch').hidden=true;$('sketchPreview').hidden=true;document.querySelector('.viewport-panel').classList.remove('sketch-mode');
  $('viewportMode').textContent=r?`ANALYZE / DC CONDUCTION · SOURCE R${r.provenance.revision}`:'SIMULATE / DC CONDUCTION';$('legend').hidden=!r;
  if(!mesh){$('viewportTitle').textContent='DC conduction';$('modelMetrics').replaceChildren();$('resultBanner').hidden=false;$('resultBanner').textContent='Generate a compatible tetrahedral mesh to assign electrical terminals.';$('selectionLabel').textContent='No compatible mesh';viewer?.setModel({size:[1,1,1],empty:true});return;}
  const selected=selectedSurface??mesh.boundary[0].tag,display=r?electricDisplay(r,electricCut,electricOutput):null,artifact=display?.artifact||femDisplay(mesh,{axis:0,fraction:1},null,'temperature',null,selected);
  $('viewportTitle').textContent=display?.label||'Select electrical terminal surfaces';
  if(display){$('legendTitle').textContent=`${display.label.toUpperCase()} / ${display.unit}`;$('legendMin').textContent=number(display.min);$('legendMax').textContent=number(display.max);}
  $('modelMetrics').replaceChildren(...(r?[['Joule heat',`${number(r.solution.joulePower)} W`],['Current balance',`${number(r.solution.currentBalance)} A`]]:[['Tetrahedra',(mesh.tetrahedra.length/4).toLocaleString()],['Selected surface',selected]]).map(([label,value])=>{const e=element('div',value,'metric');e.prepend(element('small',label));return e;}));
  const warnings=r?[!isCurrent(project(),r)&&'OUTDATED · saved source geometry.',!r.verified&&'Imported result · unverified.'].filter(Boolean):[];$('resultBanner').hidden=!warnings.length;$('resultBanner').textContent=warnings.join(' ');$('selectionLabel').textContent=r?`${artifact.visibleCells.toLocaleString()} visible cells · ${Math.round(electricCut.fraction*100)}% cutaway`:'Click a surface to assign an electrical terminal';
  $('viewport').setAttribute('aria-label',r?'DC electrical field. Drag to orbit; arrow keys rotate, plus and minus zoom.':'Electrical surface selection. Click a face or select its surface; drag to orbit.');
  viewer?.setModel({size:artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]),cad:artifact,field:!!r,showMesh:$('showMesh').checked,onSurfaceSelect:r?null:tag=>attempt(()=>selectFemSurface(tag))});
}
function startElectric(){
  if(!flushDraft())return;if(jobs.active||volumeMeshPreparing)throw Error('Wait for the current job or cancel it.');const mesh=femMesh();if(!mesh)throw Error('Generate a verified compatible tetrahedral mesh.');
  const snapshot=clone(project()),request=electricRequest(validateSource(snapshot.source),mesh.mesh);electricJob={snapshot,mesh:clone(mesh)};jobs.start('electric-tetra',snapshot,{request});message('Solving DC conduction in Rust. You can continue editing.');
}

function stopHarmonicAnimation(){harmonicAnimation.stop();if($('animateHarmonic'))$('animateHarmonic').textContent='Play harmonic animation';}
function savedHarmonicRequest(r){return harmonicRequest(validateSource(r.provenance.source),r.mesh);}
function currentHarmonicDisplay(r){const key=JSON.stringify([harmonicIndex,harmonicCut,harmonicScale,harmonicField]);if(harmonicViewCache?.record!==r||harmonicViewCache?.key!==key)harmonicViewCache={record:r,key,display:createHarmonicDisplay(r,harmonicIndex,savedHarmonicRequest(r),harmonicCut,harmonicScale,harmonicField)};return harmonicViewCache.display;}
function drawHarmonicPhase(phase){
  if(node!=='harmonicResults'||!harmonicResult()){stopHarmonicAnimation();return;}
  harmonicPhase=phase%(2*Math.PI);const display=currentHarmonicDisplay(harmonicResult()),artifact=display.setPhase(phase);
  viewer?.setModel({size:artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]),cad:artifact,displayRadius:display.displayRadius,field:true,showMesh:$('showMesh').checked});
  $('selectionLabel').textContent=`${artifact.visibleCells.toLocaleString()} visible cells · cycle phase ${number(harmonicPhase*180/Math.PI,3)}° · displacement ×${number(harmonicScale)}`;
}
function chooseHarmonicFrequency(index){stopHarmonicAnimation();harmonicIndex=index;harmonicPhase=0;harmonicScale=1;renderProperties();renderViewport();renderBottom();}
function renderHarmonicProperties(panel,model){
  const r=harmonicResult();renderHarmonicEditor(panel,model,{analyze:node==='harmonicResults',mesh:femMesh(),issue:harmonicReadiness(),selected:selectedSurface,busy:!!jobs.active||!!volumeMeshPreparing,
    results:project().harmonicResults,result:r,request:r?savedHarmonicRequest(r):null,current:r&&isCurrent(project(),r),index:harmonicIndex,field:harmonicField,scale:harmonicScale,rate:harmonicRate,phase:harmonicPhase,playing:harmonicAnimation.running,cut:harmonicCut,
    setup:()=>navigate('Simulate','harmonicStudy'),mesher:()=>navigate('Simulate','volumeMesh'),material:()=>{selectedMaterialId=project().source.features[0].materialId;navigate('Design','material');},analyzeResults:()=>navigate('Analyze','harmonicResults'),solve:startHarmonic,selectSurface:selectFemSurface,
    chooseResult:id=>{selectedHarmonicId=id;chooseHarmonicFrequency(0);},chooseFrequency:chooseHarmonicFrequency,setField:value=>{stopHarmonicAnimation();harmonicField=value;renderProperties();renderViewport();},
    setDisplay:(scale,rate)=>{createHarmonicDisplay(r,harmonicIndex,savedHarmonicRequest(r),harmonicCut,scale,harmonicField);if(!Number.isFinite(rate)||rate<.1||rate>3)throw Error('Playback must be 0.1–3 cycles per second.');stopHarmonicAnimation();harmonicScale=scale;harmonicRate=rate;renderProperties();renderViewport();},
    toggleAnimation:()=>{if(harmonicAnimation.running)stopHarmonicAnimation();else harmonicAnimation.start(harmonicRate);renderProperties();},setPhase:phase=>{stopHarmonicAnimation();drawHarmonicPhase(phase);},setCut:(axis,fraction)=>{stopHarmonicAnimation();harmonicCut.axis=axis;harmonicCut.fraction=fraction;renderViewport();},
    exportCSV:()=>download(fileName('-harmonic-response.csv'),harmonicCSV(r,savedHarmonicRequest(r)),'text/csv'),exportVTK:()=>download(fileName(`-harmonic-${r.solution.responses[harmonicIndex].frequency}Hz.vtk`),harmonicVTK(r,harmonicIndex,savedHarmonicRequest(r)),'text/plain')
  },{element,field,select,button,note,pair,form,number,commit:mutator=>{update(mutator);render();}});
}
function renderHarmonicViewport(){
  const r=node==='harmonicResults'?harmonicResult():null,mesh=r?.mesh||femMesh()?.mesh;if(!r)stopHarmonicAnimation();
  $('showMesh').disabled=false;$('toggleSketch').hidden=true;$('sketchPreview').hidden=true;document.querySelector('.viewport-panel').classList.remove('sketch-mode');
  $('viewportMode').textContent=r?`ANALYZE / HARMONIC RESPONSE · SOURCE R${r.provenance.revision}`:'SIMULATE / FORCED VIBRATION';$('legend').hidden=!r;
  if(!mesh){$('viewportTitle').textContent='Harmonic response';$('modelMetrics').replaceChildren();$('resultBanner').hidden=false;$('resultBanner').textContent='Generate a compatible tetrahedral mesh to assign harmonic surfaces.';$('selectionLabel').textContent='No compatible mesh';viewer?.setModel({size:[1,1,1],empty:true});return;}
  const response=r?.solution.responses[harmonicIndex],selected=selectedSurface??mesh.boundary[0].tag,display=r?currentHarmonicDisplay(r):null;
  $('viewportTitle').textContent=response?`${number(response.frequency,7)} Hz · harmonic response`:'Select harmonic load and restraint surfaces';
  $('modelMetrics').replaceChildren(...(r?[['Cycle peak displacement',`${number(display.peak*1e6)} µm`],['Displacement view scale',`×${number(harmonicScale)}`]]:[['Tetrahedra',(mesh.tetrahedra.length/4).toLocaleString()],['Selected surface',selected]]).map(([label,value])=>{const e=element('div',value,'metric');e.prepend(element('small',label));return e;}));
  const warnings=r?[!isCurrent(project(),r)&&'OUTDATED · saved source geometry.',!r.verified&&'Imported sweep · unverified.',display.large&&'Large displacement or strain: the small-strain model may be invalid.'].filter(Boolean):[];$('resultBanner').hidden=!warnings.length;$('resultBanner').textContent=warnings.join(' ');
  $('viewport').setAttribute('aria-label',r?'Complex harmonic displacement. Drag to orbit; arrow keys rotate, plus and minus zoom.':'Harmonic surface selection. Click a face or select its surface; drag to orbit.');
  if(r){$('legendTitle').textContent=`${display.label.toUpperCase()} / ${display.unit}`;$('legendMin').textContent='0';$('legendMax').textContent=number(display.max);drawHarmonicPhase(harmonicPhase);}
  else{const artifact=femDisplay(mesh,{axis:0,fraction:1},null,'temperature',null,selected);$('selectionLabel').textContent='Click a surface to assign a harmonic condition';viewer?.setModel({size:artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]),cad:artifact,field:false,showMesh:$('showMesh').checked,onSurfaceSelect:tag=>attempt(()=>selectFemSurface(tag))});}
}
function startHarmonic(){
  if(!flushDraft())return;if(jobs.active||volumeMeshPreparing)throw Error('Wait for the current job or cancel it.');stopHarmonicAnimation();
  const mesh=femMesh();if(!mesh)throw Error('Generate a verified compatible tetrahedral mesh.');const snapshot=clone(project()),request=harmonicRequest(validateSource(snapshot.source),mesh.mesh);harmonicJob={snapshot,mesh:clone(mesh)};
  jobs.start('harmonic-tetra',snapshot,{request});message('Solving harmonic frequencies in the local compute service. You can continue editing.');
}

function stopModalAnimation(){modalAnimation.stop();if($('animateMode'))$('animateMode').textContent='Play mode animation';}
function currentModalDisplay(r){const key=JSON.stringify([modalMode,modalCut,modalAmplitude]);if(modalViewCache?.record!==r||modalViewCache?.key!==key)modalViewCache={record:r,key,display:createModalDisplay(r,modalMode,modalCut,modalAmplitude)};return modalViewCache.display;}
function drawModalPhase(phase){
  if(node!=='modalResults'||!modalResult()){stopModalAnimation();return;}
  modalPhase=phase;const display=currentModalDisplay(modalResult()),artifact=display.setPhase(phase);
  viewer?.setModel({size:artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]),cad:artifact,displayRadius:display.displayRadius,field:true,showMesh:$('showMesh').checked});
  $('selectionLabel').textContent=`${artifact.visibleCells.toLocaleString()} visible cells · illustrative phase ${number(phase,2)} · peak display ${number(display.distance*1000)} mm`;
}
function chooseModalMode(index){stopModalAnimation();modalMode=index;modalPhase=1;renderProperties();renderViewport();renderBottom();}
function renderModalProperties(panel,model){
  const r=modalResult(),mesh=femMesh();
  renderModalEditor(panel,model,{analyze:node==='modalResults',mesh,issue:modalReadiness(),selected:selectedSurface,busy:!!jobs.active||!!volumeMeshPreparing,
    results:project().modalResults,result:r,current:r&&isCurrent(project(),r),mode:modalMode,amplitude:modalAmplitude,rate:modalRate,phase:modalPhase,playing:modalAnimation.running,cut:modalCut,
    setup:()=>navigate('Simulate','modalStudy'),mesher:()=>navigate('Simulate','volumeMesh'),material:()=>{selectedMaterialId=project().source.features[0].materialId;navigate('Design','material');},analyzeResults:()=>navigate('Analyze','modalResults'),solve:startModal,selectSurface:selectFemSurface,
    chooseResult:id=>{stopModalAnimation();selectedModalId=id;modalMode=0;modalPhase=1;renderProperties();renderViewport();renderBottom();},chooseMode:chooseModalMode,
    setDisplay:(amplitude,rate)=>{createModalDisplay(r,modalMode,modalCut,amplitude);if(!Number.isFinite(rate)||rate<.1||rate>3)throw Error('Animation speed must be 0.1–3 cycles per second.');stopModalAnimation();modalAmplitude=amplitude;modalRate=rate;modalPhase=1;renderProperties();renderViewport();message('Mode display updated. Amplitude and animation speed are illustrative.');},
    toggleAnimation:()=>{if(modalAnimation.running)stopModalAnimation();else if(!r.solution.modes[modalMode].rigid)modalAnimation.start(modalRate);renderProperties();},
    setPhase:phase=>{stopModalAnimation();drawModalPhase(phase);},setCut:(axis,fraction)=>{stopModalAnimation();modalCut.axis=axis;modalCut.fraction=fraction;renderViewport();},
    exportCSV:()=>download(fileName('-natural-frequencies.csv'),modalCSV(r),'text/csv'),exportVTK:()=>download(fileName(`-mode-${modalMode+1}.vtk`),modalVTK(r,modalMode),'text/plain')
  },{element,field,select,button,note,pair,form,number,commit:mutator=>{update(mutator);render();}});
}
function renderModalViewport(){
  const r=node==='modalResults'?modalResult():null,mesh=r?.mesh||femMesh()?.mesh;
  if(!r)stopModalAnimation();
  $('showMesh').disabled=false;$('toggleSketch').hidden=true;$('sketchPreview').hidden=true;document.querySelector('.viewport-panel').classList.remove('sketch-mode');
  $('viewportMode').textContent=r?`ANALYZE / NATURAL MODES · SOURCE R${r.provenance.revision}`:'SIMULATE / EIGENFREQUENCY';$('legend').hidden=!r;
  if(!mesh){$('viewportTitle').textContent='Natural modes';$('modelMetrics').replaceChildren();$('resultBanner').hidden=false;$('resultBanner').textContent='Generate a compatible tetrahedral mesh to assign modal restraints.';$('selectionLabel').textContent='No compatible mesh';viewer?.setModel({size:[1,1,1],empty:true});return;}
  const mode=r?.solution.modes[modalMode],selected=selectedSurface??mesh.boundary[0].tag;
  $('viewportTitle').textContent=mode?`Mode ${modalMode+1} · ${number(mode.frequency,6)} Hz`:'Select modal restraint surfaces';
  $('modelMetrics').replaceChildren(...(mode?[['Mode type',mode.rigid?'Rigid motion':'Elastic vibration'],['Shape normalization','Peak magnitude = 1']]:[['Tetrahedra',(mesh.tetrahedra.length/4).toLocaleString()],['Selected surface',selected]]).map(([label,value])=>{const e=element('div',value,'metric');e.prepend(element('small',label));return e;}));
  const warnings=r?[!isCurrent(project(),r)&&'OUTDATED · saved source geometry.',!r.verified&&'Imported mode set · unverified.',mode.rigid&&'Zero-frequency rigid-body motion.'].filter(Boolean):[];$('resultBanner').hidden=!warnings.length;$('resultBanner').textContent=warnings.join(' ');
  $('viewport').setAttribute('aria-label',r?'Natural mode shape. Drag to orbit; arrow keys rotate, plus and minus zoom.':'Modal restraint surface selection. Click a face or select its surface; drag to orbit.');
  if(r){$('legendTitle').textContent='RELATIVE MODE MAGNITUDE / 1';$('legendMin').textContent='0';$('legendMax').textContent='1';drawModalPhase(modalPhase);}
  else{const artifact=femDisplay(mesh,{axis:0,fraction:1},null,'temperature',null,selected);$('selectionLabel').textContent='Click a surface to assign a modal restraint';viewer?.setModel({size:artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]),cad:artifact,field:false,showMesh:$('showMesh').checked,onSurfaceSelect:tag=>attempt(()=>selectFemSurface(tag))});}
}
function startModal(){
  if(!flushDraft())return;if(jobs.active||volumeMeshPreparing)throw Error('Wait for the current job or cancel it.');stopModalAnimation();
  const mesh=femMesh();if(!mesh)throw Error('Generate a verified compatible tetrahedral mesh.');
  const snapshot=clone(project()),request=modalRequest(validateSource(snapshot.source),mesh.mesh);modalJob={snapshot,mesh:clone(mesh)};
  jobs.start('modal-tetra',snapshot,{request});message('Solving natural modes in the local compute service. You can continue editing.');
}

function renderStructuralProperties(panel,model){
  const r=structuralResult(),mesh=femMesh();
  renderStructuralEditor(panel,model,{analyze:node==='structuralResults',mesh,issue:structuralReadiness(),selected:selectedSurface,busy:!!jobs.active||!!volumeMeshPreparing,
    results:project().structuralResults,result:r,resultModel:r?validateSource(r.provenance.source):null,current:r&&isCurrent(project(),r),field:structuralOutput,range:structuralRange,deformation:structuralDeformation,cut:structuralCut,
    setup:()=>navigate('Simulate','structuralStudy'),mesher:()=>navigate('Simulate','volumeMesh'),material:()=>{selectedMaterialId=project().source.features[0].materialId;navigate('Design','material');},analyzeResults:()=>navigate('Analyze','structuralResults'),
    solve:startStructural,selectSurface:selectFemSurface,chooseResult:id=>{selectedStructuralId=id;structuralRange=null;structuralDeformation=0;renderProperties();renderViewport();renderBottom();},
    setField:value=>{structuralOutput=value;structuralRange=null;renderProperties();renderViewport();},
    setDisplay:(range,deformation)=>{if(!range.every(Number.isFinite)||range[1]<range[0])throw Error('Legend maximum must be at least the minimum.');structuralDisplay(r,structuralCut,structuralOutput,range,deformation);structuralRange=range;structuralDeformation=deformation;renderProperties();renderViewport();message('Structural display updated. Deformation scale changes the view only.');},
    resetDisplay:()=>{structuralRange=null;structuralDeformation=0;renderProperties();renderViewport();message('Structural display restored to the undeformed model.');},
    setCut:(axis,fraction)=>{structuralCut.axis=axis;structuralCut.fraction=fraction;renderViewport();},
    exportCSV:()=>download(fileName('-structural-nodes.csv'),structuralCSV(r),'text/csv'),exportVTK:()=>download(fileName('-structural.vtk'),structuralVTK(r),'text/plain')
  },{element,field,select,button,note,pair,form,number,commit:mutator=>{update(mutator);render();}});
}
function renderStructuralViewport(){
  const r=node==='structuralResults'?structuralResult():null,mesh=r?.mesh||femMesh()?.mesh;
  $('showMesh').disabled=false;$('toggleSketch').hidden=true;$('sketchPreview').hidden=true;document.querySelector('.viewport-panel').classList.remove('sketch-mode');
  $('viewportMode').textContent=r?`ANALYZE / STATIC STRUCTURAL · SOURCE R${r.provenance.revision}`:'SIMULATE / STATIC STRUCTURAL';
  $('legend').hidden=!r;
  if(!mesh){$('viewportTitle').textContent='Static structural';$('modelMetrics').replaceChildren();$('resultBanner').hidden=false;$('resultBanner').textContent='Generate a compatible tetrahedral mesh to assign structural conditions.';$('selectionLabel').textContent='No compatible mesh';viewer?.setModel({size:[1,1,1],empty:true});return;}
  const f=r?structuralField(r,structuralOutput):null,range=structuralRange||(f?fieldRange(f.values):null),selected=selectedSurface??mesh.boundary[0].tag;
  const artifact=r?structuralDisplay(r,structuralCut,structuralOutput,range,structuralDeformation):femDisplay(mesh,{axis:0,fraction:1},null,'temperature',null,selected);
  $('viewportTitle').textContent=f?.label||'Select structural surfaces';
  if(f){$('legendTitle').textContent=`${f.label.toUpperCase()} / ${f.unit}`;$('legendMin').textContent=number(range[0]*f.scale);$('legendMax').textContent=number(range[1]*f.scale);}
  $('modelMetrics').replaceChildren(...(f?[['Minimum',`${number(fieldRange(f.values)[0]*f.scale)} ${f.unit}`],['Maximum',`${number(fieldRange(f.values)[1]*f.scale)} ${f.unit}`]]:[['Tetrahedra',(mesh.tetrahedra.length/4).toLocaleString()],['Selected surface',selected]]).map(([label,value])=>{const e=element('div',value,'metric');e.prepend(element('small',label));return e;}));
  const warnings=r?[!isCurrent(project(),r)&&'OUTDATED · saved source geometry.',!r.verified&&'Imported result · unverified.',(r.solution.maxStrain>.01||r.solution.maxDisplacementRatio>.05)&&'Large strain/deflection for a linear model; nonlinear analysis is needed.'].filter(Boolean):[];
  $('resultBanner').hidden=!warnings.length;$('resultBanner').textContent=warnings.join(' ');$('selectionLabel').textContent=r?`${artifact.visibleCells.toLocaleString()} visible cells · deformation ×${number(structuralDeformation)} (display only)`:'Click a surface to assign a restraint or load';
  $('viewport').setAttribute('aria-label',r?'Structural finite-element field. Drag to orbit; arrow keys rotate, plus and minus zoom.':'Structural surface selection. Click a face or use the surface selector; drag to orbit.');
  viewer?.setModel({size:artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]),cad:artifact,field:!!r,showMesh:$('showMesh').checked,onSurfaceSelect:r?null:tag=>attempt(()=>selectFemSurface(tag))});
}
function startStructural(){
  if(!flushDraft())return;if(jobs.active||volumeMeshPreparing)throw Error('Wait for the current job or cancel it.');
  const mesh=femMesh();if(!mesh)throw Error('Generate a verified compatible tetrahedral mesh.');
  const snapshot=clone(project()),request=structuralRequest(validateSource(snapshot.source),mesh.mesh);structuralJob={snapshot,mesh:clone(mesh)};
  jobs.start('structural-tetra',snapshot,{request});message('Solving static elasticity in Rust. You can continue editing.');
}
function renderFemProperties(panel,model){
  const r=femResult(),mesh=femMesh();
  renderFemEditor(panel,model,{analyze:node==='femResults',mesh,issue:femReadiness(),selected:selectedSurface,busy:!!jobs.active||!!volumeMeshPreparing,
    results:project().femResults,result:r,current:r&&isCurrent(project(),r),field:femOutput,range:femRange,cut:femCut,
    setup:()=>navigate('Simulate','femStudy'),mesher:()=>navigate('Simulate','volumeMesh'),analyzeResults:()=>navigate('Analyze','femResults'),
    solve:startFem,selectSurface:selectFemSurface,chooseResult:id=>{selectedFemId=id;femRange=null;renderProperties();renderViewport();},
    setField:value=>{femOutput=value;femRange=null;renderProperties();renderViewport();},
    setRange:range=>{if(range&&(!range.every(Number.isFinite)||range[1]<=range[0]))throw Error('Legend maximum must exceed minimum.');femRange=range;renderProperties();renderViewport();message(range?'Legend range updated.':'Automatic legend range restored.');},
    setCut:(axis,fraction)=>{femCut.axis=axis;femCut.fraction=fraction;renderViewport();},
    exportCSV:()=>download(fileName('-cad-temperature.csv'),femCSV(r),'text/csv'),
    exportVTK:()=>download(fileName('-cad-thermal.vtk'),femVTK(r),'text/plain')
  },{element,field,select,button,note,pair,form,number,commit:mutator=>{update(mutator);render();}});
}
function renderFemViewport(){
  const record=node==='femResults'?femResult():null,mesh=record?.mesh||femMesh()?.mesh;
  $('showMesh').disabled=false;$('toggleSketch').hidden=true;$('sketchPreview').hidden=true;
  document.querySelector('.viewport-panel').classList.remove('sketch-mode');
  $('viewportMode').textContent=record?`ANALYZE / CAD THERMAL · SOURCE R${record.provenance.revision}`:'SIMULATE / CAD THERMAL';
  $('viewportTitle').textContent=record?{temperature:'Temperature',flux:'Heat-flux magnitude',gradient:'Temperature-gradient magnitude'}[femOutput]:'Select CAD thermal surfaces';
  $('legend').hidden=!record;
  if(!mesh){$('modelMetrics').replaceChildren();$('resultBanner').hidden=false;$('resultBanner').textContent='Generate a compatible tetrahedral mesh to set up CAD thermal boundaries.';$('selectionLabel').textContent='No compatible mesh';viewer?.setModel({size:[1,1,1],empty:true});return;}
  const f=record?femField(record,femOutput):null,range=femRange||(f?fieldRange(f.values):null);
  if(record){$('legendTitle').textContent=`${femOutput==='temperature'?'TEMPERATURE':femOutput==='flux'?'HEAT FLUX':'TEMPERATURE GRADIENT'} / ${f.unit}`;$('legendMin').textContent=number(range[0]+f.offset);$('legendMax').textContent=number(range[1]+f.offset);}
  const selected=selectedSurface??mesh.boundary[0].tag,artifact=femDisplay(mesh,record?femCut:{axis:0,fraction:1},record,femOutput,range,selected);
  $('modelMetrics').replaceChildren(...(record?[['Minimum',`${number(fieldRange(f.values)[0]+f.offset)} ${f.unit}`],['Maximum',`${number(fieldRange(f.values)[1]+f.offset)} ${f.unit}`]]:[['Tetrahedra',(mesh.tetrahedra.length/4).toLocaleString()],['Selected surface',selected]]).map(([label,value])=>{const e=element('div',value,'metric');e.prepend(element('small',label));return e;}));
  const warning=record?[!isCurrent(project(),record)&&'OUTDATED · showing saved inputs.',!record.verified&&'Imported solution · unverified.'].filter(Boolean):[];
  $('resultBanner').hidden=!warning.length;$('resultBanner').textContent=warning.join(' ');
  $('selectionLabel').textContent=record?`${artifact.visibleCells.toLocaleString()} visible tetrahedra · ${Math.round(femCut.fraction*100)}% cutaway`:'Click a surface to select its thermal condition';
  $('viewport').setAttribute('aria-label',record?'CAD thermal field. Drag to orbit; arrow keys rotate, plus and minus zoom.':'CAD thermal surface selection. Click a face or use the CAD surface selector; drag to orbit.');
  viewer?.setModel({size:artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]),cad:artifact,field:!!record,showMesh:$('showMesh').checked,onSurfaceSelect:record?null:tag=>attempt(()=>selectFemSurface(tag))});
}
async function startFem(){
  if(!flushDraft())return;
  if(jobs.active||volumeMeshPreparing)throw Error('Wait for the current compute job or cancel it.');
  const mesh=femMesh();if(!mesh)throw Error('Generate a verified mesh for the current geometry and mesh settings.');
  const snapshot=clone(project()),request=femRequest(validateSource(snapshot.source),mesh.mesh);
  femJob={snapshot,mesh:clone(mesh)};
  jobs.start('thermal-tetra',snapshot,{request});
  message('Solving the CAD thermal field in the local compute service. You can continue editing.');
}
function renderViewport() {
  if(viewingElectric()){stopModalAnimation();stopHarmonicAnimation();renderElectricViewport();return;}
  if(viewingHarmonic()){stopModalAnimation();renderHarmonicViewport();return;}
  stopHarmonicAnimation();
  if(viewingModal()){renderModalViewport();return;}
  stopModalAnimation();
  if(viewingStructural()){renderStructuralViewport();return;}
  if(viewingFem()){renderFemViewport();return;}
  $('legendTitle').textContent='TEMPERATURE / °C';
  const inputPreview = workspace==='Design'&&node==='operations' ? edgePreview : null;
  $("showMesh").disabled=!!inputPreview;
  $("viewport").setAttribute('aria-label',inputPreview
    ? 'Input solid for edge selection. Click visible edges to toggle; drag to orbit. Edge checkboxes are available in properties. Arrow keys rotate, plus and minus zoom, zero resets.'
    : 'Interactive 3D engineering solid. Drag to orbit, scroll to zoom. Uncut block faces can be selected. Arrow keys rotate, plus and minus zoom, zero resets.');
  const sketchFeature = node === "operations" ? project().source.features.find((f) => f.id === selectedOperationId) : project().source.features[0];
  const sketchView = workspace === "Design" && ["sketch", "body", "operations"].includes(node) && ["extrude", "revolve"].includes(sketchFeature?.type);
  $("toggleSketch").hidden = !sketchView;
  $("toggleSketch").textContent = sketchMode ? "View 3D solid" : "Edit 2D profile";
  $("sketchPreview").hidden = !sketchView || !sketchMode;
  document.querySelector(".viewport-panel").classList.toggle("sketch-mode", sketchView && sketchMode);
  const r = workspace === "Analyze" ? result() : null,
    model = validateSource(r ? r.provenance.source : project().source),
    sum = r ? summarize(r) : null;
  if (viewingVolumeMesh() && volumeMeshRecord()) {
    const record=volumeMeshRecord(),info=volumeMeshInfo(record),key=`${record.id}:${volumeMeshCut.axis}:${volumeMeshCut.fraction}`;
    if(volumeMeshViewCache?.record!==record||volumeMeshViewCache.key!==key)volumeMeshViewCache={record,key,artifact:volumeMeshDisplay(record.mesh,volumeMeshCut.axis,volumeMeshCut.fraction)};
    const artifact=volumeMeshViewCache.artifact;
    $('viewportMode').textContent=`SIMULATE / TETRAHEDRAL MESH · SOURCE R${record.provenance.revision}`;
    $('viewportTitle').textContent='CAD volume mesh';$('legend').hidden=true;
    $('showMesh').checked=true;$('showMesh').disabled=true;
    $('modelMetrics').replaceChildren(...[['Tetrahedra',info.elements.toLocaleString()],['Visible cells',artifact.visibleCells.toLocaleString()]].map(([label,value])=>{const e=element('div',value,'metric');e.prepend(element('small',label));return e;}));
    const warning=[!isCurrent(project(),record)&&'OUTDATED — displaying an earlier source mesh.',!record.verified&&'Imported mesh — unverified.',info.poorElements&&`${info.poorElements} low-quality cells.`].filter(Boolean);
    $('resultBanner').hidden=!warning.length;$('resultBanner').textContent=warning.join(' ');
    $('selectionLabel').textContent=`${Math.round(volumeMeshCut.fraction*100)}% cell-centroid cutaway · no field solution`;
    $('viewport').setAttribute('aria-label','Tetrahedral volume mesh with cell-centroid cutaway. Drag to orbit; arrow keys rotate, plus and minus zoom.');
    viewer?.setModel({size:info.bounds[1].map((v,i)=>v-info.bounds[0][i]),cad:artifact,showMesh:true});return;
  }
  const measuredSize = inputPreview ? inputPreview.artifact.bounds[1].map((v,i)=>v-inputPreview.artifact.bounds[0][i]) : displayedSize(model, r ? null : currentCAD());
  const size = measuredSize || [1, 1, 1],
    volume =
      inputPreview ? inputPreview.artifact.volume : r || model.thermalSupported
        ? size.reduce((a, b) => a * b, 1)
        : currentCAD()?.volume;
  const generalCAD = !!inputPreview || !model.thermalSupported;
  $("viewport").classList.toggle("cad-preview", generalCAD);
  $("viewportMode").textContent = r
    ? `ANALYZE / TEMPERATURE · REVISION ${r.provenance.revision}`
    : `${workspace.toUpperCase()} / SOLID`;
  $("viewportTitle").textContent = inputPreview ? inputPreview.title : r
    ? "Steady-state temperature"
    : model.operations.some((op) => !op.suppressed) ? (model.imported ? "Modified STEP solid" : "Parametric feature solid")
    : model.imported
      ? "Imported STEP solid"
      : model.sketchBased ? `${model.operation.type === "extrude" ? "Extruded" : "Revolved"} ${model.sketch.profile.type === "constrained" ? "constrained profile" : model.sketch.profile.type}`
      : generalCAD
        ? "Drilled parametric solid"
        : "Parametric block";
  const metrics = r
    ? [
        ["Minimum", `${celsius(sum.min)} °C`],
        ["Maximum", `${celsius(sum.max)} °C`],
      ]
    : [
        [
          "Dimensions",
          measuredSize
            ? `${size.map((v) => number(v * 1000, 4)).join(" × ")} mm`
            : "Awaiting CAD solid",
        ],
        [
          model.material.densityAt ? "Reference mass" : "Mass",
          volume === undefined
            ? cadState.status === "failed" ? "Unavailable" : "Regenerating…"
            : `${number(volume * model.material.rho * 1000)} g`,
        ],
      ];
  $("modelMetrics").replaceChildren(
    ...metrics.map(([label, value]) => {
      const e = element("div", value, "metric");
      e.prepend(element("small", label));
      if (label === "Reference mass") e.title = densityDescription(model.material);
      return e;
    }),
  );
  const range = resultRange || [
    sum?.min || 0,
    sum ? (sum.max === sum.min ? sum.max + 1 : sum.max) : 1,
  ];
  $("legend").hidden = !r;
  if (r) {
    $("legendMin").textContent = `${celsius(range[0])}°`;
    $("legendMax").textContent = `${celsius(range[1])}°`;
  }
  $("selectionLabel").textContent = inputPreview ? `${inputPreview.selected.length} input edges selected · click edges to toggle` : generalCAD
    ? "CAD surface · thermal face selection unavailable"
    : selectedFace
      ? `Selected ${"XYZ"[selectedFace.axis]} ${selectedFace.side ? "maximum" : "minimum"} face · ${selectedFace.axis === model.axis ? model.boundaries[selectedFace.side].type : "insulated"}`
      : "X · length   Y · width   Z · height";
  const warnings = [];
  if(inputPreview) warnings.push('EDGE SELECTION — displaying the input solid before this feature. Apply the treatment to regenerate the finished solid.');
  if (!r && generalCAD && !inputPreview) {
    if (!currentCAD())
      warnings.push(
        cadState.status === "failed"
          ? `CAD FAILED — ${cadState.error}`
          : "Regenerating CAD solid…",
      );
    else
      warnings.push(
        model.imported
          ? "Imported solid validated. Add parametric geometry edits in Solid operations; generate a tetrahedral mesh in Simulate. Use CAD thermal study for a finite-element solution."
          : model.sketchBased ? "Sketch solid validated. Generate a tetrahedral mesh, then assign surfaces in CAD thermal study."
          : "CAD solid validated. Use CAD thermal study with a tetrahedral mesh for this geometry.",
      );
  }
  if (r && !isCurrent(project(), r))
    warnings.push(
      "OUTDATED — displaying the geometry and inputs used for this saved result.",
    );
  if (r && !r.verified)
    warnings.push(
      "Imported result: numerical accuracy has not been verified in this browser.",
    );
  $("resultBanner").hidden = !warnings.length;
  $("resultBanner").textContent = warnings.join(" ");
  viewer?.setModel({
    size,
    cells: model.cells,
    axis: model.axis,
    result: r,
    range,
    selected: selectedFace ? `${selectedFace.axis}:${selectedFace.side}` : null,
    showMesh: !inputPreview && $("showMesh").checked,
    cad: inputPreview?.artifact || (generalCAD ? currentCAD() : null),
    selectedEdges: inputPreview?.selected || [],
    onEdgeSelect: inputPreview?.onSelect,
    empty: !inputPreview && generalCAD && !currentCAD(),
  });
}
function drawPlot(parent, profile, axis) {
  const NS = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 640 135");
  svg.classList.add("plot");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Temperature versus ${axis} position in the solved block`,
  );
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text) n.textContent = text;
    svg.append(n);
  };
  let min = Math.min(...profile.map((p) => p[1])) - 273.15,
    max = Math.max(...profile.map((p) => p[1])) - 273.15;
  if (max - min < 1) {
    min -= 0.5;
    max += 0.5;
  }
  const L = profile.at(-1)[0],
    px = (x) => 55 + (x / L) * 565,
    py = (t) => 99 - ((t - 273.15 - min) / (max - min)) * 78;
  for (let i = 0; i < 3; i++) {
    const y = 21 + i * 39;
    add("line", {
      x1: 55,
      x2: 620,
      y1: y,
      y2: y,
      stroke: "#34434d",
      "stroke-width": 1,
    });
    add(
      "text",
      {
        x: 45,
        y: y + 3,
        fill: "#96aab7",
        "font-size": 10,
        "text-anchor": "end",
      },
      `${number(max - (i * (max - min)) / 2, 3)}°`,
    );
  }
  add("path", {
    d: profile
      .map(([x, t], i) => `${i ? "L" : "M"}${px(x)},${py(t)}`)
      .join(" "),
    fill: "none",
    stroke: "#e6ad6b",
    "stroke-width": 2,
  });
  add("text", { x: 55, y: 122, fill: "#96aab7", "font-size": 10 }, "0");
  add(
    "text",
    { x: 620, y: 122, fill: "#96aab7", "font-size": 10, "text-anchor": "end" },
    `${number(L * 1000)} mm · ${axis}`,
  );
  parent.append(svg);
}
function renderSweepSetup(panel, model) {
  panel.append(element("h2", "Parameter sweep"));
  note(panel, "Test 2–21 evenly spaced values of one global parameter. Each sample uses the current thermal study and mesh.");
  if (project().sweeps.length) {
    const saved = select(panel, "SAVED SWEEPS", project().sweeps.slice().reverse().map((s) =>
      [s.id, `${resolveSweep(s.provenance.source, s.settings).parameter.name} · r${s.provenance.revision} · ${s.status} · ${new Date(s.provenance.createdAt).toLocaleTimeString()}`]),
    selectedSweepId || project().sweeps.at(-1).id);
    saved.disabled = !!sweepLive;
    saved.onchange = () => {
      selectedSweepId = saved.value;
      renderComparisons();
      renderBottom();
    };
    panel.append(button("Use saved setup", () => {
      const settings = sweepRecord()?.settings;
      if (!settings || !model.source.parameters.some((p) => p.id === settings.parameterId))
        throw Error("This sweep parameter is absent from the current design. Restore a sample's inputs first.");
      sweepDraft = clone(settings);
      renderProperties();
      message("Copied the saved setup. The next run will use the current model, materials, boundaries and mesh.");
    }));
  }
  if (thermalSourceIssue(model)) {
    note(panel, thermalSourceIssue(model), "callout");
    if (!model.thermalSupported) note(panel, "Restore an uncut block version or choose “Use a new parametric block” in the body inspector to run a sweep.");
    return;
  }
  if (!model.source.parameters.length) {
    note(panel, "Add a global parameter in Design and reference it from the block or thermal inputs before running a sweep.", "callout");
    return;
  }
  const defaults = (p) => {
    const q = model.values.get(p.name), span = Math.abs(q.value) * 0.5 || 1;
    const readable = (value) => siExpression(value, q.dim).replaceAll("^(1)", "").replaceAll("*", " ");
    return { parameterId: p.id, start: readable(q.value - span), end: readable(q.value + span),
      samples: 5, objective: "mass", maxTemperature: "", maxMass: "" };
  };
  if (!sweepDraft && project().sweeps.length)
    sweepDraft = clone(sweepRecord().settings);
  if (!sweepDraft || !model.source.parameters.some((p) => p.id === sweepDraft.parameterId))
    sweepDraft = defaults(model.source.parameters[0]);
  panel.append(element("h3", "New sweep · current design"));
  if (model.material.densityAt) note(panel, 'Mass objectives and constraints use each sample’s material reference condition. Thermal expansion and deformation are excluded.', 'callout');
  const f = form(panel, () => {
    read();
    const settings = resolveSweep(project().source, { ...sweepDraft, samples: Number(sweepDraft.samples) }).settings;
    if (jobs.active || volumeMeshPreparing) throw Error("Wait for the current job or cancel it before starting a sweep.");
    sweepLive = createSweep(project(), settings, "pending");
    try {
      jobs.start("sweep", project(), { sweep: settings });
    } catch (error) {
      sweepLive = null;
      throw error;
    }
    renderComparisons();
    $("sweepComparison").scrollTop = 0;
    renderBottom();
    message("Parameter sweep started. Your applied design stays in place while the worker solves each sample.");
  }, "Run parameter sweep", true);
  const parameter = select(f.el, "PARAMETER", model.source.parameters.map((p) => [p.id, p.name]), sweepDraft.parameterId),
    start = field(f.el, "START · WITH UNITS", sweepDraft.start),
    end = field(f.el, "END · WITH UNITS", sweepDraft.end),
    samples = field(f.el, "NUMBER OF SAMPLES", sweepDraft.samples, "number"),
    objective = select(f.el, "OBJECTIVE", Object.entries(SWEEP_OBJECTIVES), sweepDraft.objective),
    maxTemperature = field(f.el, "MAXIMUM TEMPERATURE · OPTIONAL", sweepDraft.maxTemperature),
    maxMass = field(f.el, "MAXIMUM MASS · OPTIONAL", sweepDraft.maxMass);
  samples.min = 2; samples.max = 21; samples.step = 1;
  start.required = end.required = samples.required = true;
  for (const input of [start, end, maxTemperature, maxMass]) input.maxLength = 512;
  maxTemperature.placeholder = "e.g. 90 degC";
  maxMass.placeholder = "e.g. 40 g";
  const read = () => {
    sweepDraft = { parameterId: parameter.value, start: start.value, end: end.value,
      samples: samples.value, objective: objective.value, maxTemperature: maxTemperature.value, maxMass: maxMass.value };
  };
  f.el.oninput = read;
  f.el.onchange = read;
  parameter.onchange = () => {
    const next = defaults(model.source.parameters.find((p) => p.id === parameter.value));
    start.value = next.start; end.value = next.end;
    read();
  };
  f.finish();
  const submit = f.el.querySelector("button[type=submit]");
  submit.id = "runSweep";
  submit.disabled = !!jobs.active;
  note(panel, "Ranges and limits resolve against the input snapshot at run start. Dependent equations regenerate for each sample; the swept expression is replaced by its sample value.");
  note(panel, "Best tested means the best feasible sample in this range. Adaptive search, multiple variables and sensitivity analysis are not available. Refine the mesh to check temperature extrema.", "callout");
}
function renderConvergenceSetup(panel, model) {
  panel.append(element("h2", "Mesh-convergence check"));
  note(panel, "Solve the same thermal study on progressively finer grids. Every level doubles all three cell counts; it uses eight times as many volume cells.");
  if (project().convergenceChecks.length) {
    const saved = select(panel, "SAVED MESH CHECK", project().convergenceChecks.slice().reverse().map((r) =>
      [r.id, `r${r.provenance.revision} · ${r.settings.levels} grids · ${r.status} · ${new Date(r.provenance.createdAt).toLocaleTimeString()}`]),
      selectedConvergenceId || project().convergenceChecks.at(-1).id);
    saved.disabled = !!convergenceLive;
    saved.onchange = () => {
      selectedConvergenceId = saved.value;
      renderComparisons();
      $("convergenceComparison").scrollTop = 0;
      renderBottom();
    };
    panel.append(button("Reuse mesh check setup", () => {
      convergenceDraft = clone(convergenceRecord().settings);
      renderProperties();
      message("Copied the saved mesh check setup. A new run will use the current design inputs.");
    }));
  }
  if (thermalSourceIssue(model)) {
    note(panel, thermalSourceIssue(model), "callout");
    return;
  }
  if (!convergenceDraft) convergenceDraft = convergenceRecord() ? clone(convergenceRecord().settings)
    : { baseCells: [...PRESETS.Draft], levels: 3, temperatureTolerance: 0.1, heatTolerance: 0.01 };
  const f = form(panel, () => {
    read();
    const settings = refinementSettings(convergenceDraft);
    if (jobs.active || volumeMeshPreparing) throw Error("Wait for the current job or cancel it before starting a mesh check.");
    convergenceLive = createConvergence(project(), settings, "pending");
    try {
      jobs.start("convergence", project(), { convergence: settings });
    } catch (error) {
      convergenceLive = null;
      throw error;
    }
    renderComparisons();
    $("convergenceComparison").scrollTop = 0;
    renderBottom();
    message("Mesh check started. Each grid uses the same saved geometry, materials and boundary conditions.");
  }, "Run mesh check", true);
  const group = element("div", undefined, "numbers");
  f.el.append(element("h3", "New check · current design"), group);
  const cells = ["START X CELLS", "START Y CELLS", "START Z CELLS"].map((label, i) => {
    const input = field(group, label, convergenceDraft.baseCells[i], "number");
    input.min = 2; input.max = 64; input.step = 1; input.required = true;
    return input;
  });
  f.el.append(button("Use current mesh as start", () => {
    model.cells.forEach((n, i) => { cells[i].value = n; });
    read();
  }));
  const levels = select(f.el, "GRIDS TO SOLVE", [["2", "2 grids"], ["3", "3 grids"], ["4", "4 grids"]], String(convergenceDraft.levels)),
    temperature = field(f.el, "PROFILE CHANGE LIMIT / K", convergenceDraft.temperatureTolerance, "number"),
    heat = field(f.el, "HEAT-RATE CHANGE LIMIT / W", convergenceDraft.heatTolerance, "number");
  for (const input of [temperature, heat]) { input.required = true; input.min = "0.000000000001"; }
  const read = () => {
    convergenceDraft = { baseCells: cells.map((input) => Number(input.value)), levels: Number(levels.value),
      temperatureTolerance: Number(temperature.value), heatTolerance: Number(heat.value) };
    const sizes = Array.from({ length: Number(levels.value) }, (_, i) => cells.map((input) => Number(input.value) * 2 ** i));
    preview.textContent = sizes.map((grid) => `${grid.join(" × ")} (${grid.reduce((a, b) => a * b, 1).toLocaleString()} cells)`).join(" → ");
  };
  const preview = element("p", undefined, "note");
  f.el.append(preview);
  f.el.oninput = read;
  f.el.onchange = read;
  read();
  f.finish();
  const submit = f.el.querySelector("button[type=submit]");
  submit.id = "runConvergence";
  submit.disabled = !!jobs.active;
  note(panel, "Maximum 64 cells per axis and 32,768 volume cells on each grid. Change limits are absolute differences between the finest two grids, in kelvin and watts.");
  note(panel, "A small change does not certify the physical model. This check also measures cell-temperature error against the exact homogeneous-block solution. Adaptive meshing, error-bound estimation and general CAD studies are unavailable.", "callout");
}
function renderMeasurementSetup(panel) {
  panel.append(element("h2", "Measurement datasets"));
  note(panel, "Import numeric CSV/TSV data and assign units explicitly. Up to six datasets, 5,000 points and 256 KiB per file.");
  panel.append(button("Import measurement CSV", () => $("measurementFile").click(), "primary full"));
  if (measurementPending) {
    renderMeasurementImport(panel);
    return;
  }
  const m = measurement();
  if (!m) { note(panel, "Choose a file to preview its columns before adding it to the project."); return; }
  const picker = select(panel, "SAVED DATASET", project().measurements.map((d) => [d.id, d.name]), m.id);
  picker.onchange = () => { selectedMeasurementId = picker.value; render(); };
  const { points, mapping } = resolveMeasurement(m);
  pair(panel, "Source file", m.fileName);
  pair(panel, "Imported points", points.length.toLocaleString());
  pair(panel, "X → Y", `${mapping.x.unit} → ${mapping.y.unit}`);
  if (mapping.x.quantity === "position") pair(panel, "Model position axis", "XYZ"[mapping.positionAxis]);
  panel.append(element("h3", "Overlay saved solutions"));
  note(panel, "Select up to three. Each curve and error report use that solution’s original inputs and verification status.");
  if (!project().results.length) note(panel, "Solve a thermal study or open a retained mesh-check field in Analyze first.");
  const ids = measurementSolutions().map((r) => r.id);
  for (const r of project().results) {
    const input = field(panel, solutionLabel(r, project()), "", "checkbox");
    input.checked = ids.includes(r.id);
    input.parentElement.classList.add("check-field");
    input.onchange = () => attempt(() => {
      const next = new Set(measurementSolutions().map((s) => s.id));
      if (input.checked) next.add(r.id); else next.delete(r.id);
      if (next.size > 3) { input.checked = false; throw Error("Select at most three solution overlays."); }
      measurementSolutionIds = [...next]; renderProperties(); renderComparisons(); renderBottom();
    });
  }
  panel.append(button("Export measurement SI CSV", () => {
    download(fileName(`-measurement-${m.id}.csv`), measurementCSV(m), "text/csv;charset=utf-8");
    message("Measurement CSV prepared with SI values and source record numbers.");
  }, "full"));
  const exportComparison = button("Export comparison CSV", () => {
    const compatible = measurementSolutions().filter((r) => compareMeasurement(m, r).compatible);
    download(fileName(`-comparison-${m.id}.csv`), measurementComparisonCSV(m, compatible, project()), "text/csv;charset=utf-8");
    message("Comparison CSV prepared for compatible selected solutions, with excluded points and original solver provenance.");
  }, "full");
  exportComparison.disabled = !measurementSolutions().some((r) => compareMeasurement(m, r).compatible);
  panel.append(exportComparison, button("Remove dataset", () => {
    history.setMeasurements(project().measurements.filter((d) => d.id !== m.id));
    selectedMeasurementId = null; scheduleSave(); render();
    message("Dataset removed. Undo restores it; numerical solutions are unchanged.");
  }, "full"));
  note(panel, "Imported data records what the file contains; instrument accuracy and experimental conditions are not verified. Export project preserves the source CSV and mapping.");
}
function renderMeasurementImport(panel) {
  const pending = measurementPending;
  panel.append(element("h3", "Preview import"));
  note(panel, pending.fileName);
  const name = field(panel, "DATASET NAME", pending.name); name.maxLength = 160;
  name.oninput = () => { pending.name = name.value; };
  const delimiter = select(panel, "DELIMITER", [[",", "Comma"], [";", "Semicolon"], ["\t", "Tab"]], pending.mapping.delimiter);
  const header = field(panel, "First row contains headings", "", "checkbox"); header.checked = pending.mapping.header; header.parentElement.classList.add("check-field");
  delimiter.onchange = () => { pending.mapping.delimiter = delimiter.value; renderProperties(); };
  header.onchange = () => { pending.mapping.header = header.checked; renderProperties(); };
  panel.append(button("Cancel measurement import", () => { measurementReadToken++; measurementPending = null; renderProperties(); }));
  let rows;
  try { rows = parseMeasurementTable(pending.csv, pending.mapping.delimiter); }
  catch (error) { note(panel, error.message, "callout"); return; }
  const columns = rows[0].map((text, i) => [String(i), `${i + 1}. ${pending.mapping.header ? text.slice(0, 60) : "Column " + (i + 1)}`]);
  const xColumn = select(panel, "X COLUMN", columns, String(pending.mapping.xColumn));
  const yColumn = select(panel, "Y COLUMN", columns, String(pending.mapping.yColumn));
  const quantities = Object.entries(XY_QUANTITIES).map(([id, q]) => [id, q.label]);
  for (const side of ["x", "y"]) {
    const quantity = select(panel, `${side.toUpperCase()} QUANTITY`, quantities, pending.mapping[side].quantity);
    const unit = select(panel, `${side.toUpperCase()} UNIT`, XY_QUANTITIES[pending.mapping[side].quantity].units.map((u) => [u, u]), pending.mapping[side].unit);
    quantity.onchange = () => {
      pending.mapping[side] = { quantity: quantity.value, unit: XY_QUANTITIES[quantity.value].units[0] };
      pending.mapping.positionAxis = pending.mapping.x.quantity === "position" ? (pending.mapping.positionAxis ?? 0) : null;
      renderProperties();
    };
    unit.onchange = () => { pending.mapping[side].unit = unit.value; preview(); };
  }
  if (pending.mapping.x.quantity === "position") {
    const axis = select(panel, "POSITION ALONG MODEL AXIS", [["0", "X"], ["1", "Y"], ["2", "Z"]], String(pending.mapping.positionAxis));
    axis.onchange = () => { pending.mapping.positionAxis = Number(axis.value); preview(); };
  }
  const output = element("p", "", "measurement-preview note"); panel.append(output);
  const commit = button("Add dataset to project", () => {
    const accepted = createMeasurement(pending.csv, pending.mapping, pending.name, pending.fileName);
    history.setMeasurements([...project().measurements, accepted]);
    selectedMeasurementId = accepted.id; measurementPending = null;
    scheduleSave(); render(); message("Measurement imported with its original file and unit mapping. Undo removes the dataset.");
  }, "primary full");
  panel.append(commit);
  const preview = () => {
    pending.mapping.xColumn = Number(xColumn.value); pending.mapping.yColumn = Number(yColumn.value);
    try {
      const { points, mapping } = resolveMeasurement(pending);
      output.textContent = `${points.length} valid points. First values in SI: ${points.slice(0, 3).map((p) => `(${number(p.x)} ${XY_QUANTITIES[mapping.x.quantity].si}, ${number(p.y)} ${XY_QUANTITIES[mapping.y.quantity].si})`).join("; ")}.`;
      commit.disabled = false;
    } catch (error) { output.textContent = error.message; commit.disabled = true; }
  };
  xColumn.onchange = preview; yColumn.onchange = preview; preview();
  note(panel, "Numeric columns use decimal points and optional scientific notation. Blank or invalid selected values reject the import. Confirm units from your instrument or file documentation; headings do not automatically set them.");
}
function renderComparisons() {
  $("studio").classList.toggle("measurement-view", viewingMeasurements());
  $("measurementComparison").hidden = !viewingMeasurements();
  if (viewingMeasurements()) renderMeasurementReport($("measurementComparison"), measurement(), measurementSolutions(), project());
  $("studio").classList.toggle("optimize-view", workspace === "Optimize");
  $("sweepComparison").hidden = workspace !== "Optimize";
  $("studio").classList.toggle("convergence-view", viewingConvergence());
  $("convergenceComparison").hidden = !viewingConvergence();
  if (viewingConvergence()) renderConvergenceComparison($("convergenceComparison"), convergenceRecord(), project(), {
    busy: !!jobs.active,
    onAnalyze: (r) => attempt(() => {
      if (jobs.active || volumeMeshPreparing) throw Error("Wait for or cancel the running job first.");
      if (!project().results.some((saved) => saved.id === r.id)) history.addResult(r);
      selectedResultId = r.id;
      resultRange = null;
      scheduleSave();
      navigate("Analyze", "results");
      message(`Opened the retained ${r.provenance.source.meshes[0].cells.join(" × ")} field. Its original inputs and verification status are preserved.`);
    }),
    onApply: (r) => attempt(() => {
      if (jobs.active || volumeMeshPreparing) throw Error("Wait for or cancel the running job first.");
      history.update(r.provenance.source);
      selectedFace = null;
      scheduleSave();
      render();
      message("Restored this grid’s complete study inputs. Undo restores the previous design; Analyze opens its retained field.");
    }),
    onExport: (record) => attempt(() => {
      download(fileName(`-mesh-check-${record.id}.csv`), convergenceCSV(record), "text/csv;charset=utf-8");
      message("Mesh check CSV prepared with SI measurements, change limits and solver provenance. Export project to preserve all fields.");
    }),
  });
  if (workspace !== "Optimize") return;
  renderSweepComparison($("sweepComparison"), sweepRecord(), project(), {
    busy: !!jobs.active,
    onApply: (record, row) => attempt(() => {
      if (jobs.active || volumeMeshPreparing) throw Error("Wait for the running job or cancel it before applying a sample.");
      const source = requireThermalSource(sweepSource(record.provenance.source, record.settings, row.index)).source;
      history.update(source);
      selectedFace = null;
      scheduleSave();
      render();
      message(`Applied sample #${row.index + 1} with its saved geometry, material, physics and mesh. Undo restores the previous inputs. Solve thermal to inspect this design in Analyze.`);
    }),
    onExport: (record) => attempt(() => {
      download(fileName(`-sweep-${record.id}.csv`), sweepCSV(record), "text/csv;charset=utf-8");
      message("Sweep CSV prepared with SI measurements and run provenance. Export the project to preserve exact source snapshots.");
    }),
  });
}
function renderBottom() {
  const panel = $("bottomContent");
  panel.replaceChildren();
  if(viewingElectric()){
    $('bottomTitle').textContent='DC CONDUCTION / CURRENT AND POWER';note(panel,'Potential is stored at mesh nodes. Electric field, current density and Joule heat are constant within each linear tetrahedron. Positive terminal current enters the solid. Check mesh convergence before interpreting local maxima.');return;
  }
  if(viewingHarmonic()){
    $('bottomTitle').textContent='FREQUENCY RESPONSE / AREA-WEIGHTED SURFACE';const r=node==='harmonicResults'?harmonicResult():null;
    if(r)renderHarmonicPlot(panel,r,savedHarmonicRequest(r),harmonicIndex,chooseHarmonicFrequency,harmonicPlot,value=>{harmonicPlot=value;renderBottom();},{element,number,button,note,select});
    else note(panel,'Apply independent restraints, peak harmonic loads, Rayleigh damping and a response surface. Refine the frequency grid around natural modes.');return;
  }
  if(viewingModal()){
    $('bottomTitle').textContent='NATURAL FREQUENCIES / EFFECTIVE MASS';const r=node==='modalResults'?modalResult():null;
    if(r){const table=element('table','','sweep-table'),head=element('tr');for(const label of ['Mode','Frequency / Hz','Effective mass XYZ / %',''])head.append(element('th',label));table.append(head);r.solution.modes.forEach((m,i)=>{const row=element('tr');row.append(element('td',`${i+1}${m.rigid?' · rigid':''}`),element('td',number(m.frequency,7)),element('td',m.effectiveMass.map(v=>number(100*v/r.solution.totalMass,3)).join(' / ')));const action=element('td');action.append(button('View mode '+(i+1),()=>chooseModalMode(i)));row.append(action);table.append(row);});panel.append(table);}
    else note(panel,'Assign independent modal restraints or leave the body free. Natural modes use constant elastic properties and density, with no static load, damping or prestress.');return;
  }
  if(viewingStructural()){
    $('bottomTitle').textContent='STRUCTURAL / SAVED STUDY';const r=node==='structuralResults'?structuralResult():null;
    if(r){note(panel,`Source r${r.provenance.revision} · ${r.mesh.nodes.length/3} nodes · ${r.mesh.tetrahedra.length/4} tetrahedra · ${r.solution.iterations} CG iterations.`);note(panel,'The saved study retains its geometry, loads, restraints, material and solver settings. Displacement scaling changes only the display.');}
    else note(panel,'Assign surface restraints and loads, set constant elastic material properties, then solve the current CAD mesh.');return;
  }
  if(viewingFem()){
    $('bottomTitle').textContent='CAD THERMAL / SAVED STUDY';
    const r=node==='femResults'?femResult():null;
    if(r){note(panel,`Source r${r.provenance.revision} · ${r.mesh.nodes.length/3} nodes · ${r.mesh.tetrahedra.length/4} linear tetrahedra · mesh ${r.provenance.meshId}.`);note(panel,'The saved field includes its own geometry, material, boundary conditions and solver settings. Export the project to retain this complete study.');}
    else note(panel,'Assign temperature or convection to CAD surfaces, then solve. Unassigned surfaces are insulated. Field results are retained separately from block studies.');
    return;
  }
  if (viewingMeasurements()) {
    $("bottomTitle").textContent = "SIMULATION − MEASUREMENT / ERROR METRICS";
    renderMeasurementMetrics(panel, measurement(), measurementSolutions(), project());
    return;
  }
  if (viewingConvergence()) {
    $("bottomTitle").textContent = "ANALYTICAL CELL ERROR / GRID SIZE";
    if (convergenceRecord()) drawConvergencePlot(panel, convergenceRecord());
    else note(panel, "Computed cell temperatures will be compared with the closed-form solution for this restricted block study.");
    return;
  }
  if (workspace === "Optimize") {
    $("bottomTitle").textContent = "OBJECTIVE / PARAMETER · SAMPLED VALUES";
    if (sweepRecord()) drawSweepPlot(panel, sweepRecord());
    else note(panel, "Each plotted point will represent a completed thermal solve. Amber marks the best feasible sample.");
    return;
  }
  const r = workspace === "Analyze" ? result() : null;
  if (r) {
    $("bottomTitle").textContent = "TEMPERATURE / POSITION";
    const sum = summarize(r);
    drawPlot(panel, sum.profile, "XYZ"[sum.model.axis]);
    return;
  }
  $("bottomTitle").textContent = "FEATURE HISTORY / JOBS";
  const timeline = element("div", undefined, "feature-timeline");
  for (const [i, [name, detail]] of [
    ["Parameters", `${project().source.parameters.length} expressions`],
    project().source.features[0].type === "imported-step"
      ? ["Imported STEP", project().source.features[0].fileName]
      : ["extrude", "revolve"].includes(project().source.features[0].type)
        ? [project().source.sketches.find((sk) => sk.id === project().source.features[0].sketchId).name, `${project().source.features[0].type} · base solid`]
        : ["Block", "Base solid"],
    ...project()
      .source.features.slice(1)
      .map((f) => [
        f.name,
        f.suppressed ? "Suppressed" : f.type === "through-hole" ? `${"XYZ"[f.axis]} through-hole` : EDGE_KINDS.includes(f.type) ? `${f.type} · ${f.size}` : `${f.operation} · ${f.type}`,
      ]),
    ...(project().electricResults.length ? [["DC conduction", `${project().electricResults.length} saved solutions`]] : []),
    ...(project().harmonicResults.length ? [["Harmonic response", `${project().harmonicResults.length} saved sweeps`]] : []),
    ...(project().modalResults.length ? [["Natural modes", `${project().modalResults.length} saved mode sets`]] : []),
    ...(project().structuralResults.length ? [["Static structural", `${project().structuralResults.length} saved fields`]] : []),
    ...(project().femResults.length ? [["CAD thermal", `${project().femResults.length} saved FEM fields`]] : []),
    ...(project().volumeMeshes.length ? [["CAD mesh", `${project().volumeMeshes.length} saved tetrahedral meshes`]] : []),
    ["Thermal study", `${project().results.length} saved solutions`],
  ].entries()) {
    if (i) timeline.append(element("span", "→", "timeline-arrow"));
    const n = element("div", name, "feature-node");
    n.append(element("small", detail));
    timeline.append(n);
  }
  panel.append(timeline);
  const log = element("div", undefined, "job-events");
  for (const event of events.slice(-8)) log.append(element("span", event));
  panel.append(log);
  if (!events.length)
    panel.append(
      element(
        "p",
        !thermalSourceIssue(validateSource(project().source))
          ? "Edit a parameter, assign temperatures, then mesh and solve."
          : "Edit the feature stack in Design, or export this solid in Manufacture.",
        "empty-note",
      ),
    );
}
function render() {
  ensureCAD();
  renderTree();
  renderProperties();
  renderViewport();
  renderComparisons();
  renderBottom();
}
async function startVolumeMesh(){
  if(!flushDraft())return;
  if(!project().source.meshes.some(m=>m.type==='gmsh-tetra')) {activeForm?.requestSubmit();if(!project().source.meshes.some(m=>m.type==='gmsh-tetra'))return;}
  if(jobs.active||volumeMeshPreparing)throw Error('Wait for the current job or cancel it.');
  const artifact=currentCAD();if(!artifact)throw Error('Wait for the current CAD solid to regenerate.');
  const snapshot=clone(project()),model=validateSource(snapshot.source),settings=resolveVolumeMesh(model.source.meshes.find(m=>m.type==='gmsh-tetra'),model.values,model.source.features[0].bodyId).settings;
  const token={};volumeMeshPreparing=token;$('jobState').textContent='Preparing';$('cancelJob').disabled=false;syncStudyControls();
  message('Preparing the exact CAD snapshot for local volume meshing…');
  try{
    const health=await computeHealth();volumeMeshService=`Ready · Gmsh ${health.mesher}`;
    if(volumeMeshPreparing!==token)return;
    const {blob}=await cadClient.request('export',{format:'step',fingerprint:artifact.fingerprint,name:snapshot.name});
    const step=await blob.text();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(step))),b=>b.toString(16).padStart(2,'0')).join('');
    if(volumeMeshPreparing!==token)return;
    volumeMeshJob={snapshot,hash,volume:artifact.volume};volumeMeshPreparing=null;
    jobs.start('volume-mesh',snapshot,{request:{kind:'gmsh-tetra',step,settings,expectedVolume:artifact.volume}});
    message('Gmsh is generating tetrahedra on this computer. You can continue editing or cancel the job.');
  }catch(error){if(volumeMeshPreparing===token){volumeMeshPreparing=null;volumeMeshJob=null;$('jobState').textContent='Failed';$('cancelJob').disabled=true;syncStudyControls();throw error;}}
}
const jobs = new JobManager((event) => {
  $("jobState").textContent = event.state;
  $("cancelJob").disabled = !jobs.active;
  syncStudyControls();
  if (events.at(-1) !== event.state) events.push(event.state);
  if(event.action==='electric-tetra'){
    $('jobDetail').textContent=`${event.state} · Rust DC conduction`;
    if(event.state==='Completed')try{const job=electricJob;if(!job||job.snapshot.id!==project().id)throw Error('Electrical result belongs to another project.');const record={id:event.id,provenance:{projectId:job.snapshot.id,revision:job.snapshot.revision,source:job.snapshot.source,fingerprint:fingerprint(job.snapshot.source),createdAt:new Date().toISOString(),meshId:job.mesh.id},mesh:job.mesh.mesh,solution:event.solution,verified:true};history.addElectricResult(record);selectedElectricId=record.id;scheduleSave();message(isCurrent(project(),record)?'DC conduction complete. Open Electrical results to inspect current and Joule heat.':'Electrical solve completed for earlier inputs and is marked outdated.');}catch(error){$('jobState').textContent='Failed';$('jobDetail').textContent='Failed · electrical result validation';message(error.message,true);}
    if(event.state==='Failed')message(event.error,true);
    if(['Completed','Failed','Cancelled'].includes(event.state)){electricJob=null;renderTree();renderViewport();renderBottom();if(!draft)renderProperties();}return;
  }
  if(event.action==='harmonic-tetra'){
    $('jobDetail').textContent=`${event.state} · local harmonic FEM`;
    if(event.state==='Completed')try{const job=harmonicJob;if(!job||job.snapshot.id!==project().id)throw Error('Harmonic result belongs to another project.');const record={id:event.id,provenance:{projectId:job.snapshot.id,revision:job.snapshot.revision,source:job.snapshot.source,fingerprint:fingerprint(job.snapshot.source),createdAt:new Date().toISOString(),meshId:job.mesh.id},mesh:job.mesh.mesh,solution:event.solution,verified:true};history.addHarmonicResult(record);selectedHarmonicId=record.id;harmonicIndex=0;harmonicPhase=0;harmonicScale=1;harmonicViewCache=null;scheduleSave();message(isCurrent(project(),record)?'Harmonic sweep complete. Open Frequency response to inspect amplitudes, phase and impedance.':'Harmonic sweep completed for earlier inputs and is marked outdated.');}catch(error){$('jobState').textContent='Failed';$('jobDetail').textContent='Failed · harmonic result validation';message(error.message,true);}
    if(event.state==='Failed')message(event.error,true);if(event.state==='Cancelled')message('Harmonic solve cancelled. Saved sweeps are retained.');
    if(['Completed','Failed','Cancelled'].includes(event.state)){harmonicJob=null;renderTree();renderViewport();renderBottom();if(!draft)renderProperties();}return;
  }
  if(event.action==='modal-tetra'){
    $('jobDetail').textContent=`${event.state} · local eigenfrequency FEM`;
    if(event.state==='Completed')try{const job=modalJob;if(!job||job.snapshot.id!==project().id)throw Error('Modal result belongs to another project.');const record={id:event.id,provenance:{projectId:job.snapshot.id,revision:job.snapshot.revision,source:job.snapshot.source,fingerprint:fingerprint(job.snapshot.source),createdAt:new Date().toISOString(),meshId:job.mesh.id},mesh:job.mesh.mesh,solution:event.solution,verified:true};history.addModalResult(record);selectedModalId=record.id;modalMode=0;modalPhase=1;modalViewCache=null;scheduleSave();message(isCurrent(project(),record)?'Eigenfrequency solve complete. Open Natural modes to inspect frequencies and animate mode shapes.':'Natural modes completed for earlier inputs and are marked outdated.');}catch(error){$('jobState').textContent='Failed';$('jobDetail').textContent='Failed · modal result validation';message(error.message,true);}
    if(event.state==='Failed')message(event.error,true);if(event.state==='Cancelled')message('Eigenfrequency solve cancelled. Saved mode sets are retained.');
    if(['Completed','Failed','Cancelled'].includes(event.state)){modalJob=null;renderTree();renderViewport();renderBottom();if(!draft)renderProperties();}return;
  }
  if(event.action==='structural-tetra'){
    $('jobDetail').textContent=`${event.state} · local static structural FEM`;
    if(event.state==='Completed')try{
      const job=structuralJob;if(!job||job.snapshot.id!==project().id)throw Error('Structural result belongs to another project.');
      const record={id:event.id,provenance:{projectId:job.snapshot.id,revision:job.snapshot.revision,source:job.snapshot.source,fingerprint:fingerprint(job.snapshot.source),createdAt:new Date().toISOString(),meshId:job.mesh.id},mesh:job.mesh.mesh,solution:event.solution,verified:true};
      history.addStructuralResult(record);selectedStructuralId=record.id;structuralRange=null;structuralDeformation=0;scheduleSave();message(isCurrent(project(),record)?'Static structural solve complete. Open Structural results for displacement, stress and reactions.':'Structural solve completed for earlier inputs and is marked outdated.');
    }catch(error){$('jobState').textContent='Failed';$('jobDetail').textContent='Failed · structural result validation';message(error.message,true);}
    if(event.state==='Failed')message(event.error,true);if(event.state==='Cancelled')message('Structural solve cancelled. Saved solutions are retained.');
    if(['Completed','Failed','Cancelled'].includes(event.state)){structuralJob=null;renderTree();renderViewport();renderBottom();if(!draft)renderProperties();}return;
  }
  if(event.action==='thermal-tetra'){
    $('jobDetail').textContent=`${event.state} · local CAD thermal FEM`;
    if(event.state==='Completed')try{
      const job=femJob;if(!job||job.snapshot.id!==project().id)throw Error('Solution belongs to another project.');
      const record={id:event.id,provenance:{projectId:job.snapshot.id,revision:job.snapshot.revision,source:job.snapshot.source,fingerprint:fingerprint(job.snapshot.source),createdAt:new Date().toISOString(),meshId:job.mesh.id},mesh:job.mesh.mesh,solution:event.solution,verified:true};
      history.addFemResult(record);selectedFemId=record.id;femRange=null;scheduleSave();
      message(isCurrent(project(),record)?'CAD thermal solve complete. Open CAD thermal results to inspect fields and heat balance.':'CAD solve completed for earlier inputs and is marked outdated.');
    }catch(error){$('jobState').textContent='Failed';$('jobDetail').textContent='Failed · FEM result validation';message(error.message,true);}
    if(event.state==='Failed')message(event.error,true);
    if(event.state==='Cancelled')message('CAD thermal solve cancelled. Saved fields are retained.');
    if(['Completed','Failed','Cancelled'].includes(event.state)){femJob=null;renderTree();renderViewport();renderBottom();if(!draft)renderProperties();}
    return;
  }
  if(event.action==='volume-mesh'){
    $('jobDetail').textContent=`${event.state} · local Gmsh compute service`;
    if(event.state==='Completed')try{
      const job=volumeMeshJob;if(!job||job.snapshot.id!==project().id)throw Error('Mesh belongs to another project.');
      if(event.mesh.stepSha256!==job.hash||Math.abs(event.mesh.cadVolume/job.volume-1)>1e-5)throw Error('Mesh provenance does not match the submitted CAD snapshot.');
      const record={id:event.id,provenance:{projectId:job.snapshot.id,revision:job.snapshot.revision,source:job.snapshot.source,fingerprint:fingerprint(job.snapshot.source),createdAt:new Date().toISOString()},mesh:event.mesh,verified:true};
      history.addVolumeMesh(record);selectedVolumeMeshId=record.id;scheduleSave();
      message(isCurrent(project(),record)?'Volume mesh complete. Inspect quality, use the cutaway, or export MSH.':'Volume mesh completed for earlier inputs and is marked outdated.');
    }catch(error){$('jobState').textContent='Failed';$('jobDetail').textContent='Failed · mesh validation';message(error.message,true);}
    if(event.state==='Failed')message(event.error,true);
    if(event.state==='Cancelled')message('Volume meshing cancelled. Saved meshes are retained.');
    if(['Completed','Failed','Cancelled'].includes(event.state)){volumeMeshJob=null;renderTree();renderViewport();renderBottom();if(!draft)renderProperties();}
    return;
  }
  if (event.action === "convergence") {
    if (event.state === "Queued" && convergenceLive) convergenceLive.id = event.id;
    if (event.state === "Refining") {
      if (convergenceLive && event.row) convergenceLive.rows.push(event.row);
      $("jobDetail").textContent = `Mesh check · grid ${event.index + 1}/${event.total}${event.iterations ? ` · ${event.iterations} iterations` : ""}`;
    }
    if (["Completed", "Cancelled", "Failed"].includes(event.state)) attempt(() => {
      const record = event.convergence || (convergenceLive && { ...convergenceLive, status: event.state });
      if (record) {
        history.addConvergence(record);
        selectedConvergenceId = record.id;
        scheduleSave();
      }
      convergenceLive = null;
      $("jobDetail").textContent = `Mesh check ${event.state.toLowerCase()} · ${record?.rows.length || 0} grids recorded`;
      message(event.state === "Failed" ? event.error : event.state === "Cancelled"
        ? "Mesh check cancelled. Completed fields are retained; no final convergence assessment is made."
        : "Mesh check complete. Compare the refinement levels and inspect any retained field in Analyze.", event.state === "Failed");
      renderTree();
      if (!draft) renderProperties();
    });
    if (event.row || ["Queued", "Completed", "Cancelled", "Failed"].includes(event.state)) {
      renderComparisons();
      renderBottom();
    }
    return;
  }
  if (event.action === "sweep") {
    if (event.state === "Queued" && sweepLive) sweepLive.id = event.id;
    if (event.state === "Sweeping") {
      if (sweepLive && event.row) sweepLive.rows.push(event.row);
      $("jobDetail").textContent = `Sweep · sample ${event.index + 1}/${event.total}${event.iterations ? ` · ${event.iterations} iterations` : ""}`;
    }
    if (["Completed", "Cancelled", "Failed"].includes(event.state)) {
      attempt(() => {
        const record = event.sweep || (sweepLive && { ...sweepLive, status: event.state });
        if (record) {
          history.addSweep(record);
          selectedSweepId = record.id;
          scheduleSave();
        }
        sweepLive = null;
        $("jobDetail").textContent = `Sweep ${event.state.toLowerCase()} · ${record?.rows.length || 0} samples recorded`;
        message(event.state === "Failed" ? event.error : event.state === "Cancelled"
          ? "Sweep cancelled. Finished samples have been retained; your applied design is unchanged."
          : "Sweep complete. Compare candidates in Optimize and apply a design, or export the measurements as CSV.", event.state === "Failed");
        if (!draft) renderProperties();
      });
    }
    if (event.row || ["Queued", "Completed", "Cancelled", "Failed"].includes(event.state)) {
      renderComparisons();
      renderBottom();
    }
    return;
  }
  if (event.state === "Solving")
    $("jobDetail").textContent = event.iterations
      ? `Solving · ${event.iterations} iterations · residual ${event.residual.toExponential(2)}`
      : `Solving ${event.cells?.toLocaleString() || ""} volume cells in a browser worker`;
  if (event.state === "Completed")
    attempt(() => {
      if (event.result) {
        history.addResult(event.result);
        selectedResultId = event.result.id;
        resultRange = null;
        meshArtifact = {
          ...event.mesh,
          fingerprint: event.result.provenance.fingerprint,
        };
        scheduleSave();
        message(
          isCurrent(project(), event.result)
            ? "Thermal solution complete. Open Analyze to inspect temperatures, heat balance and probes."
            : "Solve completed for earlier inputs. Its result is retained and marked outdated.",
        );
      } else {
        meshArtifact = { ...event.mesh, fingerprint: event.fingerprint };
        message(
          meshArtifact.fingerprint === fingerprint(project().source)
            ? `Generated ${event.mesh.count.toLocaleString()} hexahedral control volumes.`
            : "Mesh completed for earlier inputs. Regenerate for the current model.",
        );
      }
      $("jobDetail").textContent = "Completed · local browser computation";
      // Do not discard property edits typed while the worker was running.
      renderTree();
      renderViewport();
      if (!draft) renderProperties();
    });
  if (event.state === "Failed") {
    message(event.error, true);
    $("jobDetail").textContent = "Failed · see diagnostic above";
  }
  if (event.state === "Cancelled") {
    message(
      "Calculation cancelled. Your applied model and earlier solutions are retained.",
    );
    $("jobDetail").textContent = "Cancelled";
  }
  renderComparisons();
  renderBottom();
});
function navigate(nextWorkspace, nextNode) {
  if (!flushDraft()) return;
  stopModalAnimation();stopHarmonicAnimation();
  newEdgeKind=null;
  workspace = nextWorkspace;
  node = nextNode;
  render();
  document.querySelector(".properties").scrollTop = 0;
  if (workspace === "Optimize") $("sweepComparison").scrollTop = 0;
  if (viewingConvergence()) $("convergenceComparison").scrollTop = 0;
  if (viewingMeasurements()) $("measurementComparison").scrollTop = 0;
}
async function replaceProject(next, description, importIsCurrent) {
  if (!importIsCurrent) cadImport.cancel();
  const stillCurrent = unchangedProject();
  volumeMeshPreparing=null;volumeMeshJob=null;femJob=null;structuralJob=null;modalJob=null;harmonicJob=null;electricJob=null;stopModalAnimation();stopHarmonicAnimation();
  jobs.cancel();
  clearTimeout(saveTimer);
  await persist();
  if (!stillCurrent() || (importIsCurrent && !importIsCurrent()))
    throw Error(
      "The project changed while saving. Your newer edits were kept; open the file again.",
    );
  jobs.cancel();
  cadImport.cancel();
  cadClient.reset();
  cadState = { key: null, artifact: null, status: "idle", error: "" };
  history = new ProjectHistory(next);
  newEdgeKind=null;
  sweepLive = null;
  selectedSweepId = null;
  sweepDraft = null;
  convergenceLive = null;
  selectedConvergenceId = null;
  convergenceDraft = null;
  measurementPending = null;
  measurementReadToken++;
  selectedMeasurementId = null;
  measurementSolutionIds = null;
  draft = false;
  selectedFace = null;
  selectedOperationId = null;
  selectedMaterialId = null;
  selectedFemId=null;selectedSurface=null;femRange=null;selectedStructuralId=null;structuralRange=null;structuralDeformation=0;selectedModalId=null;modalMode=0;modalPhase=1;modalViewCache=null;selectedElectricId=null;electricOutput="potential";selectedHarmonicId=null;harmonicIndex=0;harmonicPhase=0;harmonicScale=1;harmonicViewCache=null;
  selectedVolumeMeshId = null;
  volumeMeshViewCache=null;
  selectedResultId = null;
  resultRange = null;
  meshArtifact = null;
  events.length = 0;
  $("jobState").textContent = "Idle";
  $("jobDetail").textContent = "Local browser computation · SI internally";
  workspace = "Design";
  node =
    next.source.features[0].type === "imported-step" ? "body" : "parameters";
  scheduleSave();
  render();
  message(description);
}
async function start() {
  if (!window.HCAuth)
    throw Error("Authentication did not load. Reload the page to try again.");
  const access = await window.HCAuth.requireAdmin();
  if (!access) return;
  let initial = createProject();
  try {
    store = await openProjectStore();
    const stored = await store.read("active");
    if (stored) {
      initial = validateProject(stored);
      saved = true;
    }
    $("recoverProject").disabled = !(await store.read("recovery"));
  } catch (error) {
    storageWarning = `Local recovery: ${error.message}. Use Open to import a backup, or Recover previous save if available.`;
    if (store) {
      try {
        $("recoverProject").disabled = !(await store.read("recovery"));
      } catch {
        store = null;
      }
    }
  }
  history = new ProjectHistory(initial);
  node =
    initial.source.features[0].type === "imported-step" ? "body" : "parameters";
  try {
    viewer = createEngineeringViewer($("viewport"), (axis, side) => {
      selectedFace = { axis, side };
      viewer.select(axis, side);
      const source =
        workspace === "Analyze" && result()
          ? result().provenance.source
          : project().source;
      const model = validateSource(source);
      $("selectionLabel").textContent =
        `Selected ${"XYZ"[axis]} ${side ? "maximum" : "minimum"} face · ${axis === model.axis ? model.boundaries[side].type : "insulated"}`;
    });
  } catch (error) {
    storageWarning = `${storageWarning} ${error.message}`.trim();
  }
  $("studio").inert = false;
  $("toggleSketch").onclick = () => { sketchMode = !sketchMode; renderViewport(); };
  for (const b of document.querySelectorAll("[data-workspace]"))
    b.onclick = () =>
      attempt(() =>
        navigate(
          b.dataset.workspace,
          {
            Design: "parameters",
            Simulate: "physics",
            Analyze: "results",
            Optimize: "optimize",
            Manufacture: "manufacture",
          }[b.dataset.workspace],
        ),
      );
  for (const b of document.querySelectorAll("[data-node]"))
    b.onclick = () =>
      attempt(() => {
        const n = b.dataset.node;
        navigate(
          ["parameters", "body", "sketch", "operations", "holes", "material"].includes(n)
            ? "Design"
            : ["results", "measurements", "femResults", "structuralResults", "modalResults", "harmonicResults", "electricResults"].includes(n)
              ? "Analyze"
              : "Simulate",
          n,
        );
      });
  $("projectName").onchange = () =>
    attempt(() => {
      const name = $("projectName").value;
      if (!flushDraft()) return;
      update(() => {}, name);
      render();
    });
  $("undo").onclick = () =>
    attempt(() => {
      if (!flushDraft()) return;
      history.undo();
      scheduleSave();
      render();
      message("Undid the last model edit.");
    });
  $("redo").onclick = () =>
    attempt(() => {
      if (!flushDraft()) return;
      history.redo();
      scheduleSave();
      render();
      message("Redid the model edit.");
    });
  $("checkpoint").onclick = () =>
    attempt(() => {
      if (!flushDraft()) return;
      history.checkpoint(
        $("versionName").value.trim() || `Revision ${project().revision}`,
      );
      $("versionName").value = "";
      scheduleSave();
      renderTree();
      message(
        "Named version saved. Select it in the project tree to restore its inputs.",
      );
    });
  $("saveProject").onclick = () =>
    attempt(async () => {
      if (!flushDraft()) return;
      const contents = JSON.stringify(project(), null, 2);
      if (new Blob([contents]).size > MAX_PROJECT_BYTES)
        throw Error(
          "The project exceeds the 64 MiB portable-file limit. Duplicate its current inputs to export a smaller project.",
        );
      download(fileName(".hcengineering.json"), contents);
      await persist();
      message(
        "Project download prepared, including saved solutions and named versions.",
      );
    });
  $("openProject").onclick = () => $("projectFile").click();
  $("measurementFile").onchange = (e) => attempt(async () => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    if (file.size > MAX_MEASUREMENT_BYTES) throw Error("Measurement files must be no larger than 256 KiB.");
    const guard = unchangedProject(), token = ++measurementReadToken, csv = await file.text();
    if (token !== measurementReadToken || !guard()) throw Error("The project changed while reading the measurement. Choose the file again.");
    let delimiter = ",", rows;
    for (const candidate of [",", ";", "\t"]) {
      try { rows = parseMeasurementTable(csv, candidate); delimiter = candidate; break; } catch { /* User can correct the delimiter in the preview. */ }
    }
    const isNumeric = (v) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim());
    measurementPending = { csv, fileName: file.name.slice(0, 160), name: file.name.replace(/\.[^.]+$/, "").slice(0, 160),
      mapping: { delimiter, header: rows ? !rows[0].slice(0, 2).every(isNumeric) : true, xColumn: 0, yColumn: 1,
        x: { quantity: "position", unit: "mm" }, y: { quantity: "temperature", unit: "degC" }, positionAxis: 0 } };
    navigate("Analyze", "measurements");
    message("File loaded for preview. Confirm columns, quantities and units before adding the dataset.");
  });
  $("importSTEP").onclick = () =>
    attempt(() => {
      if (!flushDraft()) return;
      $("stepFile").click();
    });
  $("cancelImport").onclick = () => {
    importGeneration++;
    cadImport.cancel();
    $("importSTEP").disabled = false;
    $("cancelImport").hidden = true;
    message("CAD import cancelled. The current model was kept.");
  };
  $("stepFile").onchange = (e) =>
    attempt(async () => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > MAX_STEP_BYTES)
        throw Error("STEP files must be no larger than 1 MiB in this release.");
      if (!flushDraft()) return;
      const guard = unchangedProject(),
        base = clone(project().source);
      const candidate = stepSource(
        base,
        await file.text(),
        file.name.slice(0, 160),
      );
      if (!guard())
        throw Error(
          "The project changed while reading the file. Import it again to replace the current model.",
        );
      await acceptCADImport(candidate, guard, (source) => {
        history.update(source);
        draft = false;
        selectedFace = null;
        workspace = "Design";
        node = "body";
        scheduleSave();
        render();
        message(
          `Imported “${file.name}” as one validated solid. Undo restores the previous design; prior results remain available in Analyze.`,
        );
      });
    });
  $("projectFile").onchange = (e) =>
    attempt(async () => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > MAX_PROJECT_BYTES)
        throw Error("Project files must be no larger than 64 MiB.");
      const guard = unchangedProject();
      const next = validateProject(JSON.parse(await file.text()), {
        imported: true,
      });
      if (!guard())
        throw Error(
          "The project changed while reading the file. Open it again to replace the current model.",
        );
      const replace = (_source, _artifact, importIsCurrent) =>
        replaceProject(
          next,
          "Project opened. Imported numerical results are retained as unverified; solve again to verify.",
          importIsCurrent,
        );
      if (next.source.features[0].type === "imported-step")
        await acceptCADImport(next.source, guard, replace);
      else await replace();
    });
  $("duplicateProject").onclick = () =>
    attempt(async () => {
      if (!flushDraft()) return;
      await replaceProject(
        {
          ...clone(project()),
          id: crypto.randomUUID(),
          name: `${project().name.slice(0, 150)} copy`,
          revision: 0,
          results: [],
          versions: [],
          sweeps: [],
          convergenceChecks: [],
          volumeMeshes: [],
          femResults: [],
          structuralResults: [],
          modalResults: [],
          harmonicResults: [],
          electricResults: [],
        },
        "Duplicated the design inputs into a new project with no saved results.",
      );
    });
  $("recoverProject").onclick = () =>
    attempt(async () => {
      const backup = await store?.read("recovery");
      if (!backup) throw Error("No recovery snapshot is available.");
      await replaceProject(
        validateProject(backup),
        "Restored the previous local save. The displaced project is available through recovery.",
      );
    });
  $("generateMesh").onclick = () =>
    attempt(() => {
      if(viewingVolumeMesh()||viewingFem()||viewingStructural()||viewingModal()||viewingHarmonic()||viewingElectric()){if(!flushDraft())return;if(!project().source.meshes.some(m=>m.type==='gmsh-tetra'))navigate('Simulate','volumeMesh');return startVolumeMesh();}
      if (!flushDraft()) return;
      requireThermalSource(project().source);
      if(volumeMeshPreparing)throw Error("Wait for CAD mesh preparation or cancel it.");
      jobs.start("mesh", project());
      $("showMesh").checked = true;
      renderViewport();
    });
  $("solve").onclick = () =>
    attempt(() => {
      if(viewingElectric())return startElectric();
      if(viewingHarmonic())return startHarmonic();
      if(viewingModal())return startModal();
      if(viewingStructural())return startStructural();
      if(viewingFem())return startFem();
      if (!flushDraft()) return;
      requireThermalSource(project().source);
      if(volumeMeshPreparing)throw Error("Wait for CAD mesh preparation or cancel it.");
      jobs.start("solve", project());
    });
  $('cancelJob').onclick=()=>{if(volumeMeshPreparing){volumeMeshPreparing=null;$('jobState').textContent='Cancelled';$('cancelJob').disabled=true;syncStudyControls();message('Mesh preparation cancelled.');}else jobs.cancel();};
  $("showMesh").onchange = renderViewport;
  $("resetView").onclick = () => viewer?.reset();
  window.addEventListener("beforeunload", (e) => {
    if (draft || measurementPending || !saved || jobs.active || volumeMeshPreparing) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("keydown", (e) => {
    if (
      !(e.metaKey || e.ctrlKey) ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
    )
      return;
    if (e.key.toLowerCase() === "z") {
      e.preventDefault();
      (e.shiftKey ? $("redo") : $("undo")).click();
    }
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      $("saveProject").click();
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopModalAnimation();stopHarmonicAnimation();}});
  render();
  $("saveState").textContent = saved
    ? "Restored local project"
    : "New project · export or edit to save";
  message(
    storageWarning ||
      (!thermalSourceIssue(validateSource(project().source))
        ? "Ready. Edit a block or add CAD holes in Design. Thermal studies support the uncut block."
        : "Restored your CAD design. Inspect the model in Design or export the solid in Manufacture."),
    !!storageWarning,
  );
}
start().catch((error) => {
  message(`Unable to start Engineering Studio: ${error.message}`, true);
  $("studio").inert = true;
});
