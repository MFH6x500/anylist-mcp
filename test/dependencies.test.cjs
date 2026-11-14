const {test}=require('node:test');
const assert=require('node:assert/strict');
const AnyList=require('anylist');
const make=()=>new AnyList({email:'fixture',password:'fixture',credentialsFile:null}).protobuf;
test('malformed nested groups are rejected without exhausting the call stack',()=>{
  const pb=make();
  const input=Buffer.concat([Buffer.from('a306'.repeat(30000),'hex'),Buffer.from('a406'.repeat(30000),'hex')]);
  assert.throws(()=>pb.PBUserDataResponse.decode(input),e=>e instanceof Error && !(e instanceof RangeError));
});
const golden=require('./fixtures/protobuf-v5.json');
for(const [name,fixture]of Object.entries(golden)){
 test(`modern adapter preserves legacy ${name} wire values`,()=>{
  const pb=make();const bytes=Buffer.from(fixture.base64,'base64');
  // Field ordering can differ between encoders; protobuf does not assign it meaning.
  const encoded = new pb[name](fixture.fields).toBuffer();
  assert.deepEqual(pb[name].decode(encoded), pb[name].decode(bytes));
  assert.deepEqual(pb[name].decode(bytes).toBuffer(), encoded);
  function subset(actual, expected) {
    for (const [key,value] of Object.entries(expected)) {
      if (value && typeof value === 'object') subset(actual[key],value);
      else assert.equal(actual[key],value);
    }
  }
  subset(pb[name].decode(bytes),fixture.fields);
 });
}
test('legacy optional defaults, repeated setters and 64-bit integers survive round trip',()=>{
 const pb=make();const msg=pb.PBUserDataResponse.decode(Buffer.from(golden.PBUserDataResponse.base64,'base64'));
 assert.equal(msg.shoppingListsResponse.newLists[0].items[0].checked,false);
 assert.equal(msg.shoppingListsResponse.newLists[0].logicalClockTime,'9007199254740993');
 assert.equal(msg.shoppingListsResponse.newLists[0].items[0].recipeId,null);
 const ops=new pb.PBListOperationList();ops.setOperations({listId:'list'});
 assert.equal(pb.PBListOperationList.decode(ops.toBuffer()).operations[0].listId,'list');
});
test('decoder byte limit refuses oversized input and accepts a later valid message',()=>{
 const pb=make();assert.throws(()=>pb.PBUserDataResponse.decode(Buffer.alloc(16*1024*1024+1)),/exceeds 16 MiB/);
 const bytes=Buffer.from(golden.PBUserDataResponse.base64,'base64');assert.equal(pb.PBUserDataResponse.decode(bytes).mealPlanningCalendarResponse.calendarId,'calendar');
});
test('AnyList UUID adapter produces valid v4 identifiers and refuses unsupported argument forms',()=>{
 const uuid=require('uuid/v4');assert.match(uuid(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.throws(()=>uuid({}),/no arguments/);
});
test('AnyList recipe, calendar and ingredient operations use the compatible runtime',async()=>{
 const a=new AnyList({email:'fixture',password:'fixture',credentialsFile:null});a.uid='user';const writes=[];
 a.client={post:async(path,options)=>{
  if(path==='data/user-data/get')return {body:Buffer.from(golden.PBUserDataResponse.base64,'base64')};
  const body=options.body.getBuffer();const bytes=body.subarray(body.indexOf('\r\n\r\n')+4,body.lastIndexOf('\r\n--'));
  const type=path==='data/meal-planning-calendar/update'?'PBCalendarOperationList':'PBListOperationList';
  writes.push(a.protobuf[type].decode(bytes).operations[0]);return {body:Buffer.alloc(0)};
 }};
 const lists=await a.getLists(),recipes=await a.getRecipes(),events=await a.getMealPlanningCalendarEvents();
 assert.equal(recipes[0].ingredients[0].quantity,'2 cups');assert.equal(events[0].title,'Dinner');
 const event=await a.createEvent({date:'2026-11-14',title:'Fixture',recipeId:'recipe'});await event.save();
 assert.equal(writes[0].metadata.handlerId,'new-event');assert.equal(writes[0].updatedEvent.date,'2026-11-14');
 await lists[0].addIngredient(recipes[0].ingredients[0],{recipeId:'recipe',recipeName:'Bread'});
 assert.equal(writes[1].metadata.handlerId,'add-item-ingredient-to-list-item');
 assert.equal(writes[1].listItem.ingredients[0].ingredient.quantity,'2 cups');
});
