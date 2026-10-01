import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Store} from './store.mjs';
import {validateYouTubeResource} from './schema.mjs';

const file=process.argv[2],review=process.argv.includes('--review');
if(!file){console.error('Usage: node server/dibby-resource-import.mjs resources.json [--review]');process.exit(2)}
const value=JSON.parse(await readFile(resolve(file),'utf8'));
if(!Array.isArray(value)||value.length>100)throw Error('Import must be a JSON array with at most 100 records.');
const allowedTypes=new Set(['article','video','book','manufacturer']),allowedReviews=new Set(['candidate','verified']),allowedAvailability=new Set(['available','unavailable','unknown']),allowedMethods=new Set(['visual','transcript','creator_chapters','manufacturer_page','creator_page','metadata']);
const records=value.map((r,index)=>{
 const text=(key,max)=>typeof r[key]==='string'&&r[key].trim().length>0&&r[key].length<=max;
 const techniqueIds=Array.isArray(r.techniqueIds)?r.techniqueIds.filter(x=>typeof x==='string'):r.techniqueId?[r.techniqueId]:[];
 if(!r||!text('id',120)||!techniqueIds.length||techniqueIds.length>8||!text('title',300)||!text('creator',200)||!text('sourceUrl',2000)||!allowedTypes.has(r.resourceType)||!allowedAvailability.has(r.availability||'unknown'))throw Error(`Invalid resource at index ${index}.`);
 let source;try{source=new URL(r.sourceUrl)}catch{throw Error(`Invalid source URL at index ${index}.`)}if(source.protocol!=='https:')throw Error(`Resource URLs must use HTTPS at index ${index}.`);
 const youtubeId=r.youtubeId||null;if(r.resourceType==='video'&&!youtubeId)throw Error(`Video resource ${index} needs a validated YouTube ID.`);if(r.resourceType==='video')validateYouTubeResource(r);if(youtubeId&&!/^[A-Za-z0-9_-]{11}$/.test(youtubeId))throw Error(`Invalid YouTube ID at index ${index}.`);if(r.resourceType!=='video'&&youtubeId)throw Error(`Only video resources may include a YouTube ID at index ${index}.`);
 const requested=r.reviewStatus||'candidate';if(!allowedReviews.has(requested)||requested==='verified'&&(!review||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.lastVerified||'')))throw Error(`Record ${index} is not eligible for verified review. Use --review with a review date.`);
 const embeddingStatus=r.embeddingStatus||(r.resourceType==='video'?'unknown':'not_applicable');if(!['embeddable','not_embeddable','not_applicable','unknown'].includes(embeddingStatus))throw Error(`Invalid embedding status at index ${index}.`);if(r.resourceType==='video'&&requested==='verified'&&embeddingStatus!=='embeddable')throw Error(`Verified video ${index} must be confirmed embeddable.`);
 const reviewMethod=r.reviewMethod||'metadata';if(!allowedMethods.has(reviewMethod)||requested==='verified'&&reviewMethod==='metadata')throw Error(`Record ${index} needs explicit review evidence.`);if(!text('teaches',1200)||!text('reviewEvidence',1600))throw Error(`Record ${index} needs teaching and review evidence.`);
 const focus=text('focus',80)?r.focus:'general';const duration=r.durationSeconds==null?null:r.durationSeconds;if(duration!=null&&(!Number.isInteger(duration)||duration<=0))throw Error(`Invalid duration at index ${index}.`);if(r.endSeconds!=null&&duration!=null&&r.endSeconds>duration)throw Error(`Resource segment exceeds duration at index ${index}.`);
 return {...r,techniqueId:techniqueIds[0],techniqueIds,reviewStatus:requested,lastVerified:r.lastVerified||null,availability:r.availability||'unknown',embeddingStatus,youtubeId,startSeconds:r.startSeconds??null,endSeconds:r.endSeconds??null,focus,reviewMethod,durationSeconds:duration};
});
const seen=new Set();for(const r of records){if(seen.has(r.id))throw Error(`Duplicate resource id ${r.id}.`);seen.add(r.id)}
const store=new Store(process.env.DATA_DIR||'./data');for(const r of records)for(const id of r.techniqueIds)if(!store.getTechnique(id))throw Error(`Unknown technique ${id}.`);store.importResources(records);store.close();console.log(`Imported ${records.length} Dibby resource record(s) as ${review?'requested review status':'candidate records'}.`);
