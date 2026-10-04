import {createPublicKey,verify} from 'node:crypto';
import {AppError} from './schema.mjs';

export const AIBRY_ISSUER='https://id.aibrylabs.com';
export const MIDNIGHT_CLIENT_ID='midnight-palette-public-web';
const invalid=()=>new AppError('AIBRY ID identity verification failed. Start sign-in again.',401);

export async function verifyAibryIdentity(token,nonce,loadJwks,{now=Date.now()/1000}={}){
 if(typeof token!=='string'||token.length>16384||!nonce)throw invalid();
 const parts=token.split('.');
 if(parts.length!==3||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))throw invalid();
 let header,claims;
 try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'))}catch{throw invalid()}
 if(!header||!claims||header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid)throw invalid();
 const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(claims.iss!==AIBRY_ISSUER||!audience.includes(MIDNIGHT_CLIENT_ID)
  ||(audience.length>1&&claims.azp!==MIDNIGHT_CLIENT_ID)
  ||(claims.azp!==undefined&&claims.azp!==MIDNIGHT_CLIENT_ID)
  ||!Number.isFinite(claims.exp)||claims.exp<=now
  ||!Number.isFinite(claims.iat)||claims.iat>now+60||claims.iat>=claims.exp
  ||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now+60))
  ||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255)throw invalid();
 const jwks=await loadJwks();
 const key=jwks.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
 if(!key)throw invalid();
 try{if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw invalid()}catch{throw invalid()}
 return claims;
}
