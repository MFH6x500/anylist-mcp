import AnyList from 'anylist';

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
    await this.ensureConnected();
    return this.client.createEvent(event);
  }

  createItem(item: { name: string; quantity?: string }) {
    return this.client.createItem(item);
  }

  get labels() {
    return this.client.mealPlanningCalendarEventLabels ?? [];
  }
}
