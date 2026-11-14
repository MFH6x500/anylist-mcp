const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const AnyList = require('anylist');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { registerListTools } = require('../dist/tools/lists.js');
const { registerGroceryTools } = require('../dist/tools/groceries.js');
process.env.ANYLIST_EMAIL = 'fixture@example.invalid';
process.env.ANYLIST_PASSWORD = 'fixture';
let data, writes, ignoreWrite, failWrite;
beforeEach(() => {
  writes = []; ignoreWrite = false; failWrite = false;
  data = {
    shoppingListsResponse: { newLists: [{ identifier: 'list', name: 'Groceries', items: [] }] },
    starterListsResponse: { recentItemListsResponse: {}, favoriteItemListsResponse: {} },
    mealPlanningCalendarResponse: { calendarId: 'calendar' },
    userCategoriesResponse: { identifier: 'categories', categories: [] },
  };
});
mock.method(AnyList.prototype, 'login', async function () {
  this.uid = 'fixture-user';
  this.client = { post: async (path, options) => {
    if (path === 'data/user-data/get') return { body: new this.protobuf.PBUserDataResponse(data).toBuffer() };
    assert.equal(path, 'data/shopping-lists/update');
    if (failWrite) throw new Error('Fixture failure');
    const body = options.body.getBuffer();
    const ops = this.protobuf.PBListOperationList.decode(body.subarray(body.indexOf('\r\n\r\n') + 4, body.lastIndexOf('\r\n--'))).operations;
    for (const op of ops) {
      writes.push(op);
      if (ignoreWrite) continue;
      const list = data.shoppingListsResponse.newLists.find(l => l.identifier === op.listId);
      if (op.metadata.handlerId === 'add-shopping-list-item') list.items.push(op.listItem);
      else if (op.metadata.handlerId === 'set-list-item-checked') list.items.find(i => i.identifier === op.listItemId).checked = op.updatedValue === 'y';
      else assert.fail('Unexpected operation');
    }
    return { body: Buffer.alloc(0) };
  } };
});
mock.method(AnyList.prototype, 'getRecipes', async () => [
  { identifier: 'recipe', name: 'Fixture Recipe', ingredients: [
    { name: 'Milk', quantity: '2 cups' }, { name: 'Flour', quantity: '1 1/2 cups' }, { name: 'Milk', quantity: '2 cups' },
  ] },
]);
async function withTools(fn) {
  const server = new McpServer({ name: 'fixture', version: '1' });
  registerListTools(server); registerGroceryTools(server);
  const client = new Client({ name: 'fixture-client', version: '1' });
  const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  try { await fn((name,args) => client.callTool({ name, arguments: args })); }
  finally { await client.close(); await server.close(); }
}
const ok = r => { assert.ok(!r.isError, JSON.stringify(r)); return r; };
const items = async call => JSON.parse(ok(await call('get_list_items', { list_name: 'Groceries' })).content[0].text);
for (const quantity of [undefined, '', '3', '2 lbs', '1 1/2 cups', 'to taste']) {
  test(`MCP add and read quantity ${JSON.stringify(quantity)}`, () => withTools(async call => {
    ok(await call('add_item_to_list', { list_name: 'Groceries', item_name: 'Fixture', ...(quantity === undefined ? {} : {quantity}) }));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].listItem.quantityPb?.rawQuantity ?? null, quantity || null);
    assert.equal((await items(call))[0].quantity, quantity || null);
    ok(await call('add_item_to_list', { list_name: 'Groceries', item_name: 'Fixture', quantity: 'different' }));
    assert.equal(writes.length, 1);
    assert.equal((await items(call))[0].quantity, quantity || null);
  }));
}
test('read structured and deprecated quantities without erasing their units', () => withTools(async call => {
  data.shoppingListsResponse.newLists[0].items = [
    { identifier:'a',listId:'list',name:'A',quantityPb:{amount:'1 1/2',unit:'cups'} },
    { identifier:'b',listId:'list',name:'B',deprecatedQuantity:'2 bags' },
  ];
  assert.deepEqual((await items(call)).map(i=>i.quantity), ['1 1/2 cups','2 bags']);
}));
test('checked duplicate is unchecked without changing its quantity', () => withTools(async call => {
  data.shoppingListsResponse.newLists[0].items.push({identifier:'a',listId:'list',name:'Milk',checked:true,quantityPb:{rawQuantity:'2 cups'}});
  ok(await call('add_item_to_list',{list_name:'Groceries',item_name:'Milk',quantity:'8 cups'}));
  assert.equal(writes.length,1); assert.equal(writes[0].metadata.handlerId,'set-list-item-checked');
  assert.equal((await items(call))[0].quantity,'2 cups');
  assert.equal((await items(call))[0].checked,false);
}));
for (const tool of ['add_recipe_ingredients_to_list', 'add_ingredients_to_list']) {
  test(`${tool} preserves quantities and handles duplicate ingredients`, () => withTools(async call => {
    ok(await call(tool, {list_name:'Groceries', ...(tool === 'add_recipe_ingredients_to_list' ? {recipe_id:'recipe'} : {recipe_ids:['recipe','recipe']})}));
    assert.equal(writes.length,2);
    assert.deepEqual((await items(call)).map(i=>i.quantity),['2 cups','1 1/2 cups']);
  }));
}
test('ignored add and failed save are errors, retry does not duplicate a successful add', () => withTools(async call => {
  const args={list_name:'Groceries',item_name:'Fixture',quantity:'2 lbs'};
  ignoreWrite=true; assert.equal((await call('add_item_to_list',args)).isError,true);
  ignoreWrite=false; failWrite=true; assert.equal((await call('add_item_to_list',args)).isError,true);
  failWrite=false; ok(await call('add_item_to_list',args)); ok(await call('add_item_to_list',args));
  assert.equal((await items(call)).length,1);
}));
