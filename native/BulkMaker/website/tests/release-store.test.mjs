import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestRelease } from '../release-store.mjs';

test('latest download only accepts a notarized, complete local release', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'carousel-release-test-'));
 try {
  assert.equal(await latestRelease(directory), null);
  await mkdir(join(directory, 'releases'));
  await writeFile(join(directory, 'releases/App.dmg'), 'fixture');
  const valid={version:'0.1.0',build:'1',architecture:'arm64',notarized:true,sha256:'a'.repeat(64),size:7,url:'/releases/App.dmg'};
  for (const change of [{notarized:false},{url:'/releases/../secret.dmg'},{size:99},{url:'https://evil.invalid/app.dmg'}]) {
   await writeFile(join(directory,'latest.json'),JSON.stringify({...valid,...change}));
   assert.equal(await latestRelease(directory),null);
  }
  await writeFile(join(directory,'latest.json'),JSON.stringify(valid));
  assert.equal((await latestRelease(directory)).version,'0.1.0');
 } finally { await rm(directory,{recursive:true,force:true}); }
});
