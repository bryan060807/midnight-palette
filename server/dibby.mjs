import {AppError,normalizeMedium,validateDibbyAnalysis,inferDibbySignals} from './schema.mjs';

const normalizeText=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const overlap=(a,b)=>a.some(x=>b.some(y=>normalizeText(y).includes(normalizeText(x))||normalizeText(x).includes(normalizeText(y))));
const flattenContext=context=>[context.question,...(context.problemCategories||[]),...(context.symptoms||[]),context.stepTitle,context.stepInstruction].filter(Boolean).join(' ');
const resourceScore=(resource,context)=>{
 const focus=context.focus||'';
 if(!focus)return resource.focus==='general'?2:1;
 if(resource.focus===focus)return 8;
 if(resource.focus==='general')return 3;
 return 0;
};
const contextualTechnique=(technique,context)=>({...technique,resources:(technique.resources||[]).slice().sort((a,b)=>resourceScore(b,context)-resourceScore(a,context)||a.title.localeCompare(b.title))});

export function retrieveTechniques(all,context={}){
 const medium=normalizeMedium(context.medium),skill=String(context.skill||'unknown').toLowerCase(),signals=inferDibbySignals(context.question,context);
 context.problemCategories=signals.problemCategories;context.symptoms=signals.symptoms;context.focus=context.focus||signals.focus;context.clarificationNeeded=signals.clarificationNeeded;
 const conditions=new Set((context.materialConditions||[]).filter(Boolean));
 const query=flattenContext(context);
 const ranked=[];
 for(const technique of all){
  if(medium!=='unknown'&&technique.medium!==medium&&technique.medium!=='universal')continue;
  if(medium==='unknown'&&technique.medium!=='universal')continue;
  if(context.surface&&context.surface!=='unknown'&&!overlap([context.surface],technique.surfaces)&&!technique.surfaces.includes('unknown'))continue;
  if(context.tool&&context.tool!=='unknown'&&!overlap([context.tool],technique.tools)&&!technique.tools.includes('unknown'))continue;
  if(conditions.size&&![...conditions].some(c=>technique.materialConditions.includes(c)||technique.materialConditions.includes('unknown')))continue;
  let score=technique.reviewStatus==='verified'?4:1;
  if(technique.medium===medium)score+=100;else if(technique.medium==='universal')score+=20;
  if(skill!=='unknown'&&technique.skillLevel===skill)score+=8;
  if(overlap(context.problemCategories||[],technique.problemCategories))score+=35;
  if(overlap(context.symptoms||[],technique.symptomPhrases))score+=28;
  const q=normalizeText(query);
  if(q&&overlap(q.split(' ').filter(x=>x.length>3),[...technique.problemCategories,...technique.symptomPhrases]))score+=20;
  if(context.surface&&overlap([context.surface],technique.surfaces))score+=8;
  if(context.tool&&overlap([context.tool],technique.tools))score+=6;
  if(conditions.size&&[...conditions].some(c=>technique.materialConditions.includes(c)))score+=5;
  ranked.push({technique,score});
 }
 ranked.sort((a,b)=>b.score-a.score||a.technique.title.localeCompare(b.technique.title));
 return ranked.slice(0,3).map(x=>contextualTechnique(x.technique,context));
}

export function buildFallback(candidates,context,{liveAvailable=false}={}){
 const medium=normalizeMedium(context.medium),best=candidates[0]||null;
 const clarification=medium==='unknown'?'Which medium are you using—watercolor, acrylic, graphite, charcoal, colored pencil, ink, or oil?':context.clarificationNeeded&&context.problemCategories?.includes('drying')&&context.problemCategories?.includes('blending')&&!['palette','surface'].includes(context.focus)?'Is it drying on the palette, on the painting, or both?':context.clarificationNeeded?'Was the affected layer wet, dry, or still uncertain when the problem appeared?':best?'':'What medium and surface are you working on, and what changed when the problem appeared?';
 const dryingPalette=medium==='acrylic'&&context.focus==='palette',dryingSurface=medium==='acrylic'&&context.focus==='surface';
 const nextAction=dryingPalette?'Put out smaller portions on a stay-wet or non-absorbent palette, keep airflow off the mix, and only mix what you can place before it skins.':dryingSurface?'Work a smaller wet section, place both colors while they are workable, and stop when the film turns tacky; use only a compatible slow-dry product named by your paint maker.':best?.nextAction||'Pause and test the next move on scrap from the same surface.';
 const acknowledgment=dryingPalette?'That mix is losing the race on the palette, so let’s buy it a little more working time.':dryingSurface?'The paint is locking on the painting before the blend is finished; make the working area smaller and stop reopening a tacky film.':best?'Dibby found a small, low-drama experiment to try.':'Dibby needs one more clue before choosing a safe card.';
 return {liveAvailable,acknowledgment,observations:[],possibleCauses:[],canonicalMedium:medium,problemCategories:context.problemCategories||[],symptoms:context.symptoms||[],materialConditions:context.materialConditions?.length?context.materialConditions:['unknown'],needsClarification:Boolean(clarification),clarifyingQuestion:clarification,nextAction,practiceExercise:best?.practiceExercise||'Make three tiny test marks and compare them before touching the main piece.',suggestedTechniqueIds:best?[best.id]:[],techniques:candidates,bestTechniqueId:best?.id||null};
}

