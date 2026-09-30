// Shared materials display for existing lessons and generated canvases.
const PinwellMaterials=(()=>{
 const clean=value=>String(value||'').trim().replace(/\s+[—–]\s+.*$/,'').replace(/;.*$/,'').replace(/\s+\((?:for |to |use |optional:)[^)]*\)/ig,'').replace(/\.\s+[A-Z].*$/,'').replace(/[.!]$/,'').trim();
 const unique=items=>[...new Map(items.map(clean).filter(Boolean).map(x=>[x.toLowerCase(),x])).values()];
 const inventory={
  Acrylic:[['Primed canvas or canvas board (9 × 12 in)'],[],['½-inch flat brush','Small round brush','Liner brush'],['Palette','Water jar','Rag','Pencil']],
  Watercolor:[['Cold-press watercolor paper (140 lb / 300 gsm)'],[],['Size 6 round brush','Size 2 round brush'],['Two water jars','Palette','Pencil','Paper towel','Low-tack tape']],
  Graphite:[['Drawing paper (A5 or larger)'],['HB pencil','2B pencil','4B pencil'],['Kneaded eraser','Pencil sharpener'],['Scrap paper']],
  'Colored pencil':[['Lightly textured drawing paper'],[],['HB pencil','Eraser','Pencil sharpener'],['White pencil','Scrap paper']],
  Ink:[['Drawing paper or mixed-media paper'],['0.1 mm waterproof fineliner','0.5 mm waterproof fineliner'],['HB pencil','Eraser'],['Ruler']]
 };
 function builtin(p){const groups=(inventory[p.medium]||ART_GROUPS[p.medium].materials.map(x=>[x])).map(x=>[...x]);const colors=p.palette||[];if(['Acrylic','Watercolor','Colored pencil'].includes(p.medium))groups[1]=colors;else groups.push(colors);return {groups,items:unique(groups.flat())}}
 function generated(p){return unique([...(p.plan?.supplies||[]),...(p.plan?.palette||[]).map(x=>x.name)])}
 function html(items,checked,attribute){return `<div class="large-materials">${items.map(item=>`<label><input type="checkbox" data-${attribute}="${esc(item)}" ${checked.includes(item)?'checked':''}><span>${esc(item)}</span></label>`).join('')}</div>`}
 return {builtin,generated,html,clean};
})();
const lessonBeforeSimpleMaterials=showLesson;
showLesson=function(mode){if(mode!=='materials')return lessonBeforeSimpleMaterials(mode);const p=activeProject;ensureProgress(p);const pr=data.artProgress[p.id],inventory=PinwellMaterials.builtin(p);if(!Array.isArray(pr.materialChecks)){pr.materialChecks=[...new Set((pr.materials||[]).flatMap(i=>inventory.groups[i]||[]))];persist()}dialog.classList.add('lesson-dialog');modal(p.title,`<div class="lesson-tabs"><button data-simple-tab="overview">Overview</button><button class="active" data-simple-tab="materials">Materials</button><button data-simple-tab="steps">The tutorial</button></div><div class="materials-page">${PinwellMaterials.html(inventory.items,pr.materialChecks,'simple-material')}</div>`);dialog.querySelectorAll('[data-simple-tab]').forEach(b=>b.onclick=()=>showLesson(b.dataset.simpleTab));dialog.querySelectorAll('[data-simple-material]').forEach(box=>box.onchange=()=>{const previous=[...pr.materialChecks],checks=new Set(previous);box.checked?checks.add(box.dataset.simpleMaterial):checks.delete(box.dataset.simpleMaterial);pr.materialChecks=[...checks];if(!persist()){pr.materialChecks=previous;box.checked=!box.checked}})};
const renderBeforeTheme=render;
render=function(){renderBeforeTheme();const host=app.querySelector('.topright')||app.querySelector('.topbar');if(!host)return;const button=document.createElement('button');button.id='themeToggle';button.className='btn theme-toggle';const update=()=>{const dark=document.documentElement.dataset.theme==='dark';button.textContent=dark?'Light mode':'Dark mode';button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');button.setAttribute('aria-pressed',String(dark))};update();button.onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('pinwell-theme',document.documentElement.dataset.theme)}catch{toast('Theme changed. Browser storage is unavailable, so it may not persist.')}update()};host.prepend(button)};
