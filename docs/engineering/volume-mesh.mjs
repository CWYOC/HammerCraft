import {quantity,dimensions} from './units.mjs';
export const MESH_LIMITS={nodes:50000,tetrahedra:100000};
export const CAD_MESH_PRESETS={Draft:8,Normal:12,Fine:20,'Very Fine':30,Extreme:40};
const identity=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function resolveVolumeMesh(input,values,bodyId){
  if(!input||!identity(input.id)||input.bodyId!==bodyId||input.type!=='gmsh-tetra')throw Error('Invalid tetrahedral mesh identity or body reference.');
  const minSize=quantity(input.minSize,dimensions.length,values),maxSize=quantity(input.maxSize,dimensions.length,values);
  if(minSize<1e-6||maxSize>1000||minSize>maxSize)throw Error('Element sizes must be 1 µm–1000 m, with minimum no greater than maximum.');
  if(!Number.isInteger(input.curvature)||input.curvature<0||input.curvature>64)throw Error('Curvature resolution must be an integer from 0 to 64.');
  return {source:{id:input.id,bodyId,type:'gmsh-tetra',minSize:input.minSize,maxSize:input.maxSize,curvature:input.curvature},settings:{minSize,maxSize,curvature:input.curvature}};
}
export function defaultVolumeMesh(bodyId,size=[.06,.02,.01],preset='Normal'){
  const divisor=CAD_MESH_PRESETS[preset];if(!divisor)throw Error('Unknown mesh preset.');
  const maximum=Math.max(4e-6,Math.hypot(...size)/divisor);
  return {id:crypto.randomUUID(),bodyId,type:'gmsh-tetra',minSize:`${Number((maximum*250).toPrecision(6))} mm`,maxSize:`${Number((maximum*1000).toPrecision(6))} mm`,curvature:{Draft:8,Normal:16,Fine:24,'Very Fine':32,Extreme:40}[preset]};
}
const FACES=[[1,2,3],[0,3,2],[0,1,3],[0,2,1]],EDGES=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
const faceKey=ids=>[...ids].sort((a,b)=>a-b).join(',');
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function tetraMeasure(points){
  const sixVolume=dot(sub(points[1],points[0]),cross(sub(points[2],points[0]),sub(points[3],points[0]))),volume=sixVolume/6;
  const edgeSquared=EDGES.reduce((sum,[a,b])=>sum+points[a].reduce((s,v,i)=>s+(v-points[b][i])**2,0),0);
  return {volume,quality:volume>0?12*(3*volume)**(2/3)/edgeSquared:0};
}
// Recompute geometry and topology rather than trusting backend/imported summary numbers.
export function inspectVolumeMesh(input){
  if(!input||!Array.isArray(input.nodes)||input.nodes.length<12||input.nodes.length%3||input.nodes.length>MESH_LIMITS.nodes*3||input.nodes.some(v=>!finite(v)||Math.abs(v)>10000))throw Error('Invalid volume-mesh coordinates or node limit.');
  const nodes=[...input.nodes],count=nodes.length/3,tets=input.tetrahedra;
  if(!Array.isArray(tets)||tets.length<4||tets.length%4||tets.length>MESH_LIMITS.tetrahedra*4||tets.some(i=>!Number.isInteger(i)||i<0||i>=count))throw Error('Invalid tetrahedral connectivity or element limit.');
  const points=Array.from({length:count},(_,i)=>nodes.slice(i*3,i*3+3)),faces=new Map(),used=new Set(),cells=new Set(),parents=Array.from({length:tets.length/4},(_,i)=>i);
  const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  let volume=0,minQuality=1,qualitySum=0,poorElements=0,minVolume=Infinity;
  for(let i=0;i<tets.length;i+=4){
    const ids=tets.slice(i,i+4),key=faceKey(ids);if(new Set(ids).size!==4||cells.has(key))throw Error('Repeated nodes or duplicate tetrahedron.');cells.add(key);ids.forEach(n=>used.add(n));
    const measurement=tetraMeasure(ids.map(n=>points[n]));
    if(!finite(measurement.volume)||measurement.volume<=0||measurement.quality<1e-10)throw Error('Inverted, degenerate or near-zero-quality tetrahedron.');
    volume+=measurement.volume;minVolume=Math.min(minVolume,measurement.volume);minQuality=Math.min(minQuality,measurement.quality);qualitySum+=measurement.quality;if(measurement.quality<.1)poorElements++;
    for(const local of FACES){const f=local.map(k=>ids[k]),key=faceKey(f),old=faces.get(key);
      if(!old)faces.set(key,{ids:f,cell:i/4,count:1});else {if(++old.count>2)throw Error('Nonmanifold tetrahedral face.');if(old.ids[(old.ids.indexOf(f[0])+1)%3]===f[1])throw Error('Adjacent tetrahedra have inconsistent face orientation.');parents[root(i/4)]=root(old.cell);}
    }
  }
  if(used.size!==count)throw Error('Mesh contains unused nodes.');
  if(parents.some((_,i)=>root(i)!==root(0)))throw Error('Volume mesh contains disconnected cell regions.');
  const exterior=new Map([...faces].filter(([,f])=>f.count===1));
  if(!Array.isArray(input.boundary)||!input.boundary.length||input.boundary.length>2000)throw Error('Invalid mesh boundary groups.');
  const boundary=[],tags=new Set(),mapped=new Set();
  for(const group of input.boundary){
    if(!Number.isSafeInteger(group.tag)||group.tag<1||tags.has(group.tag)||typeof group.type!=='string'||group.type.length>80||!finite(group.area)||group.area<=0||!Array.isArray(group.center)||group.center.length!==3||group.center.some(n=>!finite(n)||Math.abs(n)>10000)||!Array.isArray(group.triangles)||group.triangles.length%3||!group.triangles.length||group.triangles.length>600000)throw Error('Invalid mesh surface group.');
    tags.add(group.tag);const triangles=[];
    for(let i=0;i<group.triangles.length;i+=3){const ids=group.triangles.slice(i,i+3),key=faceKey(ids),face=exterior.get(key);
      if(!face||mapped.has(key)||ids.some(n=>!Number.isInteger(n)||n<0||n>=count))throw Error('Boundary triangles must match every exterior tetrahedral face exactly once.');mapped.add(key);triangles.push(...face.ids);
    }
    boundary.push({tag:group.tag,type:group.type,area:group.area,center:[...group.center],triangles});
  }
  if(mapped.size!==exterior.size)throw Error('Boundary has missing exterior tetrahedral faces.');
  if(!finite(input.cadVolume)||input.cadVolume<=0||Math.abs(volume/input.cadVolume-1)>.05)throw Error('Mesh volume differs from its CAD volume by over 5%. Refine the mesh.');
  if(input.mesher?.id!=='gmsh-tetra-1'||input.mesher.version!=='4.15.2'||input.mesher.algorithm!=='Delaunay'||input.mesher.order!==1||input.mesher.threads!==1||!/^[a-f0-9]{64}$/.test(input.stepSha256||''))throw Error('Unsupported or missing mesher provenance.');
  const bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
  points.forEach(p=>p.forEach((v,i)=>{bounds[0][i]=Math.min(bounds[0][i],v);bounds[1][i]=Math.max(bounds[1][i],v);}));
  return {mesh:{nodes,tetrahedra:[...tets],boundary,cadVolume:input.cadVolume,stepSha256:input.stepSha256,mesher:{...input.mesher}},
    stats:{nodes:count,elements:tets.length/4,boundaryTriangles:mapped.size,volume,minVolume,minQuality,meanQuality:qualitySum/(tets.length/4),poorElements,volumeError:Math.abs(volume/input.cadVolume-1),bounds}};
}
export function validateVolumeMeshRecord(input,validateSource,imported=false){
  if(!input||!identity(input.id)||!identity(input.provenance?.projectId)||!Number.isSafeInteger(input.provenance.revision)||input.provenance.revision<0||typeof input.provenance.createdAt!=='string'||!Number.isFinite(Date.parse(input.provenance.createdAt)))throw Error('Invalid volume-mesh provenance.');
  const source=validateSource(input.provenance.source).source;
  if(input.provenance.fingerprint!==JSON.stringify(source)||!source.meshes.some(m=>m.type==='gmsh-tetra'))throw Error('Volume-mesh source fingerprint or settings are missing.');
  const {mesh}=inspectVolumeMesh(input.mesh);
  return {id:input.id,provenance:{projectId:input.provenance.projectId,revision:input.provenance.revision,createdAt:input.provenance.createdAt,fingerprint:input.provenance.fingerprint,source},mesh,verified:!imported&&input.verified===true};
}
export function volumeMeshMSH(mesh){
  const lines=['$MeshFormat','2.2 0 8','$EndMeshFormat','$Nodes',String(mesh.nodes.length/3)];
  for(let i=0;i<mesh.nodes.length;i+=3)lines.push(`${i/3+1} ${mesh.nodes.slice(i,i+3).join(' ')}`);
  const surfaceCount=mesh.boundary.reduce((s,g)=>s+g.triangles.length/3,0);
  lines.push('$EndNodes','$Elements',String(surfaceCount+mesh.tetrahedra.length/4));let index=1;
  for(const g of mesh.boundary)for(let i=0;i<g.triangles.length;i+=3)lines.push(`${index++} 2 2 ${g.tag} ${g.tag} ${g.triangles.slice(i,i+3).map(n=>n+1).join(' ')}`);
  for(let i=0;i<mesh.tetrahedra.length;i+=4)lines.push(`${index++} 4 2 1 1 ${mesh.tetrahedra.slice(i,i+4).map(n=>n+1).join(' ')}`);
  lines.push('$EndElements');return lines.join('\n')+'\n';
}
// Render actual cell faces at a stepped cutaway, never a rectangular surrogate.
export function volumeMeshDisplay(mesh,axis=0,fraction=1){
  if(![0,1,2].includes(axis)||!finite(fraction)||fraction<0||fraction>1)throw Error('Invalid mesh cutaway.');
  const bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
  for(let i=0;i<mesh.nodes.length;i+=3)for(let j=0;j<3;j++){bounds[0][j]=Math.min(bounds[0][j],mesh.nodes[i+j]);bounds[1][j]=Math.max(bounds[1][j],mesh.nodes[i+j]);}
  const threshold=bounds[0][axis]+fraction*(bounds[1][axis]-bounds[0][axis]),faces=new Map();let visibleCells=0;
  for(let i=0;i<mesh.tetrahedra.length;i+=4){const ids=mesh.tetrahedra.slice(i,i+4);
    if(fraction<1&&ids.reduce((s,n)=>s+mesh.nodes[3*n+axis],0)/4>threshold)continue;visibleCells++;
    for(const local of FACES){const face=local.map(j=>ids[j]),key=faceKey(face);if(faces.has(key))faces.delete(key);else faces.set(key,{face,cell:i/4});}
  }
  const vertices=[],normals=[],triangles=[],nodeIndices=[],cellIndices=[],surfaceTags=[];
  const groupFaces=new Map();for(const g of mesh.boundary)for(let i=0;i<g.triangles.length;i+=3)groupFaces.set(faceKey(g.triangles.slice(i,i+3)),g.tag);
  for(const {face,cell} of faces.values()){
    surfaceTags.push(groupFaces.get(faceKey(face))??null);
    const points=face.map(n=>mesh.nodes.slice(3*n,3*n+3)),normal=cross(sub(points[1],points[0]),sub(points[2],points[0])),len=Math.hypot(...normal);
    for(let j=0;j<points.length;j++){const p=points[j];nodeIndices.push(face[j]);cellIndices.push(cell);triangles.push(vertices.length/3);vertices.push(...p.map(v=>v*1000));normals.push(...normal.map(v=>v/len));}
  }
  return {bounds,mesh:{vertices,normals,triangles},edges:[],visibleCells,nodeIndices,cellIndices,surfaceTags};
}
