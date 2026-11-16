const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../sync-core.js');
const {changes,merge,validate,GitHubStore} = globalThis.VaultSync;
const p=(id,prompt=id)=>({id,title:id,prompt});
test('independent edits, additions and remote deletions merge without resurrection',()=>{
 const base=[p('a'),p('b')], local=[p('a','edit'),p('b'),p('c')];
 assert.deepEqual(merge([p('a'),p('d')],changes(base,local)),[p('a','edit'),p('d'),p('c')]);
 assert.deepEqual(merge(base,changes(base,[])),[]);
});
test('same-row edits and delete/edit conflicts stop; acknowledged writes are idempotent',()=>{
 assert.throws(()=>merge([p('a','remote')],changes([p('a')],[p('a','local')])));
 assert.throws(()=>merge([p('a','remote')],changes([p('a')],[])));
 assert.deepEqual(merge([p('a','local')],changes([p('a')],[p('a','local')])),[p('a','local')]);
 assert.deepEqual(validate([]),[]);
 assert.throws(()=>validate([p('a'),p('a')]));
 validate(JSON.parse(fs.readFileSync('prompts.json','utf8')));
});
test('large file reads immutable blob; unchanged SHA skips body; writes include SHA and UTF8',async()=>{
 const original=global.fetch;const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/git/blobs/')?[p('한글')]:options.method==='PUT'?{content:{sha:'next'}}:{sha:'large',encoding:'none'}};};
 try {
 const store=new GitHubStore('test-token');const first=await store.read();assert.equal(first.data[0].id,'한글');
 assert.ok(calls[1].url.endsWith('/git/blobs/large'));
 await store.read(first.sha,first.data);assert.equal(calls.length,3);
 await store.write(first.data,first.sha);
 const body=JSON.parse(calls[3].options.body);assert.equal(body.sha,'large');assert.deepEqual(JSON.parse(Buffer.from(body.content,'base64').toString()),first.data);
 } finally {global.fetch=original;}
});
function app() {
 const nodes=new Map(),data=new Map();
 const node=()=>({textContent:'',value:'',hidden:false,style:{},classList:{add(){},remove(){},contains(){return false;},toggle(){}},addEventListener(){}});
 const ctx={console,Map,Set,Date,JSON,Blob,URL,TextEncoder,AbortSignal,VaultSync,alert(){},confirm(){return true;},setTimeout(){},setInterval(){},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},navigator:{},document:{hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},addEventListener(){},body:node()},window:{addEventListener(){}}};
 vm.createContext(ctx);
 const html=fs.readFileSync('index.html','utf8');const code=html.split('<script>')[1].split('</script>')[0].replace(/load\(\);\s*$/,'');
 vm.runInContext(code,ctx);vm.runInContext('render = () => updateSyncStatus();',ctx);
 return {ctx,data,run:code=>vm.runInContext(code,ctx)};
}
test('app retains offline changes and syncs deletes/additions after reconnect',async()=>{
 const a=app();a.run(`shared=[{id:'a',title:'a',prompt:'a'}];prompts=JSON.parse(JSON.stringify(shared));store.read=async()=>{throw new Error('offline')};prompts.push({id:'b',title:'b',prompt:'b'});save();`);
 await a.run('refreshShared()');assert.equal(a.run('pending.length'),1);
 a.run(`store.token='test';store.read=async()=>({sha:'one',data:[{id:'a',title:'a',prompt:'a'}]});store.write=async()=> 'two';`);
 await a.run('refreshShared()');assert.equal(a.run('pending.length'),0);assert.equal(a.run('shared.length'),2);
 a.run(`prompts=[];save();`);await new Promise(r=>setImmediate(r));assert.equal(a.run('shared.length'),0);assert.equal(a.run('pending.length'),0);
});
test('app preserves edits made while a write is in flight',async()=>{
 const a=app();let resolveWrite;
 a.ctx.writeWait=new Promise(r=>resolveWrite=r);
 a.run(`shared=[{id:'a',title:'a',prompt:'a'}];prompts=[{id:'a',title:'a',prompt:'first'}];pending=VaultSync.changes(shared,prompts);store.token='test';store.read=async()=>({sha:'one',data:shared});store.write=async()=>writeWait;`);
 const flight=a.run('refreshShared()');await new Promise(r=>setImmediate(r));
 a.run(`prompts[0]={...prompts[0],prompt:'second'};save();`);resolveWrite('two');await flight;
 assert.equal(a.run('shared[0].prompt'),'first');assert.equal(a.run('pending[0].before.prompt'),'first');assert.equal(a.run('pending[0].after.prompt'),'second');
});
test('app conflicts retain local changes and do not write',async()=>{
 const a=app();a.run(`shared=[{id:'a',title:'a',prompt:'a'}];prompts=[{id:'a',title:'a',prompt:'local'}];pending=VaultSync.changes(shared,prompts);store.token='test';store.read=async()=>({sha:'one',data:[{id:'a',title:'a',prompt:'remote'}]});store.write=async()=>{throw new Error('should not write')};`);
 await a.run('refreshShared()');assert.equal(a.run('pending.length'),1);assert.equal(a.run('prompts[0].prompt'),'local');assert.match(a.run('syncMessage'),/다른 기기/);
});
