import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import vm from 'node:vm';
const versions=['2025-03-26','2025-06-18','2025-11-25'];
const textSchema={type:'string',maxLength:200};
const tools=[
 {name:'find_canvases',description:'Find bundled painting and drawing lessons by subject, medium, difficulty and available minutes. Does not read personal boards.',inputSchema:{type:'object',properties:{query:textSchema,medium:textSchema,level:{type:'string',enum:['Beginner','Intermediate']},minutes:{type:'integer',minimum:5,maximum:480},limit:{type:'integer',minimum:1,maximum:10}},additionalProperties:false}},
 {name:'get_canvas',description:'Get full materials, palette, six lesson steps, care advice and an app link for a bundled canvas.',inputSchema:{type:'object',properties:{id:textSchema},required:['id'],additionalProperties:false}},
 {name:'get_medium_guide',description:'Read Midnight Palette setup, materials and care guidance for acrylic, watercolor, graphite, colored pencil or ink.',inputSchema:{type:'object',properties:{medium:textSchema},required:['medium'],additionalProperties:false}}
].map(t=>({...t,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}));
// Evaluate only the trusted, checked-in catalog, without browser or filesystem globals.
export async function createDibbyMCP(config){
 const source=await readFile(join(config.publicDir,'tutorials.js'),'utf8');
 const catalog=JSON.parse(vm.runInNewContext(source+'\nJSON.stringify({art:ART,groups:ART_GROUPS})',Object.create(null),{timeout:1000}));
 const summary=p=>({id:p.id,title:p.title,medium:p.medium,level:p.level,minutes:p.minutes,subject:p.subject,description:p.description,skill:p.skill,palette:p.palette,url:config.origin+'/#tutorial='+encodeURIComponent(p.id),illustration:config.origin+'/images/steps/'+p.id+'.png'});
 function validate(args,schema){if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Arguments must be an object.');for(const key of Object.keys(args)){const rule=schema.properties[key];if(!rule)throw Error('Unknown argument: '+key);const v=args[key];if(rule.type==='string'&&(typeof v!=='string'||v.length>(rule.maxLength||200)))throw Error('Invalid '+key);if(rule.type==='integer'&&(!Number.isInteger(v)||v<rule.minimum||v>rule.maximum))throw Error('Invalid '+key);if(rule.enum&&!rule.enum.includes(v))throw Error('Invalid '+key)}for(const k of schema.required||[])if(!(k in args))throw Error('Missing '+k)}
 function call(name,args){const tool=tools.find(t=>t.name===name);if(!tool)throw Error('Unknown tool.');validate(args,tool.inputSchema);const lower=s=>s.toLowerCase().trim();
  if(name==='find_canvases'){const matches=catalog.art.filter(p=>(!args.query||lower([p.title,p.subject,p.description,p.skill].join(' ')).includes(lower(args.query)))&&(!args.medium||lower(p.medium)===lower(args.medium))&&(!args.level||p.level===args.level)&&(!args.minutes||p.minutes<=args.minutes)).sort((a,b)=>a.minutes-b.minutes);return {canvases:matches.slice(0,args.limit||3).map(summary),total:matches.length,note:'Times exclude drying. Library illustrations are targets, not step photographs. Personal boards and progress remain in the app browser.'}}
  if(name==='get_canvas'){const p=catalog.art.find(p=>p.id===args.id);if(!p)throw Error('Canvas not found.');return {...summary(p),steps:p.steps,...catalog.groups[p.medium],illustrationNote:'The linked image is an illustrated step sheet, not a video demonstration.'}}
  const medium=Object.keys(catalog.groups).find(m=>lower(m)===lower(args.medium));if(!medium)throw Error('Choose Acrylic, Watercolor, Graphite, Colored pencil, or Ink.');return {medium,...catalog.groups[medium]};
 }
 return async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(value===undefined?'':JSON.stringify(value))};
  // This route exposes only original bundled lessons; no Store, cookies or provider access.
  if(req.headers.origin&&req.headers.origin!==config.origin)return send(403,{error:'Unrecognized origin.'});
  if(req.method==='GET'||req.method==='DELETE'){res.setHeader('Allow','POST');return send(405,{error:'This stateless MCP endpoint uses POST.'})}
  if(req.method!=='POST')return send(405,{error:'Method not allowed.'});
  if(!String(req.headers['content-type']||'').startsWith('application/json'))return send(415,{error:'Use application/json.'});
  if(!String(req.headers.accept||'').includes('application/json')||!String(req.headers.accept||'').includes('text/event-stream'))return send(406,{error:'Accept application/json and text/event-stream.'});
  if(req.headers['mcp-protocol-version']&&!versions.includes(req.headers['mcp-protocol-version']))return send(400,{error:'Unsupported MCP protocol version.'});
  let message;try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)return send(413,{error:'Request too large.'});chunks.push(chunk)}message=JSON.parse(Buffer.concat(chunks).toString())}catch{return send(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON.'}})}
  if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'||('id' in message&&typeof message.id!=='number'&&typeof message.id!=='string'))return send(400,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request.'}});
  if(!('id' in message))return send(202);
  const reply=result=>send(200,{jsonrpc:'2.0',id:message.id,result});
  if(message.method==='initialize')return reply({protocolVersion:versions.includes(message.params?.protocolVersion)?message.params.protocolVersion:versions.at(-1),capabilities:{tools:{listChanged:false}},serverInfo:{name:'midnight-palette-dibby',version:'0.1.0'},instructions:'Read-only bundled art lessons. No personal boards, progress, paid generation or video clips are exposed.'});
  if(message.method==='ping')return reply({});
  if(message.method==='tools/list')return reply({tools});
  if(message.method==='tools/call'){try{const result=call(message.params?.name,message.params?.arguments||{});return reply({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result})}catch(e){return reply({isError:true,content:[{type:'text',text:e.message}]})}}
  return send(200,{jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found.'}});
 };
}
