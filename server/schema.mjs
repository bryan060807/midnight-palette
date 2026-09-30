export class AppError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const str={type:'string'};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const planSchema=object({title:str,description:str,composition:str,supplies:{type:'array',items:str},palette:{type:'array',items:object({name:str,hex:str,mix:str})},steps:{type:'array',items:object({title:str,instruction:str,visual:str,check:str})}});
export function validatePlan(p){
 const text=(x,max=3000)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
 if(!p||!text(p.title,150)||!text(p.description)||!text(p.composition)||!Array.isArray(p.supplies)||p.supplies.length<1||p.supplies.length>20||!p.supplies.every(x=>text(x,300))||!Array.isArray(p.palette)||p.palette.length<1||p.palette.length>10||!p.palette.every(x=>x&&text(x.name,80)&&/^#[0-9a-f]{6}$/i.test(x.hex)&&text(x.mix,500))||!Array.isArray(p.steps)||p.steps.length!==6||!p.steps.every(x=>x&&text(x.title,150)&&text(x.instruction)&&text(x.visual)&&text(x.check)))throw new AppError('The lesson plan is incomplete or invalid. Six steps and a palette are required.');
 return p;
}
export function options(body){const medium=['Acrylic','Watercolor','Pencil'].includes(body.medium)?body.medium:'Acrylic';const difficulty=['Beginner','Intermediate'].includes(body.difficulty)?body.difficulty:'Beginner';const shape=['Square','Portrait','Landscape'].includes(body.shape)?body.shape:'Square';return {medium,difficulty,shape,notes:String(body.notes||'').slice(0,1500)};}
export function imageType(b){if(b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(b.length>3&&b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';if(b.length>12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return 'image/webp';throw new AppError('Use a PNG, JPEG, or WebP image.');}
export function safePinterestURL(value){let u;try{u=new URL(value)}catch{throw new AppError('Upload an image or choose a loaded Pinterest thumbnail.')}if(u.protocol!=='https:'||u.hostname!=='i.pinimg.com'||u.port||u.username||u.password)throw new AppError('Only Pinterest thumbnail URLs can be fetched. Upload other images instead.');return u.href;}
