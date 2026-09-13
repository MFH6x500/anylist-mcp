const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const AnyList = require('anylist');
const Item = require('anylist/lib/item');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { registerListTools } = require('../dist/tools/lists.js');

process.env.ANYLIST_EMAIL = 'fixture@example.invalid';
process.env.ANYLIST_PASSWORD = 'fixture-only';
let data, writes, failWrite, failRead;
beforeEach(() => {
  writes = []; failWrite = false; failRead = false;
  data = {
    shoppingListsResponse: { newLists: [{ identifier: 'list-fixture', name: 'Groceries', items: [
      { identifier: 'item-fixture', listId: 'list-fixture', name: 'Milk', details: 'Fixture', checked: false, categoryMatchId: 'other' },
    ] }] },
    starterListsResponse: { recentItemListsResponse: {}, favoriteItemListsResponse: {} },
    mealPlanningCalendarResponse: { calendarId: 'calendar-fixture' },
    userCategoriesResponse: { identifier: 'categories-fixture', categories: [
      { identifier: 'category-other', name: 'Other', categoryMatchId: 'other' },
      { identifier: 'category-dairy', name: 'Dairy', categoryMatchId: 'dairy' },
      { identifier: 'category-custom', name: 'Custom Aisle', categoryMatchId: 'custom-match-42' },
    ] },
  };
});

// Replace only authentication and HTTP. Keep the library's real protobuf decoder,
// getLists, Item setter/save and multipart request, and the MCP protocol itself.
mock.method(AnyList.prototype, 'login', async function () {
  this.uid = 'user-fixture';
  this.client = { post: async (path, options) => {
    if (path === 'data/user-data/get') {
      if (failRead) throw new Error('Fixture read failure');
      return { body: new this.protobuf.PBUserDataResponse(data).toBuffer() };
    }
    assert.equal(path, 'data/shopping-lists/update');
    if (failWrite) throw new Error('Fixture save failure');
    const body = options.body.getBuffer();
    const start = body.indexOf('\r\n\r\n') + 4;
    const end = body.lastIndexOf('\r\n--');
    const ops = this.protobuf.PBListOperationList.decode(body.subarray(start, end)).operations;
    for (const op of ops) {
      writes.push(op);
      if (op.metadata.handlerId === 'set-list-item-category-match-id') {
        const list = data.shoppingListsResponse.newLists.find(l => l.identifier === op.listId);
        list.items.find(i => i.identifier === op.listItemId).categoryMatchId = op.updatedValue;
      }
    }
    return { body: Buffer.alloc(0) };
  } };
});

async function withTools(fn) {
  const server = new McpServer({ name: 'fixture', version: '1' });
  registerListTools(server);
  const client = new Client({ name: 'fixture-client', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  try { await fn(call, client); } finally { await client.close(); await server.close(); }
}
const resultJSON = result => { assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); };
const target = { list_name: 'Groceries', item_id: 'item-fixture' };

test('category tools are discoverable and item reads expose the category', () => withTools(async (call, client) => {
  const names = (await client.listTools()).tools.map(t => t.name);
  assert.ok(names.includes('get_categories'));
  assert.ok(names.includes('set_item_category'));
  const categories = resultJSON(await call('get_categories'));
  assert.deepEqual(categories.find(c => c.name === 'Custom Aisle'), { id: 'category-custom', name: 'Custom Aisle', categoryMatchId: 'custom-match-42' });
  const [item] = resultJSON(await call('get_list_items', { list_name: 'Groceries' }));
  assert.equal(item.categoryMatchId, 'other'); assert.equal(item.categoryName, 'Other');
}));

async function wireWitness(call) {
  for (const [category_name, expected] of [[' dairy ', 'dairy'], ['Custom Aisle', 'custom-match-42'], ['Other', 'other']]) {
    const before = writes.length;
    assert.ok(!(await call('set_item_category', { ...target, category_name })).isError);
    assert.equal(writes.length, before + 1);
    const op = writes.at(-1);
    assert.equal(op.metadata.handlerId, 'set-list-item-category-match-id');
    assert.equal(op.listId, 'list-fixture'); assert.equal(op.listItemId, 'item-fixture');
    assert.equal(op.updatedValue, expected);
    const [item] = resultJSON(await call('get_list_items', { list_name: 'Groceries' }));
    assert.equal(item.categoryMatchId, expected);
    assert.equal(item.quantity, null); assert.equal(item.details, 'Fixture'); assert.equal(item.checked, false);
  }
}
test('real MCP to Item.save wire round trip and recategorisation back to Other', () => withTools(wireWitness));
test('wire witness detects a bypassed save', () => withTools(async call => {
  const stub = mock.method(Item.prototype, 'save', async () => {});
  try { await assert.rejects(() => wireWitness(call), assert.AssertionError); }
  finally { stub.mock.restore(); }
}));

test('explicit match ID selects a custom category and repeat is a no-op', () => withTools(async call => {
  const args = { ...target, category_match_id: 'custom-match-42' };
  assert.ok(!(await call('set_item_category', args)).isError);
  assert.equal(writes[0].updatedValue, 'custom-match-42');
  assert.ok(!(await call('set_item_category', args)).isError);
  assert.equal(writes.length, 1);
}));
test('invalid selectors, missing targets and unknown categories never write', () => withTools(async call => {
  for (const args of [target, { ...target, category_name: '' },
    { ...target, category_name: 'Dairy', category_match_id: 'dairy' },
    { ...target, category_name: 'Dai' }, { ...target, category_match_id: 'category-dairy' },
    { ...target, list_name: 'Absent', category_name: 'Dairy' },
    { ...target, item_id: 'absent', category_name: 'Dairy' }]) {
    assert.equal((await call('set_item_category', args)).isError, true, JSON.stringify(args));
  }
  assert.equal(writes.length, 0);
}));
test('duplicate names require a match ID', () => withTools(async call => {
  data.userCategoriesResponse.categories.push({ identifier: 'duplicate', name: 'DAIRY', categoryMatchId: 'second-dairy' });
  assert.equal((await call('set_item_category', { ...target, category_name: 'Dairy' })).isError, true);
  assert.equal(writes.length, 0);
  assert.ok(!(await call('set_item_category', { ...target, category_match_id: 'second-dairy' })).isError);
}));
test('save failure is an error and a subsequent call can retry', () => withTools(async call => {
  failWrite = true;
  assert.equal((await call('set_item_category', { ...target, category_name: 'Dairy' })).isError, true);
  failWrite = false;
  assert.ok(!(await call('set_item_category', { ...target, category_name: 'Dairy' })).isError);
  assert.equal(writes.length, 1);
}));
test('unmapped item IDs remain visible without a guessed category name', () => withTools(async call => {
  data.shoppingListsResponse.newLists[0].items[0].categoryMatchId = 'unmapped';
  const [item] = resultJSON(await call('get_list_items', { list_name: 'Groceries' }));
  assert.equal(item.categoryMatchId, 'unmapped'); assert.equal(item.categoryName, null);
}));
test('missing category metadata and read failures are reported', () => withTools(async call => {
  delete data.userCategoriesResponse;
  assert.equal((await call('get_categories')).isError, true);
  assert.equal((await call('set_item_category', { ...target, category_name: 'Dairy' })).isError, true);
  failRead = true;
  assert.equal((await call('get_categories')).isError, true);
  assert.equal(writes.length, 0);
}));
