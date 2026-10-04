import http from 'node:http';
import {createDibbyMCP} from './dibby-mcp.mjs';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {Store} from './store.mjs';
import {AppError,options,validatePlan,imageType,safePinterestURL} from './schema.mjs';
import {OpenAIProvider,MockProvider} from './provider.mjs';
import {browseTechniques,buildFallback,retrieveTechniques,validateAndShapeAnalysis,validateDibbyContext} from './dibby.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
import {openStudioStorage} from './studio-storage.mjs';
import {loadStudioSettings} from './studio-settings.mjs';
export function configuration(env=process.env,studioSettings={}){const host=env.HOST||'127.0.0.1',port=Number(env.PORT||3000),origin=env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`,password=env.APP_PASSWORD||'',loopback=['127.0.0.1','::1','localhost'].includes(host),dibbyDevMode=env.DIBBY_DEV_MODE==='true';if(!loopback&&password.length<16)throw Error('Non-loopback hosting requires APP_PASSWORD with at least 16 characters.');if(dibbyDevMode&&!loopback)throw Error('DIBBY_DEV_MODE=true is only allowed on a loopback host.');const provider=env.AI_PROVIDER||'openai';if(!['mock','openai'].includes(provider))throw Error('AI_PROVIDER must be mock or openai.');if(!['low','medium','high'].includes(env.IMAGE_QUALITY||'medium'))throw Error('Invalid IMAGE_QUALITY.');const limit=Number(env.MAX_PROVIDER_CALLS_PER_DAY||40);if(!Number.isInteger(limit)||limit<1)throw Error('Invalid provider-call limit.');const dibbyConcurrency=Number(env.DIBBY_MAX_CONCURRENT||1);if(!Number.isInteger(dibbyConcurrency)||dibbyConcurrency<1||dibbyConcurrency>3)throw Error('Invalid Dibby concurrency limit.');const dibbyTimeout=Number(env.DIBBY_TIMEOUT_MS||45000);if(!Number.isInteger(dibbyTimeout)||dibbyTimeout<1000||dibbyTimeout>120000)throw Error('Invalid Dibby timeout.');return {host,port,studioStorage:(env.MIDNIGHT_STORAGE||studioSettings.storage||'local')==='postgres',origin:new URL(origin).origin,password,dibbyDevMode,dibbyConcurrency,dibbyTimeout,dataDir:resolve(env.DATA_DIR||join(root,'data')),publicDir:join(root,'public'),publicCatalog:env.DIBBY_PUBLIC_CATALOG==='true',provider,limit,key:env.OPENAI_API_KEY||'',textModel:env.OPENAI_TEXT_MODEL||'gpt-4.1',imageModel:env.OPENAI_IMAGE_MODEL||'gpt-image-1.5',quality:env.IMAGE_QUALITY||'medium'};}
export async function createApplication(config,providerOverride,studioOverride){
 const store=new Store(config.dataDir),provider=providerOverride||(config.provider==='mock'?new MockProvider():new OpenAIProvider(config)),media=join(config.dataDir,'media');await mkdir(media,{recursive:true});
 const studio=studioOverride===undefined?await openStudioStorage(config,root):studioOverride;
 const projects=studio||store;
 if(studio){
  // Copy older canvases without assigning ownership. Import is explicit.
  for(const old of store.list()){
   if(!await studio.get(old.id))await studio.put(old);
   for(const name of ['reference','final','step-1','step-2','step-3','step-4','step-5','step-6']){
    try{if(await studio.image(old.id,name))continue;await studio.image(old.id,name,await readFile(join(media,old.id,name)))}catch(e){if(e.code!=='ENOENT')throw e}
   }
  }
 }
 const dibby=await createDibbyMCP(config);
 const queue=new Set(),creating=new Set(),sessions=new Map(),attempts=new Map(),dibbyInFlight=new Set();let busy=false,stopping=false,active=null;
 for(const p of (await projects.list())){if(['planning','rendering','queued-plan','queued-images'].includes(p.status)){p.status='interrupted';p.error='The server stopped during generation. Completed images are saved. Resume may repeat the last provider request and incur another charge.';await projects.put(p)}}
 const assetPath=(id,name)=>join(media,id,name),assetURL=(id,name)=>`/api/projects/${id}/images/${name}`;
 async function saveImage(p,name,bytes){if(bytes.length>25*1024*1024)throw new AppError('Generated image is too large.',502);imageType(bytes);if(studio){if(!await studio.get(p.id))await studio.put(p);await studio.image(p.id,name,bytes);return assetURL(p.id,name)}await mkdir(join(media,p.id),{recursive:true});await writeFile(assetPath(p.id,name)+'.tmp',bytes);await rename(assetPath(p.id,name)+'.tmp',assetPath(p.id,name));return assetURL(p.id,name)}
 async function loadImage(p,name){const bytes=studio?await studio.image(p.id,name):await readFile(assetPath(p.id,name));if(!bytes)throw new AppError('Image not found.',404);return {bytes,type:imageType(bytes)}}
 async function checkCancelled(p){const current=await projects.get(p.id);if(stopping||current?.cancelRequested)throw new AppError('Generation cancelled. Completed images are preserved.',409)}
 async function providerCall(p,fn){await checkCancelled(p);store.reserve(config.limit);const controller=new AbortController();active=controller;const timer=setTimeout(()=>controller.abort(),300000);try{return await fn(controller.signal)}finally{clearTimeout(timer);active=null}}
 async function checkpoint(p){const current=await projects.get(p.id);p.cancelRequested=current?.cancelRequested||false;p.completedSteps=current?.completedSteps||p.completedSteps;p.materialsChecked=current?.materialsChecked||p.materialsChecked;return await projects.put(p)}
 async function processQueue(){if(busy||stopping)return;busy=true;try{while(queue.size&&!stopping){const id=queue.values().next().value;queue.delete(id);const p=await projects.get(id);if(!p||p.cancelRequested)continue;try{
  const reference=await loadImage(p,'reference');
  if(!p.plan){p.status='planning';p.error='';await checkpoint(p);p.plan=await providerCall(p,s=>provider.plan(reference,p.options,s));await checkCancelled(p);p.status='review';await checkpoint(p);continue}
  if(!p.approved){p.status='review';await checkpoint(p);continue}
  p.status='rendering';p.error='';await checkpoint(p);
  if(!p.finalImage){const bytes=await providerCall(p,s=>provider.image({reference,plan:p.plan,opts:p.options,index:null},s));p.finalImage=await saveImage(p,'final',bytes);await checkpoint(p);await checkCancelled(p)}
  const final=await loadImage(p,'final');
  for(let i=0;i<6;i++){if(p.stepImages[i])continue;await checkCancelled(p);p.currentStep=i+1;await checkpoint(p);const previous=i?await loadImage(p,'step-'+i):null;const bytes=await providerCall(p,s=>provider.image({reference,final,previous,plan:p.plan,opts:p.options,index:i},s));p.stepImages[i]=await saveImage(p,'step-'+(i+1),bytes);await checkpoint(p);await checkCancelled(p)}
  p.status='complete';p.currentStep=6;await checkpoint(p);
 }catch(e){const latest=await projects.get(id);p.status=latest?.cancelRequested?'cancelled':stopping?'interrupted':'failed';p.cancelRequested=latest?.cancelRequested||false;p.error=e instanceof AppError?e.message:e.name==='AbortError'?'The request timed out or was cancelled. The provider may have charged for it. Completed images are saved.':e.message?.startsWith('Daily provider-call')?e.message:'Generation could not finish. Completed images are saved. You can resume manually.';await checkpoint(p)}}}finally{busy=false}}
 const enqueue=p=>{queue.add(p.id);void processQueue().catch(()=>console.error('Canvas queue paused after a storage error. Restart or resume after storage recovers.'))};
 function send(res,status,value,type='application/json'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(type==='application/json'?JSON.stringify(value):value)}
 async function body(req,max=12*1024*1024){if(Number(req.headers['content-length']||0)>max)throw new AppError('Request is too large.',413);let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>max)throw new AppError('Request is too large.',413);chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new AppError('Invalid JSON.')}}
 async function referenceFrom(b){let bytes;if(b.imageData){const match=String(b.imageData).match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);if(!match)throw new AppError('Upload a PNG, JPEG, or WebP image.');bytes=Buffer.from(match[1],'base64')}else{const response=await fetch(safePinterestURL(b.imageURL),{redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new AppError('The reference could not be downloaded. Upload a saved copy instead.');const reader=response.body.getReader();let size=0;const chunks=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw new AppError('Reference must be under 8 MB.')}chunks.push(value)}bytes=Buffer.concat(chunks)}if(bytes.length>8*1024*1024)throw new AppError('Reference must be under 8 MB.');return {bytes,type:imageType(bytes)}}
 function dibbyPhotoFrom(b){if(b.imageURL)throw new AppError('Dibby progress photos must be uploaded directly; remote image URLs are not accepted.');if(!b.imageData)return null;const match=String(b.imageData).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);if(!match)throw new AppError('Attach a PNG, JPEG, or WebP progress photo.');const bytes=Buffer.from(match[2],'base64');if(bytes.length>8*1024*1024)throw new AppError('Progress photos must be under 8 MB.');const type=imageType(bytes);if(type!==match[1])throw new AppError('The progress photo type does not match its file contents.');return {bytes,type}}
 const loginPage=`<!doctype html><meta name="viewport" content="width=device-width"><title>The Midnight Palette — Sign in</title><style>body{font:18px system-ui;max-width:420px;margin:15vh auto;padding:24px;background:#111819;color:#eee5d3}h1{font:36px Georgia,serif;color:#d9c08b}p{color:#c0b49e}input{background:#1c2526;color:#eee5d3;border:1px solid #595847}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin:8px 0}button{background:#c6ac76;color:#111819;border:0;border-radius:8px}</style><h1>The Midnight Palette</h1><p>Your new 2am Obsession.</p><p>Enter your app password.</p><form><input type="password" name="password" autocomplete="current-password" required aria-label="App password"><button>Sign in</button></form><p role="alert" id="error"></p><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:e.target.password.value})});if(r.ok)location.href='/';else document.getElementById('error').textContent='Sign-in failed. Check your password or try later.'}</script>`;
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/health'&&['GET','HEAD'].includes(req.method)){if(studio)await studio.pool.query('SELECT 1');return send(res,200,req.method==='HEAD'?'':{ok:true,service:'midnight-palette',storage:studio?'fedora-postgresql':'local',databaseReady:Boolean(studio)})}
  if(req.headers.host!==new URL(config.origin).host)throw new AppError('Unrecognized host. Set PUBLIC_ORIGIN to the URL you use.',403);
  const requestPath=new URL(req.url,config.origin).pathname;
  if(requestPath==='/mcp'&&config.publicCatalog)return await dibby(req,res);
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==config.origin)throw new AppError('Requests must come from this app.',403);
  if(studio&&requestPath.startsWith('/auth/aibry-id/')){
   const oldSession=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('pinwell_session='))?.slice(16);
   if(await studio.auth(req,res,requestPath,new URL(req.url,config.origin),sessions.get(oldSession)>Date.now()))return;
  }
  if(req.headers['sec-fetch-site']==='cross-site')throw new AppError('Cross-site requests are not allowed.',403);
  const url=new URL(req.url,config.origin),path=url.pathname;
  if(path==='/api/login'&&req.method==='POST'){const b=await body(req,4096),ip=req.socket.remoteAddress,now=Date.now();let a=attempts.get(ip)||{count:0,until:now+600000};if(a.until<now)a={count:0,until:now+600000};if(a.count>=10)throw new AppError('Try again in ten minutes.',429);a.count++;attempts.set(ip,a);const hash=v=>createHash('sha256').update(v).digest();if(!config.password||!timingSafeEqual(hash(String(b.password||'')),hash(config.password)))throw new AppError('Invalid password.',401);attempts.delete(ip);for(const [k,v] of sessions)if(v<Date.now())sessions.delete(k);const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+86400000);res.setHeader('Set-Cookie',`pinwell_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${config.origin.startsWith('https:')?'; Secure':''}`);return send(res,200,{ok:true})}
  if(!studio&&config.password){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('pinwell_session='))?.slice(16);if(!token||!(sessions.get(token)>Date.now())){if(path.startsWith('/api/'))throw new AppError('Sign in to continue.',401);return send(res,401,loginPage,'text/html; charset=utf-8')}}
  const owner=studio?await studio.session(req):null;
  if(studio&&!owner){
   if(path.startsWith('/api/'))throw new AppError('Sign in with AIBRY ID to continue.',401);
   return send(res,401,loginPage.replace('Enter your app password.','Sign in to your private studio with AIBRY ID.').replace('<form>','<p><a style="color:#d9c08b" href="/auth/aibry-id/login">Sign in with AIBRY ID</a></p><details><summary>Connect a new profile</summary><p>Enter the existing studio invitation password, then connect your AIBRY ID. This studio has room for two profiles.</p><form>').replace('</form>','</form></details>'),'text/html; charset=utf-8');
  }
  if(studio){
   if(path==='/api/profile'&&req.method==='GET')return send(res,200,{owner,profile:await studio.profile(owner),storage:'Fedora PostgreSQL'});
   if(path==='/api/profile'&&req.method==='PUT')return send(res,200,{profile:await studio.saveProfile(owner,await body(req,4096))});
   if(path==='/api/workspace'&&req.method==='GET')return send(res,200,await studio.workspace(owner));
   if(path==='/api/workspace'&&req.method==='PUT')return send(res,200,await studio.saveWorkspace(owner,await body(req,12*1024*1024)));
   if(path==='/api/legacy-canvases'&&req.method==='GET')return send(res,200,{projects:await studio.legacy()});
   if(path==='/api/legacy-canvases'&&req.method==='POST'){const b=await body(req,4096);if(typeof b.id!=='string'||!/^[a-f0-9-]{36}$/.test(b.id))throw new AppError('Choose a canvas to import.');return send(res,200,await studio.claim(owner,b.id))}
   if(path==='/api/logout'&&req.method==='POST'){await studio.logout(req,res);return send(res,200,{ok:true})}
  }
  if(path==='/api/status'&&req.method==='GET')return send(res,200,{ready:provider.ready,mock:provider.mock,provider:config.provider,models:{text:config.textModel,image:config.imageModel},dailyCallLimit:config.limit});
  if(path==='/api/dibby/status'&&req.method==='GET'){
   const cards=store.listTechniques(),coverage=store.resourceCoverage();return send(res,200,{curated:true,liveAvailable:provider.ready,photoAnalysis:true,conversationLimit:8,dailyCallLimit:config.limit,authConfigured:Boolean(studio||config.password),developerMode:config.dibbyDevMode,reviewedCards:cards.filter(x=>x.reviewStatus==='verified').length,cardCount:cards.length,coverage:{cardsWithReviewedDemonstrations:coverage.filter(x=>x.reviewedResources>0).length,cardsWithAvailableDemonstrations:coverage.filter(x=>x.availableResources>0).length,textOnlyCards:coverage.filter(x=>x.availableResources===0).length},privacy:'Progress photos are analyzed in memory and are not retained by the server.'});
  }
  if(path==='/api/dibby/coverage'&&req.method==='GET')return send(res,200,{coverage:store.resourceCoverage()});
  if(path==='/api/dibby/techniques'&&req.method==='GET'){
   const medium=url.searchParams.get('medium')||'',query=url.searchParams.get('q')||'';return send(res,200,{techniques:browseTechniques(store.listTechniques(),query,medium)});
  }
  if(path==='/api/dibby/feedback'&&req.method==='POST'){
   if(!studio&&!config.password&&!config.dibbyDevMode)throw new AppError('Dibby feedback is unavailable until authentication is configured.',503);
   const b=await body(req,4096),techniqueId=b.techniqueId==null?'':String(b.techniqueId);if(techniqueId&&!store.getTechnique(techniqueId))throw new AppError('Unknown technique.');if(typeof b.helped!=='boolean')throw new AppError('Feedback must say whether the advice helped.');const comment=b.comment==null?'':String(b.comment).trim();if(comment.length>500)throw new AppError('Feedback is too long.');store.addFeedback({id:randomUUID(),techniqueId,helped:b.helped,comment});return send(res,201,{ok:true});
  }
  if(path==='/api/dibby/ask'&&req.method==='POST'){
   if(!studio&&!config.password&&!config.dibbyDevMode)throw new AppError('Live Dibby assistance is unavailable until APP_PASSWORD is configured, or explicit loopback DIBBY_DEV_MODE=true is enabled.',503);
   const b=await body(req,12*1024*1024),key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[A-Za-z0-9-]{16,100}$/.test(key))throw new AppError('A request ID is required.');const previous=store.findDibbyRequest(studio?owner+':'+key:key);if(previous)return send(res,previous.status,previous.response);if(dibbyInFlight.has(key))throw new AppError('This Dibby request is already in progress.',409);if(dibbyInFlight.size>=config.dibbyConcurrency)throw new AppError('Dibby is helping another artist right now. Try again in a moment.',429);
   dibbyInFlight.add(key);const requestId=randomUUID();res.setHeader('X-Request-Id',requestId);let response,status=200;try{
    const {context,conversation}=validateDibbyContext(b),photo=dibbyPhotoFrom(b),all=store.listTechniques(),candidates=retrieveTechniques(all,context);
    console.info(JSON.stringify({event:'dibby_classification',requestId,provider:provider.mock?'mock':'configured',medium:context.medium,focus:context.focus||'',categories:context.problemCategories,symptoms:context.symptoms,candidateTechniqueIds:candidates.map(x=>x.id),candidateResourceIds:candidates.flatMap(x=>(x.resources||[]).map(r=>r.id)).slice(0,12),photo:Boolean(photo),conversationMessages:conversation.length}));
    if(!provider.ready||!candidates.length){response=buildFallback(candidates,context,{liveAvailable:provider.ready});response.photoAnalyzed=Boolean(photo);response.privacy='The progress photo was used for this request only and was not retained.';store.setDibbyRequest(studio?owner+':'+key:key,200,response);return send(res,200,response)}
    store.reserve(config.limit);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),config.dibbyTimeout);try{const analysis=await provider.coach({question:context.question,context,conversation,photo,candidates},controller.signal);response=validateAndShapeAnalysis(analysis,candidates,context);response.photoAnalyzed=Boolean(photo);response.privacy='The progress photo was used for this request only and was not retained.';store.setDibbyRequest(studio?owner+':'+key:key,200,response);return send(res,200,response)}finally{clearTimeout(timer)}
   }catch(e){status=e instanceof AppError?e.status:e.name==='AbortError'?504:502;response={error:e instanceof AppError?e.message:e.name==='AbortError'?'Dibby timed out. Retry with a new request ID.':'Dibby could not complete this request.'};store.setDibbyRequest(studio?owner+':'+key:key,status,response);return send(res,status,response)}finally{dibbyInFlight.delete(key)}
  }
  if(path==='/api/projects'&&req.method==='GET')return send(res,200,{projects:await projects.list(...(studio?[owner]:[]))});
  if(path==='/api/projects'&&req.method==='POST'){
   if(!provider.ready)throw new AppError('AI is not connected yet. Add OPENAI_API_KEY to the server .env file and restart.',503);
   const b=await body(req);const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[A-Za-z0-9-]{16,100}$/.test(key))throw new AppError('A request ID is required.');let existing=(studio?await studio.findRequest(owner,key):store.findRequest(key));if(existing)return send(res,200,await projects.get(existing));if(creating.has(key))throw new AppError('This request is already being prepared. Retry in a moment.',409);
   if((await projects.list()).filter(p=>['queued-plan','planning','queued-images','rendering'].includes(p.status)).length>=5)throw new AppError('Five projects are already queued. Wait for one to finish.',429);
   creating.add(key);try{const reference=await referenceFrom(b);existing=(studio?await studio.findRequest(owner,key):store.findRequest(key));if(existing)return send(res,200,await projects.get(existing));
   const p={id:randomUUID(),...(studio?{ownerSub:owner}:{}),title:String(b.title||'Untitled painting').slice(0,150),sourcePinId:String(b.sourcePinId||'').slice(0,100),sourceURL:/^https?:\/\//.test(b.sourceURL||'')?String(b.sourceURL).slice(0,2000):'',options:options(b),status:'queued-plan',approved:false,plan:null,finalImage:null,stepImages:[],completedSteps:[],mock:provider.mock,createdAt:new Date().toISOString(),error:'',cancelRequested:false};p.referenceImage=await saveImage(p,'reference',reference.bytes);await projects.put(p);if(studio)await studio.setRequest(owner,key,p.id);else store.setRequest(key,p.id);enqueue(p);return send(res,202,p)}finally{creating.delete(key)}
  }
  const match=path.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(.*))?$/);
  if(match){let p=await projects.get(match[1]);if(!p||(studio&&p.ownerSub!==owner))throw new AppError('Project not found.',404);const action=match[2]||'';
   if(!action&&req.method==='GET')return send(res,200,p);
   if(action.startsWith('images/')&&req.method==='GET'){const name=action.slice(7);if(!/^(reference|final|step-[1-6])$/.test(name))throw new AppError('Image not found.',404);try{const im=await loadImage(p,name);return send(res,200,im.bytes,im.type)}catch{throw new AppError('Image not found.',404)}}
   if(action==='export'&&req.method==='GET'){res.setHeader('Content-Disposition',`attachment; filename="pinwell-${p.id}.json"`);const bundle={format:'pinwell-ai-project-v1',project:p,images:{}};for(const name of ['reference','final',...p.stepImages.map((_,i)=>'step-'+(i+1))]){try{const im=await loadImage(p,name);bundle.images[name]=`data:${im.type};base64,${im.bytes.toString('base64')}`}catch{}}return send(res,200,bundle)}
   if(req.method==='POST'&&action==='cancel'){if(['complete','review','failed','interrupted','cancelled'].includes(p.status))throw new AppError('This project is not running.',409);p.cancelRequested=true;queue.delete(p.id);if(!['planning','rendering'].includes(p.status))p.status='cancelled';await projects.put(p);return send(res,200,p)}
   if(req.method==='POST'&&action==='generate'){
    if(!provider.ready)throw new AppError('Add an API key and restart the server first.',503);
    if(p.status!=='review')throw new AppError('This project is not awaiting review.',409);const b=await body(req,64000);p=await projects.get(p.id);if(p.status!=='review')throw new AppError('This project is already running.',409);if(b.plan)p.plan=validatePlan(b.plan);p.approved=true;p.cancelRequested=false;p.status='queued-images';await projects.put(p);enqueue(p);return send(res,202,p);
   }
   if(req.method==='POST'&&action==='resume'){if(!provider.ready)throw new AppError('AI is not connected.',503);if(!['failed','interrupted','cancelled'].includes(p.status))throw new AppError('This project cannot be resumed right now.',409);p.cancelRequested=false;p.status=p.plan?'queued-images':'queued-plan';p.error='';await projects.put(p);enqueue(p);return send(res,202,p)}
   if(req.method==='POST'&&action==='canvas'){if(p.status!=='complete')throw new AppError('Finish generating the tutorial before saving it as a canvas.',409);p.savedCanvas=true;p.savedAt=p.savedAt||new Date().toISOString();await projects.put(p);return send(res,200,p)}
   if(req.method==='POST'&&action==='materials'){const b=await body(req,4096);p=await projects.get(p.id);if(typeof b.item!=='string'||!b.item.trim()||b.item.length>300||typeof b.checked!=='boolean')throw new AppError('Invalid material selection.');const items=new Set(p.materialsChecked||[]);if(b.checked)items.add(b.item);else items.delete(b.item);if(items.size>100)throw new AppError('Too many materials.');p.materialsChecked=[...items];await projects.put(p);return send(res,200,p)}
   if(req.method==='POST'&&action==='progress'){const b=await body(req,4096);p=await projects.get(p.id);if(!Array.isArray(b.completedSteps)||b.completedSteps.some(x=>!Number.isInteger(x)||x<0||x>5))throw new AppError('Invalid progress.');p.completedSteps=[...new Set(b.completedSteps)];await projects.put(p);return send(res,200,p)}
   throw new AppError('Action not found.',404);
  }
  if(path.startsWith('/api/'))throw new AppError('Endpoint not found.',404);
  if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('Method not allowed.',405);
  const file=resolve(config.publicDir,'.'+decodeURIComponent(path==='/'?'/index.html':path));if(!file.startsWith(config.publicDir+sep))throw new AppError('Not found.',404);let bytes;try{bytes=await readFile(file)}catch{throw new AppError('Not found.',404)}const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'};send(res,200,req.method==='HEAD'?'':bytes,types[extname(file)]||'application/octet-stream');
 }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'The server could not complete this request.'});else res.end()}});
 return {server,store,async close(){stopping=true;active?.abort();await new Promise(r=>server.close(r));while(busy)await new Promise(r=>setTimeout(r,10));if(studio)await studio.close();store.close()}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const config=configuration(process.env,await loadStudioSettings(join(root,'studio-settings.json')));const app=await createApplication(config);app.server.listen(config.port,config.host,()=>console.log(`The Midnight Palette: ${config.origin}\nAI: ${config.provider==='mock'?'MOCK — test fixtures only':config.key?'configured (not yet verified)':'setup mode — add OPENAI_API_KEY when ready'}`));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));}


