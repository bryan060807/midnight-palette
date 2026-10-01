export class AppError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const str={type:'string'};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const DIBBY_MEDIA=['acrylic','watercolor','graphite','charcoal','colored pencil','ink','oil','unknown'];
export const DIBBY_SKILLS=['beginner','intermediate','advanced','unknown'];
export const MATERIAL_CONDITIONS=['wet','dry','unknown','paper_saturated','paper_dry','layer_cured','layer_uncertain'];
export const normalizeMedium=value=>{
 const v=String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
 if(v==='pencil'||v==='pencils'||v==='graphite pencil')return 'graphite';
 if(v==='watercolour')return 'watercolor';
 if(v==='colored pencils'||v==='colour pencil'||v==='colour pencils')return 'colored pencil';
 return DIBBY_MEDIA.includes(v)?v:'unknown';
};
const signalRules=[
 {category:'drying',patterns:[/\b(?:dry|dries|drying)\b/,/tacky/,/skins?/,/open time/,/workable/]},
 {category:'palette drying',patterns:[/palette/,/stay wet/,/wet palette/,/paint mix/]},
 {category:'surface drying',patterns:[/painting/,/canvas/,/surface/,/on the (?:painting|canvas)/]},
 {category:'blending',patterns:[/blend/,/soft edge/,/smooth transition/,/feather/]},
 {category:'water control',patterns:[/water control/,/too much water/,/wash/,/pool/]},
 {category:'blooms',patterns:[/bloom/,/backrun/,/cauliflower/,/tide mark/]},
 {category:'glazing',patterns:[/glaz/,/transparent layer/,/layering/]},
 {category:'lifting',patterns:[/lift/,/recover(?:ing)? light/,/highlight/]},
 {category:'pressure',patterns:[/pressure/,/too dark/,/dent/,/streak/]},
 {category:'smudging',patterns:[/smudge/,/dirty/,/transfer/,/blend(?:ing)? stump/]},
 {category:'line control',patterns:[/line/,/wobbl/,/hesitant/,/feather/]},
 {category:'feathering',patterns:[/feather/,/spread/,/bleed/]}
];
export function inferDibbySignals(question,existing={}){
 const q=String(question||'').toLowerCase();
 const categories=[...(existing.problemCategories||[])];
 for(const rule of signalRules)if(rule.patterns.some(pattern=>pattern.test(q))&&!categories.includes(rule.category))categories.push(rule.category);
 const symptoms=[...(existing.symptoms||[])];
 if(/palette|stay wet|paint mix/.test(q)&&!symptoms.includes('paint dries on palette'))symptoms.push('paint dries on palette');
 if(/canvas|painting|surface/.test(q)&&/dry|tack|blend|workable/.test(q)&&!symptoms.includes('paint dries on painting'))symptoms.push('paint dries on painting');
 if(/before i can blend|can't blend|cannot blend|blend/.test(q)&&!symptoms.includes('blend turns tacky'))symptoms.push('blend turns tacky');
 if(/bloom|backrun|cauliflower/.test(q)&&!symptoms.includes('cauliflower edges'))symptoms.push('cauliflower edges');
 const focus=/palette|stay wet|paint mix/.test(q)?'palette':/canvas|painting|surface/.test(q)?'surface':/blend|soft edge|transition/.test(q)?'blending':'';
 const clearDrying=/\b(?:dry|dries|drying)\b|tack|skins?|open time|workable/.test(q);
 const clarificationNeeded=(clearDrying&&categories.includes('drying')&&categories.includes('blending')&&!['palette','surface'].includes(focus))||(!clearDrying&&(['lifting','glazing','water control','blooms'].some(x=>categories.includes(x))||!categories.length));
 return {problemCategories:categories.slice(0,5),symptoms:symptoms.slice(0,8),focus,clarificationNeeded};
}
export function validateDibbyAnalysis(value,candidateIds=[]){
 const text=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
 const list=(x,maxItems,maxText=240)=>Array.isArray(x)&&x.length<=maxItems&&x.every(v=>text(v,maxText));
 const ids=new Set(candidateIds);
 if(!value||!text(value.acknowledgment,500)||!list(value.observations,5)||!list(value.possibleCauses,5)||!DIBBY_MEDIA.includes(value.canonicalMedium)||!list(value.problemCategories,5,80)||!list(value.symptoms,8,120)||!Array.isArray(value.materialConditions)||value.materialConditions.length>8||!value.materialConditions.every(x=>MATERIAL_CONDITIONS.includes(x))||typeof value.needsClarification!=='boolean'||(value.needsClarification&&!text(value.clarifyingQuestion,300))||(value.clarifyingQuestion!==''&&!text(value.clarifyingQuestion,300))||!text(value.nextAction,700)||!text(value.practiceExercise,700)||!list(value.suggestedTechniqueIds,3,100))throw new AppError('The technique analysis was incomplete or invalid.',502);
 if(value.suggestedTechniqueIds.some(id=>!ids.has(id)))throw new AppError('The technique analysis returned an unknown technique.',502);
 return {...value,clarifyingQuestion:value.clarifyingQuestion||''};
}
export function validateYouTubeResource(resource){
 const id=String(resource?.youtubeId||'');
 if(!/^[A-Za-z0-9_-]{11}$/.test(id))throw new AppError('The resource video ID is invalid.');
 const start=resource.startSeconds==null?null:resource.startSeconds,end=resource.endSeconds==null?null:resource.endSeconds;
 if(start!=null&&(!Number.isInteger(start)||start<0)||end!=null&&(!Number.isInteger(end)||end<0)||start!=null&&end!=null&&end<=start)throw new AppError('The resource timestamps are invalid.');
 return {youtubeId:id,startSeconds:start,endSeconds:end};
}
export const planSchema=object({title:str,description:str,composition:str,supplies:{type:'array',items:str},palette:{type:'array',items:object({name:str,hex:str,mix:str})},steps:{type:'array',items:object({title:str,instruction:str,visual:str,check:str})}});
export function validatePlan(p){
 const text=(x,max=3000)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
 if(!p||!text(p.title,150)||!text(p.description)||!text(p.composition)||!Array.isArray(p.supplies)||p.supplies.length<1||p.supplies.length>20||!p.supplies.every(x=>text(x,300))||!Array.isArray(p.palette)||p.palette.length<1||p.palette.length>10||!p.palette.every(x=>x&&text(x.name,80)&&/^#[0-9a-f]{6}$/i.test(x.hex)&&text(x.mix,500))||!Array.isArray(p.steps)||p.steps.length!==6||!p.steps.every(x=>x&&text(x.title,150)&&text(x.instruction)&&text(x.visual)&&text(x.check)))throw new AppError('The lesson plan is incomplete or invalid. Six steps and a palette are required.');
 return p;
}
export function options(body){const medium=['Acrylic','Watercolor','Pencil'].includes(body.medium)?body.medium:'Acrylic';const difficulty=['Beginner','Intermediate'].includes(body.difficulty)?body.difficulty:'Beginner';const shape=['Square','Portrait','Landscape'].includes(body.shape)?body.shape:'Square';return {medium,difficulty,shape,notes:String(body.notes||'').slice(0,1500)};}
export function imageType(b){if(b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(b.length>3&&b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';if(b.length>12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return 'image/webp';throw new AppError('Use a PNG, JPEG, or WebP image.');}
export function safePinterestURL(value){let u;try{u=new URL(value)}catch{throw new AppError('Upload an image or choose a loaded Pinterest thumbnail.')}if(u.protocol!=='https:'||u.hostname!=='i.pinimg.com'||u.port||u.username||u.password)throw new AppError('Only Pinterest thumbnail URLs can be fetched. Upload other images instead.');return u.href;}
