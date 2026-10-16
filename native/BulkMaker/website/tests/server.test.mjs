import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('site serves complete pages, protects checkout and streams the latest release', async () => {
 const directory=await mkdtemp(join(tmpdir(),'carousel-http-test-'));
 const releases=join(directory,'publish');
 await mkdir(join(releases,'releases'),{recursive:true});
 await writeFile(join(releases,'releases/Fixture.dmg'),'fixture');
 await writeFile(join(releases,'appcast.xml'),'<rss/>');
 await writeFile(join(releases,'latest.json'),JSON.stringify({version:'0.1.0',build:'1',architecture:'arm64',notarized:true,sha256:'a'.repeat(64),size:7,url:'/releases/Fixture.dmg'}));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:directory,RELEASES_DIR:releases,SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',LEMON_SQUEEZY_API_KEY:''},stdio:['ignore','pipe','pipe']});
 try {
  const origin=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Server startup timeout')),12000);
   child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited '+code)));
   child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});
  });
  for(const path of ['/','/download','/termos','/privacidade','/reembolso']) {
   const response=await fetch(origin+path);assert.equal(response.status,200);
   const html=await response.text();assert.ok(!html.includes('{{'));assert.ok(!html.includes('LEMON_SQUEEZY_API_KEY'));
  }
  assert.equal((await fetch(origin+'/missing')).status,404);
  assert.equal((await fetch(origin+'/checkout/monthly',{method:'POST'})).status,503);
  assert.equal((await fetch(origin+'/checkout/monthly',{method:'POST',headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await fetch(origin+'/api/releases/latest')).status,200);
  const redirect=await fetch(origin+'/download/latest',{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'/releases/Fixture.dmg');
  const range=await fetch(origin+'/releases/Fixture.dmg',{headers:{Range:'bytes=1-3'}});assert.equal(range.status,206);assert.equal(await range.text(),'ixt');
  assert.equal((await fetch(origin+'/releases/Fixture.dmg',{headers:{Range:'bytes=100-200'}})).status,416);
  const signup=await fetch(origin+'/api/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'http@example.invalid',xHandle:'httptest'})});assert.equal(signup.status,200);
 } finally { child.kill('SIGTERM'); await new Promise(r=>child.once('exit',r));await rm(directory,{recursive:true,force:true}); }
});
