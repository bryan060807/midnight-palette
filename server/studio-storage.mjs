import {createRequire} from 'node:module';
import {createPublicKey,verify,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const issuer='https://id.aibrylabs.com',clientId='midnight-palette-public-web';
const digest=value=>createHash('sha256').update(value).digest('hex');
const cookie=(req,name)=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});

export async function openStudioStorage(config,root){
 if(!config.studioStorage)return null;
 // The Windows studio shares the installed PostgreSQL driver and protected
 // database configuration with Canvas Ritual. Credentials stay server-side.
 const canvas=join(root,'..','canvas-ritual');
 const databaseEnvFile=process.env.MIDNIGHT_DATABASE_ENV_FILE||join(canvas,'.env');
 let connectionString=process.env.MIDNIGHT_DATABASE_URL;
 if(!connectionString){const env=await readFile(databaseEnvFile,'utf8');const line=env.split(/\r?\n/).find(x=>/^\s*DATABASE_URL\s*=/.test(x));connectionString=line?.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2')}
 if(!connectionString)throw Error('Midnight Palette PostgreSQL configuration is missing.');
 let pg;
 try{pg=createRequire(import.meta.url)('pg')}catch(e){
  if(e.code!=='MODULE_NOT_FOUND')throw e;
  // Existing Windows deployment can reuse Canvas Ritual until npm install.
  pg=createRequire(process.env.MIDNIGHT_PG_PACKAGE_FILE||join(canvas,'package.json'))('pg');
 }
 const {Pool}=pg;
 const pool=new Pool({connectionString,max:4,connectionTimeoutMillis:6000,idleTimeoutMillis:30000});
 pool.on('error',()=>console.error('Midnight Palette database connection interrupted.'));
 try{await pool.query(`
 CREATE SCHEMA IF NOT EXISTS midnight_palette;
 CREATE TABLE IF NOT EXISTS midnight_palette.profiles(owner_sub TEXT PRIMARY KEY,display_name TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '',medium TEXT NOT NULL DEFAULT 'acrylic',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS midnight_palette.workspaces(owner_sub TEXT PRIMARY KEY REFERENCES midnight_palette.profiles(owner_sub),body JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS midnight_palette.sessions(token_hash TEXT PRIMARY KEY,owner_sub TEXT NOT NULL REFERENCES midnight_palette.profiles(owner_sub),expires_at TIMESTAMPTZ NOT NULL);
 CREATE TABLE IF NOT EXISTS midnight_palette.login_attempts(state_hash TEXT PRIMARY KEY,verifier TEXT NOT NULL,nonce TEXT NOT NULL,invited BOOLEAN NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
 CREATE TABLE IF NOT EXISTS midnight_palette.projects(id UUID PRIMARY KEY,owner_sub TEXT REFERENCES midnight_palette.profiles(owner_sub),body JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS midnight_projects_owner ON midnight_palette.projects(owner_sub,updated_at);
 CREATE TABLE IF NOT EXISTS midnight_palette.images(project_id UUID NOT NULL REFERENCES midnight_palette.projects(id),name TEXT NOT NULL,bytes BYTEA NOT NULL,PRIMARY KEY(project_id,name));
 CREATE TABLE IF NOT EXISTS midnight_palette.requests(owner_sub TEXT NOT NULL,key TEXT NOT NULL,project_id UUID NOT NULL REFERENCES midnight_palette.projects(id),PRIMARY KEY(owner_sub,key));
 DELETE FROM midnight_palette.sessions WHERE expires_at<now();
 DELETE FROM midnight_palette.login_attempts WHERE expires_at<now();`)}catch(e){await pool.end();throw e}
 const row=async(sql,args=[])=>(await pool.query(sql,args)).rows[0];
 const redirect=(res,url)=>{res.writeHead(302,{Location:url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end()};
 const setCookie=(res,name,value,seconds)=>res.setHeader('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`);
 const apiJSON=async(url,options={})=>{const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw fail('AIBRY ID could not complete sign-in. Please try again.',502);return r.json()};
 async function validateIdentityToken(token,nonce){
  if(typeof token!=='string'||token.length>16384)throw fail('Invalid AIBRY ID identity token.',401);const parts=token.split('.');if(parts.length!==3)throw fail('Invalid AIBRY ID identity token.',401);
  const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  if(header.alg!=='RS256'||claims.iss!==issuer||!(Array.isArray(claims.aud)?claims.aud.includes(clientId):claims.aud===clientId)||typeof claims.exp!=='number'||claims.exp<=Date.now()/1000||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub)throw fail('AIBRY ID identity verification failed.',401);
  const jwks=await apiJSON(issuer+'/oauth/jwks');const key=jwks.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw fail('AIBRY ID signature verification failed.',401);
  return claims;
 }
 return {
  pool,
  async session(req){const value=cookie(req,'midnight_session');if(!/^[A-Za-z0-9_-]{43}$/.test(value))return null;const s=await row('SELECT owner_sub FROM midnight_palette.sessions WHERE token_hash=$1 AND expires_at>now()',[digest(value)]);return s?.owner_sub||null},
  async auth(req,res,path,url,invited){
   if(path==='/auth/aibry-id/login'&&req.method==='GET'){
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
    await pool.query('DELETE FROM midnight_palette.login_attempts WHERE expires_at<now()');
    await pool.query('INSERT INTO midnight_palette.login_attempts VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')',[digest(state),verifier,nonce,Boolean(invited)]);
    setCookie(res,'midnight_state',state,600);const target=new URL(issuer+'/oauth/authorize');
    target.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:config.origin+'/auth/aibry-id/callback',scope:'openid profile email',state,nonce,code_challenge:digestChallenge(verifier),code_challenge_method:'S256'}).toString();redirect(res,target.href);return true;
   }
   if(path==='/auth/aibry-id/callback'&&req.method==='GET'){
    const state=url.searchParams.get('state');if(!state||state!==cookie(req,'midnight_state'))throw fail('Sign-in expired. Start again from Midnight Palette.',401);
    const attempt=await row('DELETE FROM midnight_palette.login_attempts WHERE state_hash=$1 AND expires_at>now() RETURNING *',[digest(state)]);
    if(!attempt||url.searchParams.has('error')||!url.searchParams.get('code'))throw fail('AIBRY ID sign-in was not completed.',401);
    const tokens=await apiJSON(issuer+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,redirect_uri:config.origin+'/auth/aibry-id/callback',code:url.searchParams.get('code'),code_verifier:attempt.verifier})});
    const identity=await validateIdentityToken(tokens.id_token,attempt.nonce);
    const info=await apiJSON(issuer+'/oauth/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token}});
    if(info.sub!==identity.sub)throw fail('AIBRY ID identity did not match.',401);
    const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(763030)');
     const existing=(await db.query('SELECT owner_sub FROM midnight_palette.profiles WHERE owner_sub=$1',[info.sub])).rows[0];
     if(!existing){if(!attempt.invited)throw fail('To connect a new profile, enter the studio invitation password on the sign-in page first.',403);if(Number((await db.query('SELECT count(*) FROM midnight_palette.profiles')).rows[0].count)>=2)throw fail('This private studio already has its two profiles.',403);
      await db.query('INSERT INTO midnight_palette.profiles(owner_sub,display_name) VALUES($1,$2)',[info.sub,String(info.name||info.preferred_username||'Artist').slice(0,80)])}
     const session=randomBytes(32).toString('base64url');await db.query('INSERT INTO midnight_palette.sessions VALUES($1,$2,now()+interval \'30 days\')',[digest(session),info.sub]);await db.query('COMMIT');
     res.setHeader('Set-Cookie',[`midnight_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,'midnight_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0']);redirect(res,'/');
    }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}return true;
   }
   return false;
  },
  async logout(req,res){await pool.query('DELETE FROM midnight_palette.sessions WHERE token_hash=$1',[digest(cookie(req,'midnight_session'))]);res.setHeader('Set-Cookie',['midnight_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0','pinwell_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'])},
  async profile(owner){return row('SELECT display_name AS "displayName",bio,medium,created_at AS "createdAt" FROM midnight_palette.profiles WHERE owner_sub=$1',[owner])},
  async saveProfile(owner,b){if(typeof b.displayName!=='string'||!b.displayName.trim()||b.displayName.length>80||typeof b.bio!=='string'||b.bio.length>500||!['acrylic','watercolor','graphite','charcoal','colored pencil','ink','oil','mixed media'].includes(b.medium))throw fail('Use a name up to 80 characters, a bio up to 500, and a listed medium.');await pool.query('UPDATE midnight_palette.profiles SET display_name=$2,bio=$3,medium=$4,updated_at=now() WHERE owner_sub=$1',[owner,b.displayName.trim(),b.bio.trim(),b.medium]);return this.profile(owner)},
  async workspace(owner){return await row('SELECT body,version,updated_at AS "updatedAt" FROM midnight_palette.workspaces WHERE owner_sub=$1',[owner])||{body:null,version:0,updatedAt:null}},
  async saveWorkspace(owner,b){if(!Number.isInteger(b.version)||b.version<0||!b.body||!Array.isArray(b.body.boards)||!Array.isArray(b.body.pins)||b.body.boards.length>1000||b.body.pins.length>10000)throw fail('Invalid studio workspace.');
   const result=b.version===0?await row('INSERT INTO midnight_palette.workspaces(owner_sub,body) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING version,updated_at AS "updatedAt"',[owner,JSON.stringify(b.body)]):await row('UPDATE midnight_palette.workspaces SET body=$2,version=version+1,updated_at=now() WHERE owner_sub=$1 AND version=$3 RETURNING version,updated_at AS "updatedAt"',[owner,JSON.stringify(b.body),b.version]);
   if(!result)throw fail('Your studio changed on another device. Review the saved version before replacing it.',409);return result;
  },
  async get(id){return (await row('SELECT body FROM midnight_palette.projects WHERE id=$1',[id]))?.body||null},
  async put(p){p.updatedAt=new Date().toISOString();await pool.query('INSERT INTO midnight_palette.projects(id,owner_sub,body) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=now() WHERE midnight_palette.projects.owner_sub IS NOT DISTINCT FROM excluded.owner_sub',[p.id,p.ownerSub||null,JSON.stringify(p)]);return p},
  async list(owner){return (await pool.query(owner===undefined?'SELECT body FROM midnight_palette.projects ORDER BY updated_at DESC':'SELECT body FROM midnight_palette.projects WHERE owner_sub=$1 ORDER BY updated_at DESC',owner===undefined?[]:[owner])).rows.map(x=>x.body)},
  async findRequest(owner,key){return (await row('SELECT project_id FROM midnight_palette.requests WHERE owner_sub=$1 AND key=$2',[owner,key]))?.project_id},
  async setRequest(owner,key,id){await pool.query('INSERT INTO midnight_palette.requests VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[owner,key,id])},
  async image(id,name,bytes){if(bytes){await pool.query('INSERT INTO midnight_palette.images VALUES($1,$2,$3) ON CONFLICT(project_id,name) DO UPDATE SET bytes=excluded.bytes',[id,name,bytes]);return}return (await row('SELECT bytes FROM midnight_palette.images WHERE project_id=$1 AND name=$2',[id,name]))?.bytes},
  async legacy(){return (await pool.query('SELECT id,body->>\'title\' AS title FROM midnight_palette.projects WHERE owner_sub IS NULL ORDER BY updated_at DESC')).rows},
  async claim(owner,id){const r=await row('UPDATE midnight_palette.projects SET owner_sub=$1,body=jsonb_set(body,\'{ownerSub}\',to_jsonb($1::text)) WHERE id=$2 AND owner_sub IS NULL RETURNING body',[owner,id]);if(!r)throw fail('This canvas was already imported or could not be found.',409);return r.body},
  async close(){await pool.end()}
 };
}
function digestChallenge(value){return createHash('sha256').update(value).digest('base64url')}

