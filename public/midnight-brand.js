// Presentation-only rebrand. Existing storage keys, database and API contracts stay intact.
(()=>{
 const brand='The Midnight Palette',tagline='Your new 2am Obsession.';
 const emblem='/images/brand/midnight-palette-emblem.png';
 const logo=()=>`<img class="midnight-emblem" src="${emblem}" alt="" width="64" height="64"><span class="midnight-wordmark"><small>The</small>Midnight<br>Palette</span>`;
 const originalRender=render;
 render=function(){originalRender();document.title=brand+' — '+tagline;
  app.querySelectorAll('.brand').forEach(node=>{node.classList.add('midnight-brand');node.setAttribute('aria-label',brand);node.innerHTML=logo()});
  const workspace=app.querySelector('.studio-workspace');if(workspace)workspace.innerHTML=`<div class="midnight-sidebar-tagline">${tagline}</div>`;
  const heading=app.querySelector('.studio-heading');if(heading&&studioView==='discover'){const intro=heading.firstElementChild;intro.innerHTML=`<div class="midnight-title-lockup"><img src="${emblem}" width="100" height="100" alt=""><div><h1>${brand}</h1><p class="midnight-tagline">${tagline}</p></div></div>`}
  const sideNote=app.querySelector('.studio-sidebar-note');if(sideNote)sideNote.innerHTML='<span>AFTER HOURS, ALL YOURS.</span><p>A canvas. A little quiet.<br>Something worth staying up for.</p>';
  const footer=app.querySelector('.studiofooter');if(footer){const text=[...footer.children].find(node=>node.tagName==='SPAN'&&!node.classList.contains('brand'));if(text)text.textContent=tagline}
  const theme=document.querySelector('meta[name="theme-color"]');if(theme)theme.content=document.documentElement.dataset.theme==='dark'?'#111819':'#f3eee4';
 };
 // Text-only replacements in app-owned dialog copy; never alter user pins, notes or titles.
 const originalSettings=settings;settings=function(){originalSettings();const button=document.getElementById('import');if(button)button.textContent='Import a workspace backup'};
 render();
})();
