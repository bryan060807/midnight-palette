// Load a user's Fedora workspace before the studio scripts read localStorage.
(async()=>{
 async function studioFetch(url,options={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch(url,{...options,signal:controller.signal});const payload=response.status===404?null:await response.json();return {ok:response.ok,status:response.status,json:async()=>payload}}catch(e){if(e.name==='AbortError')throw Error('Your studio connection timed out. Your draft stays on this device.');throw e}finally{clearTimeout(timeout)}
 }
 const scripts=['app.js','tutorials.js','studio.js','pinterest-transfer.js','visual-lessons.js','pinterest-images.js','studio-enhancements.js','canvas-ai.js','midnight-brand.js','dibby.js','profile.js'];
 const nativeGet=Storage.prototype.getItem,nativeSet=Storage.prototype.setItem,nativeRemove=Storage.prototype.removeItem;
 const get=k=>nativeGet.call(localStorage,k),set=(k,v)=>nativeSet.call(localStorage,k,v);
 let profile,remote;
 try{
  const r=await studioFetch('/api/profile',{cache:'no-store'});
  if(r.status!==404){if(!r.ok)throw Error('Sign in to open your studio.');profile=await r.json();const w=await studioFetch('/api/workspace',{cache:'no-store'});if(!w.ok)throw Error('Your saved studio is temporarily unavailable.');remote=await w.json()}
 }catch(e){document.getElementById('app').innerHTML='<main style="max-width:36rem;margin:12vh auto;padding:24px"><h1>Your studio is waiting</h1><p id="startupError"></p><p><a href="/">Try again or sign in</a></p></main>';document.getElementById('startupError').textContent=e.message;return}
 if(profile){
  const prefix='midnight:'+profile.owner+':',keys=new Set(['pinwell-v1','pinwell-theme','midnight-dibby-ideas']);
  const scoped=k=>prefix+k;
  let version=remote.version,busy=false,pending=false,blocked=false,enabled=false,timer,status='Saved to Fedora';
  const saveWaiters=[];
  const loadPreferences=body=>{const prefs=body?.studioPreferences||{};set(scoped('pinwell-theme'),prefs.theme==='light'?'light':'dark');set(scoped('midnight-dibby-ideas'),JSON.stringify(Array.isArray(prefs.ideas)?prefs.ideas:[]))};
  let cache;try{cache=JSON.parse(get(scoped('sync'))||'null')}catch{cache=null}
  if(cache?.dirty&&get(scoped('pinwell-v1'))){
   version=cache.version;
   pending=true;
   if(remote.version!==version){blocked=true;status='Another device saved changes. Review in Profile.'}else status='Unsaved changes on this device';
  }else if(remote.body){
   set(scoped('pinwell-v1'),JSON.stringify(remote.body));
   loadPreferences(remote.body);
  }else{
   nativeRemove.call(localStorage,scoped('pinwell-v1'));
   loadPreferences(null);
  }
  const mark=()=>{try{set(scoped('sync'),JSON.stringify({dirty:pending,version}))}catch{}};
  const update=()=>{document.querySelectorAll('[data-sync-status]').forEach(e=>e.textContent=status)};
  const schedule=()=>{pending=true;mark();if(enabled){status=blocked?'Another device saved changes. Review in Profile.':'Saving…';update();clearTimeout(timer);timer=setTimeout(flush,700)}};
  Storage.prototype.getItem=function(k){return nativeGet.call(this,this===localStorage&&keys.has(k)?scoped(k):k)};
  Storage.prototype.setItem=function(k,v){const before=nativeGet.call(this,this===localStorage&&keys.has(k)?scoped(k):k);nativeSet.call(this,this===localStorage&&keys.has(k)?scoped(k):k,v);if(this===localStorage&&keys.has(k)&&before!==String(v))schedule()};
  Storage.prototype.removeItem=function(k){nativeRemove.call(this,this===localStorage&&keys.has(k)?scoped(k):k);if(this===localStorage&&keys.has(k))schedule()};
  async function flush(){
   if(busy){await new Promise(resolve=>saveWaiters.push(resolve));return flush()}
   if(blocked||!pending)return !pending&&!blocked;
   const saved=get(scoped('pinwell-v1'));if(!saved)return false;
   busy=true;pending=false;
   try{const body=JSON.parse(saved);body.studioPreferences={theme:get(scoped('pinwell-theme'))||'dark',ideas:JSON.parse(get(scoped('midnight-dibby-ideas'))||'[]')};
    const r=await studioFetch('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,body})});const result=await r.json();
    if(r.status===409){blocked=true;throw Error('Another device saved changes. Review in Profile.')}
    if(!r.ok)throw Error(r.status===401?'Sign-in expired. Your draft is saved on this device.':result.error||'Saved on this device. Waiting to sync.');
    version=result.version;status='Saved to Fedora';
   }catch(e){pending=true;status=e.message}
   finally{busy=false;mark();update();if(pending&&!blocked){clearTimeout(timer);timer=setTimeout(flush,10000)}saveWaiters.splice(0).forEach(resolve=>resolve())}
   return !pending&&!blocked;
  }
  document.documentElement.dataset.theme=localStorage.getItem('pinwell-theme')==='light'?'light':'dark';
  const download=()=>{const body=JSON.parse(get(scoped('pinwell-v1'))||'{"boards":[],"pins":[]}');const blob=new Blob([JSON.stringify({...body,format:'pinwell-v1'})],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='midnight-palette-studio-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
  window.MidnightStorage={profile,get status(){return status},get blocked(){return blocked},flush,download,ready(){enabled=true;if(pending)void flush();update()},
   async resolve(useDevice){
    const r=await studioFetch('/api/workspace',{cache:'no-store'});if(!r.ok)throw Error('Could not read the saved studio.');const latest=await r.json();
    if(useDevice){version=latest.version;blocked=false;pending=true;mark();return flush()}
    download();set(scoped('pinwell-v1'),JSON.stringify(latest.body||{boards:[],pins:[],demo:false,artMigrated:true,artProgress:{},artSaved:[]}));
    loadPreferences(latest.body);nativeRemove.call(localStorage,scoped('sync'));location.reload();return true;
   },
   get legacy(){try{return JSON.parse(get('pinwell-v1')||'null')}catch{return null}},
   legacyImported(){set(scoped('legacy-imported'),'yes')},get hasImported(){return get(scoped('legacy-imported'))==='yes'}
  };
  window.addEventListener('online',()=>void flush());
  window.addEventListener('beforeunload',e=>{if(pending||busy){e.preventDefault();e.returnValue=''}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void flush()});
 }
 try{for(const script of scripts)await new Promise((resolve,reject)=>{const e=document.createElement('script');e.src='/'+script+'?v=hardening-20261004';e.onload=resolve;e.onerror=()=>reject(Error('A studio component could not load.'));document.body.append(e)});
  // Install the profile wrapper after all existing studio wrappers.
  if(typeof installStudioProfile==='function')installStudioProfile();
  if(typeof render==='function')render();
  window.MidnightStorage?.ready();
  window.addEventListener('pageshow',()=>{if(!dialog.open&&(!app.querySelector('#openAIProjects')||!app.querySelector('.pinterest-transfer-button')||!app.querySelector('#themeToggle')))render()});
 }catch(e){document.getElementById('app').textContent=e.message+' Refresh to try again.'}
})().catch(()=>{document.getElementById('app').textContent='Your studio could not open because browser storage is unavailable. Free some device space, then reload. Your saved studio remains on the server.'});
