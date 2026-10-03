import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createApplication,configuration} from '../server/index.mjs';

test('private HTTP routes isolate profiles, workspaces, canvases, media and exports',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'midnight-storage-'));
 const profiles={alice:{displayName:'Alice',bio:'',medium:'acrylic'},bob:{displayName:'Bob',bio:'',medium:'ink'}};
 const workspaces={},projects=[{id:'11111111-1111-4111-8111-111111111111',ownerSub:'alice',title:'Private Alice canvas',status:'complete',stepImages:[]}];
 const adapter={pool:{query:async()=>{}},session:async req=>req.headers.cookie?.split('=')[1]||null,auth:async()=>false,
  profile:async owner=>profiles[owner],saveProfile:async(owner,b)=>(profiles[owner]=b),workspace:async owner=>workspaces[owner]||{version:0,body:null},
  saveWorkspace:async(owner,b)=>{if((workspaces[owner]?.version||0)!==b.version)throw Object.assign(Error('conflict'),{status:409});workspaces[owner]={body:b.body,version:b.version+1};return workspaces[owner]},
  list:async owner=>projects.filter(p=>owner===undefined||p.ownerSub===owner),get:async id=>projects.find(p=>p.id===id),put:async()=>{},legacy:async()=>[],close:async()=>{}};
 const config=configuration({AI_PROVIDER:'mock',PUBLIC_ORIGIN:'http://127.0.0.1:12345',DATA_DIR:dir});
 const app=await createApplication(config,undefined,adapter);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+app.server.address().port;config.origin=url;
 const call=(path,who='',options={})=>fetch(url+path,{...options,headers:{origin:config.origin,...(who?{cookie:'test='+who}:{}),'Content-Type':'application/json',...options.headers}});
 try{
  assert.equal((await call('/api/profile')).status,401);
  assert.equal((await call('/api/profile','alice')).status,200);
  assert.equal((await (await call('/api/projects','bob')).json()).projects.length,0);
  for(const suffix of ['', '/images/reference','/export','/progress'])assert.equal((await call('/api/projects/'+projects[0].id+suffix,'bob',suffix==='/progress'?{method:'POST',body:'{"completedSteps":[]}'}:{})).status,404);
  const body={boards:[],pins:[],artProgress:{lesson:{done:[1]}}};
  assert.equal((await call('/api/workspace','alice',{method:'PUT',body:JSON.stringify({version:0,body})})).status,200);
  assert.equal((await (await call('/api/workspace','bob')).json()).body,null);
  assert.equal((await call('/api/workspace','alice',{method:'PUT',body:JSON.stringify({version:0,body})})).status,409);
  assert.equal((await call('/api/profile','alice',{method:'PUT',body:'{}',headers:{origin:'https://other.example'}})).status,403);
 }finally{await app.close();await rm(dir,{recursive:true,force:true})}
});

