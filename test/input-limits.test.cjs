const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {once}=require('node:events');
const {spawn}=require('node:child_process');
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js');
const {AnyListClient}=require('../dist/anylist-client.js');
const {registerGroceryTools}=require('../dist/tools/groceries.js');
const {MAX_MCP_INPUT_BYTES,MAX_RECIPE_SELECTORS}=require('../dist/input-limits.js');

async function withTools(fn){
 const server=new McpServer({name:'fixture',version:'1'});registerGroceryTools(server);
 const client=new Client({name:'fixture',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{await fn((args)=>client.callTool({name:'add_ingredients_to_list',arguments:args}));}
 finally{await client.close();await server.close();}
}
test('oversized recipe arrays stop before element validation and never call AnyList',()=>withTools(async call=>{
 const stub=mock.method(AnyListClient,'getInstance',()=>{assert.fail('must not reach the API');});
 try{for(const key of ['recipe_ids','recipe_names']){
  const out=await call({[key]:Array(1000).fill(0)});
  assert.equal(out.isError,true);const text=out.content[0].text;
  assert.match(text,/At most 100 entries/);assert.ok(text.length<1000);assert.doesNotMatch(text,/invalid_type/);
 }}finally{stub.mock.restore();}
}));
test('maximum-sized recipe batch reaches the handler; one extra selector refuses',()=>withTools(async call=>{
 let calls=0;
 const stub=mock.method(AnyListClient,'getInstance',()=>({
  getRecipes:async()=>{calls++;return [];},getLists:async()=>[],getListByName:()=>({items:[],getItemByName:()=>undefined}),
 }));
 try{
  const out=await call({recipe_ids:Array(MAX_RECIPE_SELECTORS).fill('missing')});assert.ok(!out.isError);assert.equal(calls,1);
  const refused=await call({recipe_ids:Array(MAX_RECIPE_SELECTORS+1).fill('missing')});assert.equal(refused.isError,true);assert.equal(calls,1);
  const recovered=await call({recipe_ids:['missing']});assert.ok(!recovered.isError);assert.equal(calls,2);
 }finally{stub.mock.restore();}
}));
test('stdio buffer accepts its boundary, closes on overflow and a new connection works',async()=>{
 for(const overflow of [false,true]){
  const input=new PassThrough(),output=new PassThrough();const transport=new StdioServerTransport(input,output,{maxBufferSize:MAX_MCP_INPUT_BYTES});
  let errors=0,closed=0,messages=0;
  transport.onerror=()=>errors++;transport.onclose=()=>closed++;transport.onmessage=()=>messages++;
  await transport.start();
  if(overflow){input.write(Buffer.alloc(MAX_MCP_INPUT_BYTES,32));input.write(Buffer.from(' '));assert.equal(errors,1);assert.equal(closed,1);assert.equal(messages,0);}
  else{const base=JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'});input.write(base+' '.repeat(MAX_MCP_INPUT_BYTES-Buffer.byteLength(base)-1)+'\n');assert.equal(messages,1);assert.equal(errors,0);await transport.close();}
  input.destroy();output.destroy();
 }
 const input=new PassThrough(),output=new PassThrough();const t=new StdioServerTransport(input,output,{maxBufferSize:MAX_MCP_INPUT_BYTES});let received=false;t.onmessage=()=>received=true;await t.start();input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');assert.equal(received,true);await t.close();input.destroy();output.destroy();
});
test('shipped entry point applies the 1 MiB input limit before JSON parsing',async()=>{
 const child=spawn(process.execPath,['dist/index.js'],{cwd:require('node:path').resolve(__dirname,'..'),stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.stdin.on('error',()=>{});
 const timer=setTimeout(()=>child.kill(),5000);
 try{
  const exited=once(child,'exit');child.stdin.end(Buffer.alloc(MAX_MCP_INPUT_BYTES+1,32));
  const [code,signal]=await exited;assert.equal(signal,null);assert.equal(code,0);assert.equal(stdout,'');
 }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
});
