declare module 'anylist' {
  import { EventEmitter } from 'events';

  interface AnyListOptions {
    email: string;
    password: string;
    credentialsFile?: string | null;
  }

  interface ItemData {
    name: string;
    quantity?: string;
    details?: string;
    checked?: boolean;
  }

  interface UserCategory {
    identifier: string;
    name: string | null;
    categoryMatchId: string | null;
  }

  interface UserData {
    userCategoriesResponse: { categories: UserCategory[] } | null;
  }

  class Item {
    identifier: string;
    listId: string;
    name: string;
    quantity: string;
    details: string;
    checked: boolean;
    categoryMatchId: string;
    manualSortIndex: number;
    save(isFavorite?: boolean): Promise<void>;
    toJSON(): Record<string, unknown>;
  }

  class List {
    identifier: string;
    name: string;
    items: Item[];
    addItem(item: Item): Promise<Item>;
    addIngredient(ingredient: Ingredient, options: { recipeId: string; recipeName: string; eventId?: string; eventDate?: string }): Promise<void>;
    removeItem(item: Item, isFavorite?: boolean): Promise<void>;
    getItemById(identifier: string): Item | undefined;
    getItemByName(name: string): Item | undefined;
    uncheckAll(): Promise<void>;
  }

  class Ingredient {
    rawIngredient: string;
    name: string;
    quantity: string;
    note: string;
    toJSON(): Record<string, unknown>;
  }

  class Recipe {
    identifier: string;
    name: string;
    note: string;
    sourceName: string;
    sourceUrl: string;
    ingredients: Ingredient[];
    preparationSteps: string[];
    photoIds: string[];
    photoUrls: string[];
    rating: number;
    cookTime: number;
    prepTime: number;
    servings: string;
    nutritionalInfo: string;
    creationTimestamp: string;
    save(): Promise<void>;
    delete(): Promise<void>;
  }

  class MealPlanningCalendarEvent {
    identifier: string;
    date: Date;
    title: string;
    details: string;
    labelId: string;
    label: MealPlanningCalendarEventLabel | null;
    recipeId: string;
    recipe: Recipe | null;
    recipeScaleFactor: number;
    save(): Promise<void>;
    delete(): Promise<void>;
  }

  class MealPlanningCalendarEventLabel {
    identifier: string;
    calendarId: string;
    hexColor: string;
    name: string;
    sortIndex: number;
  }

  class AnyList extends EventEmitter {
    lists: List[];
    recipes: Recipe[];
    mealPlanningCalendarEvents: MealPlanningCalendarEvent[];
    mealPlanningCalendarEventLabels: MealPlanningCalendarEventLabel[];

    constructor(options: AnyListOptions);
    login(connectWebSocket?: boolean): Promise<void>;
    teardown(): void;

    getLists(refreshCache?: boolean): Promise<List[]>;
    // The pinned library decodes categories but does not expose a public reader.
    _getUserData(refreshCache?: boolean): Promise<UserData>;
    getListById(identifier: string): List | undefined;
    getListByName(name: string): List | undefined;

    getRecipes(refreshCache?: boolean): Promise<Recipe[]>;
    createRecipe(recipe: Partial<Recipe>): Promise<Recipe>;

    getMealPlanningCalendarEvents(refreshCache?: boolean): Promise<MealPlanningCalendarEvent[]>;
    createEvent(event: { title?: string; date?: Date | string; recipeId?: string; labelId?: string }): Promise<MealPlanningCalendarEvent>;

    createItem(item: ItemData): Item;
    getRecentItemsByListId(listId: string): Item[];
  }

  export = AnyList;
}