const boot=await readFile(new URL('../public/storage-boot.js',import.meta.url),'utf8');
async function startBoot(owner,remote,initial={}){
 class Storage{constructor(){this.values=new Map(Object.entries(initial))}getItem(k){return this.values.get(k)??null}setItem(k,v){this.values.set(k,String(v))}removeItem(k){this.values.delete(k)}}
 const localStorage=new Storage(),calls=[];
 const context={Storage,localStorage,window:{addEventListener(){}},document:{documentElement:{dataset:{}},getElementById:()=>({innerHTML:'',textContent:''}),querySelectorAll:()=>[],createElement:()=>({}),body:{append(e){e.onload()}},addEventListener(){}},
  fetch:async(path,options)=>{calls.push({path,options});return{ok:true,status:200,json:async()=>path==='/api/profile'?{owner,profile:{displayName:owner}}:options?.method==='PUT'?{version:remote.version+1}:remote}},setTimeout:()=>1,clearTimeout(){},Blob,URL,location:{reload(){}},installStudioProfile(){},render(){},dialog:{open:false},app:{querySelector:()=>true}};
 vm.createContext(context);await vm.runInContext(boot,context);return{context,localStorage,calls};
}
test('browser bootstrap separates legacy data and each account before studio scripts load',async()=>{
 const legacy='{"boards":[{"id":"older"}],"pins":[]}';
 const a=await startBoot('alice',{version:3,body:{boards:[{id:'alice-board'}],pins:[]}},{'pinwell-v1':legacy,'midnight:bob:pinwell-v1':'{"boards":[{"id":"bob-board"}],"pins":[]}'});
 assert.equal(JSON.parse(a.localStorage.getItem('pinwell-v1')).boards[0].id,'alice-board');
 assert.equal(a.localStorage.values.get('pinwell-v1'),legacy);
 assert.equal(a.localStorage.values.get('midnight:bob:pinwell-v1'),'{"boards":[{"id":"bob-board"}],"pins":[]}');
 a.localStorage.setItem('pinwell-v1','{"boards":[{"id":"alice-edited"}],"pins":[]}');await a.context.window.MidnightStorage.flush();
 const save=a.calls.find(x=>x.options?.method==='PUT');assert.equal(JSON.parse(save.options.body).version,3);assert.equal(JSON.parse(save.options.body).body.boards[0].id,'alice-edited');
});
test('a newer remote workspace blocks automatic overwrite while preserving the device draft',async()=>{
 const draft='{"boards":[{"id":"draft"}],"pins":[]}';
 const result=await startBoot('alice',{version:6,body:{boards:[{id:'remote'}],pins:[]}},{'midnight:alice:pinwell-v1':draft,'midnight:alice:sync':'{"dirty":true,"version":5}'});
 assert.equal(result.context.window.MidnightStorage.blocked,true);
 assert.equal(result.localStorage.getItem('pinwell-v1'),draft);
 assert.equal(await result.context.window.MidnightStorage.flush(),false);
 assert.equal(result.calls.filter(x=>x.options?.method==='PUT').length,0);
});

test('save before sign-out waits for an active request and saves edits made during it',async()=>{
 const result=await startBoot('alice',{version:3,body:{boards:[],pins:[]}});
 let release;
 const submitted=[];
 result.context.fetch=async(path,options)=>{
  submitted.push(JSON.parse(options.body));
  if(submitted.length===1)await new Promise(resolve=>{release=resolve});
  return {ok:true,status:200,json:async()=>({version:3+submitted.length})};
 };
 result.localStorage.setItem('pinwell-v1','{"boards":[{"id":"first"}],"pins":[]}');
 const first=result.context.window.MidnightStorage.flush();
 let finished=false;
 const beforeSignOut=result.context.window.MidnightStorage.flush().then(value=>{finished=true;return value});
 await Promise.resolve();assert.equal(finished,false);
 result.localStorage.setItem('pinwell-v1','{"boards":[{"id":"second"}],"pins":[]}');
 release();await first;
 assert.equal(await beforeSignOut,true);
 assert.equal(submitted.length,2);
 assert.equal(submitted[1].version,4);
 assert.equal(submitted[1].body.boards[0].id,'second');
});

test('a failed save preserves a dirty device draft and can retry without advancing its version',async()=>{
 const result=await startBoot('alice',{version:3,body:{boards:[],pins:[]}});
 const original=result.context.fetch;
 result.context.fetch=async()=>{throw Error('Offline')};
 result.localStorage.setItem('pinwell-v1','{"boards":[{"id":"offline"}],"pins":[]}');
 assert.equal(await result.context.window.MidnightStorage.flush(),false);
 assert.deepEqual(JSON.parse(result.localStorage.values.get('midnight:alice:sync')),{dirty:true,version:3});
 result.context.fetch=original;
 assert.equal(await result.context.window.MidnightStorage.flush(),true);
 assert.equal(JSON.parse(result.calls.find(x=>x.options?.method==='PUT').options.body).version,3);
 assert.deepEqual(JSON.parse(result.localStorage.values.get('midnight:alice:sync')),{dirty:false,version:4});
});