export function validateAndShapeAnalysis(raw,candidates,context){
 const validated=validateDibbyAnalysis(raw,candidates.map(x=>x.id));
 const byId=new Map(candidates.map(x=>[x.id,x]));
 const ids=candidates.slice(0,3).map(x=>x.id);
 const techniques=ids.map(id=>byId.get(id)).filter(Boolean).map(x=>contextualTechnique(x,context));
 const inferred=inferDibbySignals(context.question,context);
 const canonicalMedium=context.medium!=='unknown'?context.medium:validated.canonicalMedium;
 const needsClarification=canonicalMedium==='unknown'||Boolean(context.clarificationNeeded);
 const clarification=canonicalMedium==='unknown'?'Which medium are you using—watercolor, acrylic, graphite, charcoal, colored pencil, ink, or oil?':needsClarification&&inferred.problemCategories?.includes('drying')&&inferred.problemCategories?.includes('blending')&&!['palette','surface'].includes(context.focus)?'Is it drying on the palette, on the painting, or both?':needsClarification?(validated.clarifyingQuestion||'Was the affected layer wet, dry, or still uncertain when the problem appeared?'):'';
 const dryingPalette=canonicalMedium==='acrylic'&&context.focus==='palette',dryingSurface=canonicalMedium==='acrylic'&&context.focus==='surface';
 const nextAction=dryingPalette?'Put out smaller portions on a stay-wet or non-absorbent palette, keep airflow off the mix, and only mix what you can place before it skins.':dryingSurface?'Work a smaller wet section, place both colors while they are workable, and stop when the film turns tacky; use only a compatible slow-dry product named by your paint maker.':validated.nextAction;
 const acknowledgment=dryingPalette?'That mix is losing the race on the palette, so let’s buy it a little more working time.':dryingSurface?'The paint is locking on the painting before the blend is finished; make the working area smaller and stop reopening a tacky film.':validated.acknowledgment;
 return {...validated,acknowledgment,canonicalMedium,problemCategories:inferred.problemCategories,symptoms:inferred.symptoms,needsClarification,clarifyingQuestion:clarification,nextAction,suggestedTechniqueIds:ids,techniques,bestTechniqueId:techniques[0]?.id||null,liveAvailable:true};
}

export function browseTechniques(all,query,medium){
 const q=normalizeText(query);
 const pool=medium?retrieveTechniques(all,{question:q,medium:normalizeMedium(medium),materialConditions:[]}):all.slice().sort((a,b)=>(b.reviewStatus==='verified')-(a.reviewStatus==='verified')||a.title.localeCompare(b.title));
 return pool.filter(t=>!q||normalizeText([t.title,...t.problemCategories,...t.symptomPhrases].join(' ')).includes(q)||q.split(' ').some(x=>normalizeText([t.title,...t.problemCategories,...t.symptomPhrases].join(' ')).includes(x))).slice(0,30);
}

export function validateDibbyContext(body){
 const bounded=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
 const medium=normalizeMedium(body.medium||body.project?.medium||body.tutorial?.medium);
 const context={question:bounded(body.question,2000),medium,skill:['beginner','intermediate','advanced'].includes(String(body.skill||'').toLowerCase())?String(body.skill).toLowerCase():'unknown',surface:bounded(body.surface,100),tool:bounded(body.tool,100),problemCategories:Array.isArray(body.problemCategories)?body.problemCategories.filter(x=>typeof x==='string').slice(0,5).map(x=>x.slice(0,80)):[],symptoms:Array.isArray(body.symptoms)?body.symptoms.filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,120)):[],materialConditions:Array.isArray(body.materialConditions)?body.materialConditions.filter(x=>['wet','dry','unknown','paper_saturated','paper_dry','layer_cured','layer_uncertain'].includes(x)).slice(0,8):['unknown'],tutorial:{title:bounded(body.tutorial?.title,150),medium:bounded(body.tutorial?.medium,80),stepTitle:bounded(body.tutorial?.stepTitle,150),stepInstruction:bounded(body.tutorial?.stepInstruction,600)}};
 Object.assign(context,inferDibbySignals(context.question,context));
 if(!context.question)throw new AppError('Ask Dibby a question first.');
 const conversation=Array.isArray(body.conversation)?body.conversation.slice(-8).filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').map(x=>({role:x.role,content:x.content.slice(0,1000)})):[];
 return {context,conversation};
}
