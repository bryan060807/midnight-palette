import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication,configuration} from '../server/index.mjs';
test('read-only MCP catalog works without cookie; private app remains protected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dibby-'));const config=configuration({DATA_DIR:dir,AI_PROVIDER:'mock',APP_PASSWORD:'a-test-password-long-enough',DIBBY_PUBLIC_CATALOG:'true'});const app=await createApplication(config);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 config.origin=base;
 const headers={Host:new URL(config.origin).host,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 const call=async(method,params={})=>{const r=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});assert.equal(r.status,200);return (await r.json()).result};
 try{
  assert.equal((await call('initialize',{protocolVersion:'2025-03-26'})).protocolVersion,'2025-03-26');
  const {tools}=await call('tools/list');assert.equal(tools.length,3);assert.ok(tools.every(t=>t.annotations.readOnlyHint));
  const result=await call('tools/call',{name:'find_canvases',arguments:{medium:'Acrylic',minutes:75,limit:3}});assert.ok(result.structuredContent.canvases.length);assert.ok(result.structuredContent.canvases.every(p=>p.minutes<=75&&p.medium==='Acrylic'));
  const lesson=await call('tools/call',{name:'get_canvas',arguments:{id:result.structuredContent.canvases[0].id}});assert.equal(lesson.structuredContent.steps.length,6);assert.ok(lesson.structuredContent.url.includes('#tutorial='));
  assert.ok((await call('tools/call',{name:'get_canvas',arguments:{id:'../../.env'}})).isError);
  assert.ok((await call('tools/call',{name:'find_canvases',arguments:{limit:-1}})).isError);
  assert.equal(app.store.list().length,0);
  assert.equal((await fetch(base+'/api/projects',{headers:{Host:headers.Host}})).status,401);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/mcp',{headers})).status,405);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers,body:'x'})).status,400);
 }finally{await app.close();await rm(dir,{recursive:true,force:true})}
});
test('MCP is disabled unless explicitly enabled',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dibby-off-'));const config=configuration({DATA_DIR:dir,AI_PROVIDER:'mock',APP_PASSWORD:'a-test-password-long-enough'});const app=await createApplication(config);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+app.server.address().port;try{assert.equal((await fetch(config.origin+'/mcp',{method:'POST',headers:{Host:new URL(config.origin).host,'Content-Type':'application/json',Origin:config.origin},body:'{}'})).status,401)}finally{await app.close();await rm(dir,{recursive:true,force:true})}
});
