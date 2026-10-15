// Screen-space edge picking with triangle-depth rejection. Inputs are viewer-normalized.
export function pickVisibleEdge(edges, vertices, triangles, matrix, scale, width, height, click) {
  const project = p => {
    const q=[0,1,2].map(i=>matrix[i]*p[0]+matrix[3+i]*p[1]+matrix[6+i]*p[2]);
    return [(q[0]*scale[0]+1)*width/2,(1-q[1]*scale[1])*height/2,q[2]];
  };
  const candidates=[];
  for(const edge of edges)for(let j=0;j<edge.lines.length;j+=6){
    const a=project(edge.lines.slice(j,j+3)),b=project(edge.lines.slice(j+3,j+6));
    const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;
    const t=d?Math.max(0,Math.min(1,((click[0]-a[0])*dx+(click[1]-a[1])*dy)/d)):0;
    const p=a.map((v,i)=>v+t*(b[i]-v)),distance=Math.hypot(p[0]-click[0],p[1]-click[1]);
    if(distance<=10)candidates.push({index:edge.index,p,distance});
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>a.distance-b.distance||b.p[2]-a.p[2]);
  const projected=[];for(let i=0;i<vertices.length;i+=3)projected.push(project(vertices.slice(i,i+3)));
  for(const candidate of candidates){
    const [x,y,z]=candidate.p;let hidden=false;
    for(let i=0;i<triangles.length;i+=3){
      const [a,b,c]=triangles.slice(i,i+3).map(k=>projected[k]);
      if(x<Math.min(a[0],b[0],c[0])-.1||x>Math.max(a[0],b[0],c[0])+.1||y<Math.min(a[1],b[1],c[1])-.1||y>Math.max(a[1],b[1],c[1])+.1)continue;
      const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
      if(Math.abs(den)<1e-12)continue;
      const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;
      const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den,w=1-u-v;
      if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6&&u*a[2]+v*b[2]+w*c[2]>z+2e-3){hidden=true;break;}
    }
    if(!hidden)return candidate.index;
  }
  return null;
}
