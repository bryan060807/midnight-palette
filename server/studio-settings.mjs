import {readFile} from 'node:fs/promises';

// Only non-secret deployment settings belong here. Credentials stay in the
// existing protected server environment and database configuration.
export async function loadStudioSettings(path){
 let text;
 try{text=await readFile(path,'utf8')}catch(e){if(e.code==='ENOENT')return {};throw e}
 let settings;
 try{settings=JSON.parse(text)}catch{throw Error('studio-settings.json must contain valid JSON.')}
 if(!settings||Array.isArray(settings)||typeof settings!=='object'
  ||Object.keys(settings).some(k=>k!=='storage')||!['local','postgres'].includes(settings.storage))
  throw Error('studio-settings.json must contain only storage: local or postgres.');
 return settings;
}
