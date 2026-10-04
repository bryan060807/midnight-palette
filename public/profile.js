function installStudioProfile(){
 const sync=window.MidnightStorage;if(!sync)return;
 const base=render;
 render=function(){base();const top=app.querySelector('.topright');if(top){const button=document.createElement('button');button.className='btn studio-profile-button';button.id='openProfile';button.textContent='Profile';button.onclick=openStudioProfile;top.append(button)}
  const saved=app.querySelector('.topright .saved');if(saved){saved.textContent='';const status=document.createElement('span');status.setAttribute('data-sync-status','');saved.append(status)}const storage=app.querySelector('.storage');if(storage)storage.innerHTML='<b>Your private studio</b><span data-sync-status></span>';
  app.querySelectorAll('[data-sync-status]').forEach(e=>e.textContent=sync.status);
 };
 async function request(path,options={}){const r=await fetch(path,{cache:'no-store',...options});const b=await r.json();if(!r.ok)throw Error(b.error||'Please try again.');return b}
 async function openStudioProfile(){
  const p=sync.profile.profile;
  modal('Your artist profile',`<form id="profileForm" class="profile-form"><label>Display name<input name="displayName" maxlength="80" required value="${esc(p.displayName)}" autocomplete="nickname"></label><label>A little about you<textarea name="bio" maxlength="500" rows="3">${esc(p.bio)}</textarea></label><label>Favorite medium<select name="medium">${['acrylic','watercolor','graphite','charcoal','colored pencil','ink','oil','mixed media'].map(m=>`<option ${p.medium===m?'selected':''}>${m}</option>`).join('')}</select></label><div class="dialogactions"><button type="button" class="btn" id="profileClose">Close</button><button class="btn primary">Save profile</button></div></form><p id="profileMessage" role="status"></p><section class="profile-sync"><h3>Your studio</h3><p data-sync-status>${esc(sync.status)}</p><p>Your boards, lesson progress, and canvases follow your AIBRY ID across devices.</p><div class="profile-actions"><button class="btn" id="syncNow">Save now</button><button class="btn" id="studioBackup">Export backup</button>${sync.blocked?'<button class="btn" id="useSaved">Load saved studio</button><button class="btn" id="useDevice">Keep this device’s version</button>':''}${sync.legacy&&!sync.hasImported?'<button class="btn" id="importBrowser">Import older browser boards</button>':''}</div><div id="legacyCanvasList"></div></section><div class="profile-actions"><button class="btn" id="profileSignOut">Sign out</button></div>`);
  const message=t=>{const e=document.getElementById('profileMessage');if(e)e.textContent=t};
  const run=fn=>async()=>{try{await fn()}catch(e){message(e.message)}};
  document.getElementById('profileClose').onclick=()=>dialog.close();
  document.getElementById('profileForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{const b=await request('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(f))});sync.profile.profile=b.profile;message('Profile saved.')}catch(error){message(error.message)}};
  document.getElementById('syncNow').onclick=run(async()=>message(await sync.flush()?'Studio saved to Fedora.':sync.status));
  document.getElementById('studioBackup').onclick=sync.download;
  const useSaved=document.getElementById('useSaved');if(useSaved)useSaved.onclick=run(async()=>{if(confirm('Load the saved studio? A backup of this device’s draft will download first.'))await sync.resolve(false)});
  const useDevice=document.getElementById('useDevice');if(useDevice)useDevice.onclick=run(async()=>{if(confirm('Replace the saved studio with this device’s version? Export both versions first if you need to keep both.')){message(await sync.resolve(true)?'This device’s version is now saved.':sync.status)}});
  const importBrowser=document.getElementById('importBrowser');if(importBrowser)importBrowser.onclick=()=>{
   const old=sync.legacy;if(!old||!Array.isArray(old.boards)||!Array.isArray(old.pins)){message('No older browser boards were found.');return}
   if(!confirm(`Import ${old.boards.length} boards and ${old.pins.length} pins from this browser into ${p.displayName}’s profile?`))return;
   const merge=(a,b)=>{const ids=new Set(a.map(x=>x.id));return a.concat(b.filter(x=>!ids.has(x.id)))};
   data.boards=merge(data.boards,old.boards);data.pins=merge(data.pins,old.pins);data.artSaved=[...new Set([...(data.artSaved||[]),...(old.artSaved||[])])];data.artProgress={...(old.artProgress||{}),...(data.artProgress||{})};data.demo=false;
   persist();sync.legacyImported();importBrowser.disabled=true;message('Older browser boards imported. Saving your studio…');render();
  };
  document.getElementById('profileSignOut').onclick=run(async()=>{if(!await sync.flush()){message(sync.status+' Export a backup before signing out.');return}await request('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});location.href='/'});
  try{const b=await request('/api/legacy-canvases');const holder=document.getElementById('legacyCanvasList');if(holder&&b.projects.length){holder.innerHTML='<h3>Older generated canvases</h3><p>Choose which canvases belong in your profile.</p>'+b.projects.map(x=>`<button class="btn legacy-import" data-legacy="${esc(x.id)}">Import ${esc(x.title||'Untitled canvas')}</button>`).join('');holder.querySelectorAll('[data-legacy]').forEach(e=>e.onclick=run(async()=>{await request('/api/legacy-canvases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:e.dataset.legacy})});e.disabled=true;e.textContent='Imported';message('Canvas imported into your profile.')}))}}catch(e){message(e.message)}
 }
}
