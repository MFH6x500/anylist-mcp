import AnyList from 'anylist';
import FormData from 'form-data';
import { randomUUID } from 'node:crypto';

let instance: AnyListClient | null = null;

export class AnyListClient {
  private client: AnyList;
  private connected = false;

  private constructor() {
    const email = process.env.ANYLIST_EMAIL;
    const password = process.env.ANYLIST_PASSWORD;
    if (!email || !password) {
      throw new Error('ANYLIST_EMAIL and ANYLIST_PASSWORD environment variables are required');
    }
    this.client = new AnyList({ email, password, credentialsFile: null });
  }

  static getInstance(): AnyListClient {
    if (!instance) {
      instance = new AnyListClient();
    }
    return instance;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.client.login(false);
      this.connected = true;
    }
  }

  private async withReconnect<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await this.ensureConnected();
      return await fn();
    } catch (error) {
      // Retry once after reconnecting
      this.connected = false;
      await this.ensureConnected();
      return await fn();
    }
  }

  async getLists() {
    return this.withReconnect(() => this.client.getLists());
  }

  async getCategories(refreshCache = true) {
    return this.withReconnect(async () => {
      // Reuse the pinned library's decoded response, authentication and cache.
      // Category record IDs are NOT the match IDs accepted by Item.save().
      const data = await this.client._getUserData(refreshCache);
      if (!data.userCategoriesResponse) {
        throw new Error('Category metadata unavailable from AnyList');
      }
      return data.userCategoriesResponse.categories
        .filter((c) => c.name && c.categoryMatchId)
        .map((c) => ({ id: c.identifier, name: c.name!, categoryMatchId: c.categoryMatchId! }));
    });
  }

  async setItemCategory(listId: string, itemId: string, categoryMatchId: string) {
    // Use the complete decoded item: Item.toJSON() drops fields such as
    // categoryAssignments, prices and store IDs. The library's Item.save()
    // sends updatedValue, which this handler ignores (b4924).
    const data = await this.client._getUserData(false);
    const source = data.shoppingListsResponse.newLists
      .find((list) => list.identifier === listId)?.items
      .find((item) => item.identifier === itemId);
    if (!source) throw new Error('Item unavailable in the refreshed list snapshot');
    const category = data.userCategoriesResponse?.categories
      .find((entry) => entry.categoryMatchId === categoryMatchId);
    if (!category) throw new Error('Category unavailable in the refreshed snapshot');
    const item = this.client.protobuf.ListItem.decode(source.toBuffer());
    item.categoryMatchId = categoryMatchId;
    item.category = category.systemCategory || 'other';
    const operation = new this.client.protobuf.PBListOperation({
      metadata: { operationId: randomUUID(), handlerId: 'set-list-item-category-match-id', userId: this.client.uid },
      listId, listItemId: itemId, listItem: item, originalValue: categoryMatchId,
    });
    const form = new FormData();
    form.append('operations', new this.client.protobuf.PBListOperationList({ operations: [operation] }).toBuffer());
    // Do not automatically replay an uncertain mutation after reconnecting.
    await this.client.client.post('data/shopping-lists/update', { body: form });
    const verified = (await this.getLists()).find((list) => list.identifier === listId)?.getItemById(itemId);
    if (!verified || verified.categoryMatchId !== categoryMatchId) {
      throw new Error('Category write did not persist on a fresh read; refresh the list before retrying');
    }
  }

  async getItemQuantities(listId: string): Promise<Map<string, string | null>> {
    const data = await this.client._getUserData(false);
    const items = data.shoppingListsResponse.newLists.find((list) => list.identifier === listId)?.items ?? [];
    return new Map(items.map((item) => {
      const quantity = item.quantityPb;
      const text = quantity?.rawQuantity
        || [quantity?.amount, quantity?.unit].filter(Boolean).join(' ')
        || item.deprecatedQuantity || null;
      return [item.identifier, text];
    }));
  }

  async addItem(list: Awaited<ReturnType<AnyList['getLists']>>[number], input: { name: string; quantity?: string }) {
    const identifier = randomUUID().replace(/-/g, '');
    const quantity = input.quantity || null;
    // The pinned Item._encode() writes the removed quantity field. Encode the
    // current schema directly and keep freeform text intact, without guessing units.
    const item = new this.client.protobuf.ListItem({
      identifier, listId: list.identifier, name: input.name, checked: false,
      categoryMatchId: 'other',
      ...(quantity ? { quantityPb: { rawQuantity: quantity }, deprecatedQuantity: quantity } : {}),
    });
    const operation = new this.client.protobuf.PBListOperation({
      metadata: { operationId: randomUUID(), handlerId: 'add-shopping-list-item', userId: this.client.uid },
      listId: list.identifier, listItemId: identifier, listItem: item,
    });
    const form = new FormData();
    form.append('operations', new this.client.protobuf.PBListOperationList({ operations: [operation] }).toBuffer());
    await this.client.client.post('data/shopping-lists/update', { body: form });
    const verified = (await this.getLists()).find((entry) => entry.identifier === list.identifier)?.getItemById(identifier);
    const quantities = await this.getItemQuantities(list.identifier);
    if (!verified || verified.name !== input.name || quantities.get(identifier) !== quantity) {
      throw new Error('Added item or quantity was not confirmed on a fresh read; refresh the list before retrying');
    }
    // Bulk recipes retain this List object across additions. Keep its duplicate
    // lookup current even though getLists() replaced the client's snapshot.
    if (!list.getItemById(identifier)) list.items.push(verified);
    return verified;
  }

  getListByName(name: string) {
    return this.client.getListByName(name);
  }

  async getRecipes() {
    return this.withReconnect(() => this.client.getRecipes());
  }

  async getMealPlanningCalendarEvents() {
    return this.withReconnect(() => this.client.getMealPlanningCalendarEvents());
  }

  async createEvent(event: { title?: string; date?: Date | string; recipeId?: string; labelId?: string }) {
    return this.withReconnect(() => this.client.createEvent(event));
  }

  get labels() {
    return this.client.mealPlanningCalendarEventLabels ?? [];
  }
}
