// Local UI fixture: no account, Supabase traffic or authentication state is used.
// Production HTML continues to require HCAuth.requireAdmin(). Bind only to loopback.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../docs/',import.meta.url));
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.stl':'model/stl','.md':'text/plain'};
const server=http.createServer(async(req,res)=>{try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,`.${pathname==='/'?'/headphone-workshop.html':pathname}`);
    if(!file.startsWith(root)){res.writeHead(403).end();return;}
    let data=await fs.readFile(file);
    if(['/headphone-workshop.html','/iem-designer.html','/design-studio.html','/'].includes(pathname)) {
        const fixture=data.toString().replace(/<script\s+src="(?:https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2|supabase-client\.js|auth\.js\?v=40)"\s*><\/script>/g,'');
        data=Buffer.from(fixture.replace('</head>','<script>window.HCAuth={requireAdmin:async()=>({user:{},isAdmin:true})};</script></head>').replace('WEB PREVIEW · 01','LOCAL UI TEST · 01'));
    }
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
}catch{res.writeHead(404).end('Not found');}});
server.listen(8765,'127.0.0.1',()=>process.stdout.write('Local workshop test fixture: http://127.0.0.1:8765/headphone-workshop.html\n'));
