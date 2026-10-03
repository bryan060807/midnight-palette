// Fixed, idempotent AIBRY ID registration for the private Midnight Palette.
// No command arguments, arbitrary SQL, or credential output are supported.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire('/home/aibry/projects/AIBRY-Auth/package.json');
const {Pool}=require('pg');
const readVariables=text=>Object.fromEntries(text.split(/\r?\n/).filter(x=>/^\s*[A-Z_]+\s*=/.test(x)).map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^(['"])(.*)\1$/,'$2')]}));
const files=execFileSync('systemctl',['--user','show','aibry-auth.service','--property=EnvironmentFiles','--value'],{encoding:'utf8'});
const env={};for(const m of files.matchAll(/(\/home\/aibry\/[^\s;]+)\s+\(ignore_errors=/g)){Object.assign(env,readVariables(readFileSync(m[1],'utf8')))}
const inline=execFileSync('systemctl',['--user','show','aibry-auth.service','--property=Environment','--value'],{encoding:'utf8'});
const match=inline.match(/(?:^|\s|\")AIBRY_AUTH_DATABASE_URL_FILE=([^\s"]+)/);
const file=env.AIBRY_AUTH_DATABASE_URL_FILE||match?.[1];
if(!file?.startsWith('/home/aibry/'))throw Error('AIBRY Auth protected database-file configuration could not be found.');
const connectionString=readFileSync(file,'utf8').trim(),target=new URL(connectionString);
if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||!target.pathname.endsWith('_private'))throw Error('Refusing an unexpected identity database target.');
const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:6000});
const db=await pool.connect();
try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(763031)');
 const existing=(await db.query('SELECT * FROM oidc_clients WHERE client_id=$1',['midnight-palette-public-web'])).rows[0];
 if(existing){const redirects=(await db.query('SELECT redirect_uri FROM oidc_client_redirect_uris WHERE client_id=$1',['midnight-palette-public-web'])).rows.map(x=>x.redirect_uri);
  if(existing.client_type!=='public'||existing.token_endpoint_auth_method!=='none'||!existing.pkce_required||existing.test_only_auto_approve||existing.disabled_at||redirects.some(x=>x!=='https://midnight-palette.aibrylabs.com/auth/aibry-id/callback'))throw Error('Existing Midnight client differs from the reviewed registration.');
 }else await db.query(`INSERT INTO oidc_clients(client_id,display_name,client_type,token_endpoint_auth_method,pkce_required,test_only_auto_approve,metadata_json) VALUES('midnight-palette-public-web','The Midnight Palette','public','none',true,false,'{"public_midnight_palette_client":true}'::jsonb)`);
 await db.query("INSERT INTO oidc_client_redirect_uris(client_id,redirect_uri) VALUES('midnight-palette-public-web','https://midnight-palette.aibrylabs.com/auth/aibry-id/callback') ON CONFLICT DO NOTHING");
 for(const scope of ['openid','profile','email'])await db.query("INSERT INTO oidc_client_scopes(client_id,scope) VALUES('midnight-palette-public-web',$1) ON CONFLICT DO NOTHING",[scope]);
 await db.query('COMMIT');console.log('Midnight Palette AIBRY ID client registered: exact HTTPS callback, public PKCE S256, explicit consent.');
}catch(e){await db.query('ROLLBACK');console.error('Midnight client registration failed:',e.message.startsWith('Existing')?e.message:e.name);process.exitCode=1}finally{db.release();await pool.end()}
