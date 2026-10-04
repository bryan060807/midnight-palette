import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyAibryIdentity,AIBRY_ISSUER,MIDNIGHT_CLIENT_ID} from '../server/aibry-id.mjs';
import {loadStudioSettings} from '../server/studio-settings.mjs';
import {configuration} from '../server/index.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
const now=2000000000;
const base={iss:AIBRY_ISSUER,aud:MIDNIGHT_CLIENT_ID,sub:'artist-sub',nonce:'expected-nonce',iat:now-10,exp:now+300};
function token(claims=base,header={alg:'RS256',kid:'test-key'}){
 const body=[header,claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
}
const check=value=>verifyAibryIdentity(value,'expected-nonce',async()=>({keys:[jwk]}),{now});
test('AIBRY ID accepts a signed identity for this issuer, client and login nonce',async()=>{
 assert.equal((await check(token())).sub,'artist-sub');
 assert.equal((await check(token({...base,aud:[MIDNIGHT_CLIENT_ID,'another-audience'],azp:MIDNIGHT_CLIENT_ID}))).sub,'artist-sub');
});
test('AIBRY ID rejects wrong issuer, audience, authorized party, nonce, expiration and future claims',async()=>{
 for(const claims of [{...base,iss:'https://other.example'},{...base,aud:'other-client'},{...base,azp:'other-client'},
  {...base,aud:[MIDNIGHT_CLIENT_ID,'other-client']},{...base,nonce:'wrong-nonce'},{...base,exp:now},
  {...base,iat:now+120},{...base,iat:undefined},{...base,nbf:now+120},{...base,sub:''}])
  await assert.rejects(check(token(claims)),e=>e.status===401);
});
test('AIBRY ID rejects unsigned, malformed, unknown-key and tampered identities',async()=>{
 const valid=token();const parts=valid.split('.');
 parts[1]=Buffer.from(JSON.stringify({...base,sub:'forged-artist'})).toString('base64url');
 for(const value of ['not-a-jwt',valid.slice(0,valid.lastIndexOf('.')+1),token(base,{alg:'none',kid:'test-key'}),token(base,{alg:'RS256',kid:'unknown'}),parts.join('.')])
  await assert.rejects(check(value),e=>e.status===401);
});
test('studio settings are explicit, non-secret and subordinate to an environment override',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'midnight-settings-')),path=join(dir,'studio-settings.json');
 try{
  assert.deepEqual(await loadStudioSettings(path),{});
  await writeFile(path,'{"storage":"postgres"}');const settings=await loadStudioSettings(path);
  assert.equal(configuration({},settings).studioStorage,true);
  assert.equal(configuration({MIDNIGHT_STORAGE:'local'},settings).studioStorage,false);
  assert.equal(configuration({}).studioStorage,false);
  await writeFile(path,'{"storage":"postgres","password":"not-allowed"}');
  await assert.rejects(loadStudioSettings(path),/only storage/);
  await writeFile(path,'not-json');await assert.rejects(loadStudioSettings(path),/valid JSON/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
