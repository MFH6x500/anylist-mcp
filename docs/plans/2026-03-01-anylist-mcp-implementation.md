# AnyList MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that wraps the AnyList API to let Claude manage meal plans, recipes, and grocery lists.

**Architecture:** TypeScript MCP server using stdio transport. A singleton `AnyListClient` class handles lazy connection and auto-reconnect. Tool modules in `src/tools/` register handlers with the MCP server. The `anylist` npm package (v0.8.5) provides the underlying API access.

**Tech Stack:** TypeScript, Node.js (>=16), `@modelcontextprotocol/server`, `anylist`, `zod`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/types/anylist.d.ts`
- Create: `.env.example`

**Step 1: Initialize project and install dependencies**

Run:
```bash
npm init -y
npm install anylist @modelcontextprotocol/server zod
npm install -D typescript @types/node tsx
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create type declarations for the anylist package**

Create `src/types/anylist.d.ts` — the `anylist` package has no TypeScript types, so we declare the shapes we use:

```typescript
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
    addItem(item: Item, isFavorite?: boolean): Promise<Item>;
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
```

**Step 4: Create .env.example**

```
ANYLIST_EMAIL=your-email@example.com
ANYLIST_PASSWORD=your-password
```

**Step 5: Update package.json scripts**

Add to `package.json`:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  }
}
```

**Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json src/types/anylist.d.ts .env.example
git commit -m "chore: scaffold project with dependencies and type declarations"
```

---

### Task 2: AnyList Client Wrapper

**Files:**
- Create: `src/anylist-client.ts`

**Step 1: Write the AnyListClient singleton**

This class wraps the `anylist` package with lazy connection and auto-reconnect:

```typescript
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
```

**Step 2: Commit**

```bash
git add src/anylist-client.ts
git commit -m "feat: add AnyListClient singleton with lazy connect and auto-reconnect"
```

---

### Task 3: Recipes Tools

**Files:**
- Create: `src/tools/recipes.ts`

**Step 1: Implement get_recipes and get_recipe_details tools**

```typescript
import { McpServer } from '@modelcontextprotocol/server/mcp.js';
import { z } from 'zod';
import { AnyListClient } from '../anylist-client.js';

export function registerRecipeTools(server: McpServer) {
  server.registerTool(
    'get_recipes',
    {
      title: 'Get Recipes',
      description:
        'List all saved recipes from the AnyList account. Returns name, rating, cook time, prep time, and servings for each recipe. Use the optional search parameter to filter by name.',
      inputSchema: z.object({
        search: z.string().optional().describe('Optional text to filter recipes by name (case-insensitive)'),
      }),
    },
    async ({ search }) => {
      try {
        const client = AnyListClient.getInstance();
        const recipes = await client.getRecipes();

        let filtered = recipes;
        if (search) {
          const term = search.toLowerCase();
          filtered = recipes.filter((r) => r.name?.toLowerCase().includes(term));
        }

        const summary = filtered.map((r) => ({
          id: r.identifier,
          name: r.name,
          rating: r.rating ?? null,
          cookTime: r.cookTime ?? null,
          prepTime: r.prepTime ?? null,
          servings: r.servings ?? null,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching recipes: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'get_recipe_details',
    {
      title: 'Get Recipe Details',
      description:
        'Get full details of a specific recipe including ingredients and preparation steps. Look up by name or ID.',
      inputSchema: z.object({
        recipe_name: z.string().optional().describe('Recipe name to look up (case-insensitive partial match)'),
        recipe_id: z.string().optional().describe('Recipe identifier for exact lookup'),
      }),
    },
    async ({ recipe_name, recipe_id }) => {
      try {
        if (!recipe_name && !recipe_id) {
          return {
            content: [{ type: 'text', text: 'Error: provide either recipe_name or recipe_id' }],
            isError: true,
          };
        }

        const client = AnyListClient.getInstance();
        const recipes = await client.getRecipes();

        let recipe;
        if (recipe_id) {
          recipe = recipes.find((r) => r.identifier === recipe_id);
        } else if (recipe_name) {
          const term = recipe_name.toLowerCase();
          recipe = recipes.find((r) => r.name?.toLowerCase() === term)
            ?? recipes.find((r) => r.name?.toLowerCase().includes(term));
        }

        if (!recipe) {
          return {
            content: [{ type: 'text', text: `Recipe not found: ${recipe_name ?? recipe_id}` }],
            isError: true,
          };
        }

        const details = {
          id: recipe.identifier,
          name: recipe.name,
          rating: recipe.rating ?? null,
          cookTime: recipe.cookTime ?? null,
          prepTime: recipe.prepTime ?? null,
          servings: recipe.servings ?? null,
          note: recipe.note ?? null,
          sourceName: recipe.sourceName ?? null,
          sourceUrl: recipe.sourceUrl ?? null,
          nutritionalInfo: recipe.nutritionalInfo ?? null,
          ingredients: recipe.ingredients.map((i) => ({
            rawIngredient: i.rawIngredient,
            name: i.name,
            quantity: i.quantity,
            note: i.note,
          })),
          preparationSteps: recipe.preparationSteps,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching recipe details: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
```

**Step 2: Commit**

```bash
git add src/tools/recipes.ts
git commit -m "feat: add get_recipes and get_recipe_details tools"
```

---

### Task 4: Meal Plan Tools

**Files:**
- Create: `src/tools/meal-plan.ts`

**Step 1: Implement get_meal_plan and add_meal_plan_event tools**

```typescript
import { McpServer } from '@modelcontextprotocol/server/mcp.js';
import { z } from 'zod';
import { AnyListClient } from '../anylist-client.js';

function getWeekBounds(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

export function registerMealPlanTools(server: McpServer) {
  server.registerTool(
    'get_meal_plan',
    {
      title: 'Get Meal Plan',
      description:
        'Get meal plan events for a date range. Defaults to the current week (Mon-Sun). Use a 6-week lookback (e.g. start_date 6 weeks ago) to understand recent eating patterns when recommending new meals.',
      inputSchema: z.object({
        start_date: z.string().optional().describe('Start date in YYYY-MM-DD format (defaults to this Monday)'),
        end_date: z.string().optional().describe('End date in YYYY-MM-DD format (defaults to this Sunday)'),
      }),
    },
    async ({ start_date, end_date }) => {
      try {
        const client = AnyListClient.getInstance();
        const events = await client.getMealPlanningCalendarEvents();

        const { start: defaultStart, end: defaultEnd } = getWeekBounds();
        const start = start_date ? new Date(start_date + 'T00:00:00') : defaultStart;
        const end = end_date ? new Date(end_date + 'T23:59:59') : defaultEnd;

        const filtered = events
          .filter((e) => {
            const d = new Date(e.date);
            return d >= start && d <= end;
          })
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const result = filtered.map((e) => ({
          id: e.identifier,
          date: e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date).slice(0, 10),
          title: e.title ?? null,
          label: e.label?.name ?? null,
          recipeName: e.recipe?.name ?? null,
          recipeId: e.recipeId ?? null,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching meal plan: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'add_meal_plan_event',
    {
      title: 'Add Meal Plan Event',
      description:
        'Schedule a recipe or titled event on a specific day in the meal plan calendar.',
      inputSchema: z.object({
        date: z.string().describe('Date in YYYY-MM-DD format'),
        recipe_name: z.string().optional().describe('Recipe name to schedule (case-insensitive match)'),
        recipe_id: z.string().optional().describe('Recipe identifier for exact lookup'),
        title: z.string().optional().describe('Event title (used if no recipe specified, or as override)'),
        label: z.string().optional().describe('Meal label, e.g. "Breakfast", "Lunch", "Dinner" (case-insensitive match)'),
      }),
    },
    async ({ date, recipe_name, recipe_id, title, label }) => {
      try {
        const client = AnyListClient.getInstance();

        let recipeId = recipe_id;
        let eventTitle = title;

        // Resolve recipe by name if needed
        if (!recipeId && recipe_name) {
          const recipes = await client.getRecipes();
          const term = recipe_name.toLowerCase();
          const recipe = recipes.find((r) => r.name?.toLowerCase() === term)
            ?? recipes.find((r) => r.name?.toLowerCase().includes(term));
          if (!recipe) {
            return {
              content: [{ type: 'text', text: `Recipe not found: ${recipe_name}` }],
              isError: true,
            };
          }
          recipeId = recipe.identifier;
          if (!eventTitle) eventTitle = recipe.name;
        }

        // Resolve label
        let labelId: string | undefined;
        if (label) {
          const labels = client.labels;
          const match = labels.find((l) => l.name?.toLowerCase() === label.toLowerCase());
          if (match) {
            labelId = match.identifier;
          }
        }

        const event = await client.createEvent({
          date: new Date(date + 'T12:00:00'),
          recipeId,
          title: eventTitle,
          labelId,
        });
        await event.save();

        return {
          content: [{
            type: 'text',
            text: `Meal plan event created: "${eventTitle ?? 'Untitled'}" on ${date}${label ? ` (${label})` : ''}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error creating meal plan event: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
```

**Step 2: Commit**

```bash
git add src/tools/meal-plan.ts
git commit -m "feat: add get_meal_plan and add_meal_plan_event tools"
```

---

### Task 5: List Tools

**Files:**
- Create: `src/tools/lists.ts`

**Step 1: Implement get_lists, get_list_items, and add_item_to_list tools**

```typescript
import { McpServer } from '@modelcontextprotocol/server/mcp.js';
import { z } from 'zod';
import { AnyListClient } from '../anylist-client.js';

export function registerListTools(server: McpServer) {
  server.registerTool(
    'get_lists',
    {
      title: 'Get Lists',
      description: 'List all shopping lists in the AnyList account.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const client = AnyListClient.getInstance();
        const lists = await client.getLists();

        const result = lists.map((l) => ({
          id: l.identifier,
          name: l.name,
          itemCount: l.items.length,
          uncheckedCount: l.items.filter((i) => !i.checked).length,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching lists: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'get_list_items',
    {
      title: 'Get List Items',
      description: 'Get all items on a specific shopping list.',
      inputSchema: z.object({
        list_name: z.string().describe('Name of the list to retrieve items from'),
      }),
    },
    async ({ list_name }) => {
      try {
        const client = AnyListClient.getInstance();
        await client.getLists();
        const list = client.getListByName(list_name);

        if (!list) {
          return {
            content: [{ type: 'text', text: `List not found: "${list_name}"` }],
            isError: true,
          };
        }

        const result = list.items.map((i) => ({
          id: i.identifier,
          name: i.name,
          quantity: i.quantity ?? null,
          details: i.details ?? null,
          checked: i.checked,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching list items: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'add_item_to_list',
    {
      title: 'Add Item to List',
      description: 'Add a freeform item to a shopping list. Checks for duplicates before adding.',
      inputSchema: z.object({
        item_name: z.string().describe('Name of the item to add'),
        list_name: z.string().describe('Name of the list to add to'),
        quantity: z.string().optional().describe('Quantity string, e.g. "2 lbs" or "3"'),
      }),
    },
    async ({ item_name, list_name, quantity }) => {
      try {
        const client = AnyListClient.getInstance();
        await client.getLists();
        const list = client.getListByName(list_name);

        if (!list) {
          return {
            content: [{ type: 'text', text: `List not found: "${list_name}"` }],
            isError: true,
          };
        }

        // Check for existing item
        const existing = list.getItemByName(item_name);
        if (existing) {
          if (existing.checked) {
            existing.checked = false;
            await existing.save();
            return {
              content: [{ type: 'text', text: `"${item_name}" was already on "${list_name}" (checked off) — unchecked it` }],
            };
          }
          return {
            content: [{ type: 'text', text: `"${item_name}" is already on "${list_name}"` }],
          };
        }

        const item = client.createItem({ name: item_name, quantity });
        await list.addItem(item);

        return {
          content: [{ type: 'text', text: `Added "${item_name}"${quantity ? ` (${quantity})` : ''} to "${list_name}"` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error adding item: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
```

**Step 2: Commit**

```bash
git add src/tools/lists.ts
git commit -m "feat: add get_lists, get_list_items, and add_item_to_list tools"
```

---

### Task 6: Grocery Tools

**Files:**
- Create: `src/tools/groceries.ts`

**Step 1: Implement add_recipe_ingredients_to_list and add_ingredients_to_list tools**

```typescript
import { McpServer } from '@modelcontextprotocol/server/mcp.js';
import { z } from 'zod';
import { AnyListClient } from '../anylist-client.js';
import AnyListModule from 'anylist';

type AnyListType = InstanceType<typeof AnyListModule>;
type List = ReturnType<AnyListType['getListByName']>;
type Recipe = Awaited<ReturnType<AnyListType['getRecipes']>>[number];

async function addRecipeIngredientsToList(
  client: AnyListClient,
  recipe: Recipe,
  list: NonNullable<List>,
): Promise<{ added: string[]; skipped: string[]; unchecked: string[] }> {
  const added: string[] = [];
  const skipped: string[] = [];
  const unchecked: string[] = [];

  for (const ingredient of recipe.ingredients) {
    const ingredientName = ingredient.name || ingredient.rawIngredient;
    if (!ingredientName) continue;

    const existing = list.getItemByName(ingredientName);
    if (existing) {
      if (existing.checked) {
        existing.checked = false;
        await existing.save();
        unchecked.push(ingredientName);
      } else {
        skipped.push(ingredientName);
      }
      continue;
    }

    const item = client.createItem({
      name: ingredientName,
      quantity: ingredient.quantity || undefined,
    });
    await list.addItem(item);
    added.push(ingredientName);
  }

  return { added, skipped, unchecked };
}

async function resolveRecipe(client: AnyListClient, name?: string, id?: string) {
  const recipes = await client.getRecipes();
  if (id) {
    return recipes.find((r) => r.identifier === id);
  }
  if (name) {
    const term = name.toLowerCase();
    return recipes.find((r) => r.name?.toLowerCase() === term)
      ?? recipes.find((r) => r.name?.toLowerCase().includes(term));
  }
  return undefined;
}

export function registerGroceryTools(server: McpServer) {
  server.registerTool(
    'add_recipe_ingredients_to_list',
    {
      title: 'Add Recipe Ingredients to List',
      description:
        'Add all ingredients from a single recipe to a shopping list. Defaults to the "Groceries" list. Checks for duplicates: skips items already on the list, unchecks previously checked-off items.',
      inputSchema: z.object({
        recipe_name: z.string().optional().describe('Recipe name (case-insensitive match)'),
        recipe_id: z.string().optional().describe('Recipe identifier'),
        list_name: z.string().default('Groceries').describe('Target list name (defaults to "Groceries")'),
      }),
    },
    async ({ recipe_name, recipe_id, list_name }) => {
      try {
        if (!recipe_name && !recipe_id) {
          return {
            content: [{ type: 'text', text: 'Error: provide either recipe_name or recipe_id' }],
            isError: true,
          };
        }

        const client = AnyListClient.getInstance();
        const recipe = await resolveRecipe(client, recipe_name, recipe_id);
        if (!recipe) {
          return {
            content: [{ type: 'text', text: `Recipe not found: ${recipe_name ?? recipe_id}` }],
            isError: true,
          };
        }

        await client.getLists();
        const list = client.getListByName(list_name);
        if (!list) {
          return {
            content: [{ type: 'text', text: `List not found: "${list_name}"` }],
            isError: true,
          };
        }

        const result = await addRecipeIngredientsToList(client, recipe, list);

        const lines: string[] = [`Ingredients from "${recipe.name}" → "${list_name}":`];
        if (result.added.length) lines.push(`  Added: ${result.added.join(', ')}`);
        if (result.unchecked.length) lines.push(`  Unchecked: ${result.unchecked.join(', ')}`);
        if (result.skipped.length) lines.push(`  Already on list: ${result.skipped.join(', ')}`);

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error adding ingredients: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'add_ingredients_to_list',
    {
      title: 'Batch Add Ingredients to List',
      description:
        'Add ingredients from multiple recipes to a shopping list at once. Defaults to the "Groceries" list. Handles duplicates across recipes: each ingredient is only added once.',
      inputSchema: z.object({
        recipe_names: z.array(z.string()).optional().describe('Array of recipe names'),
        recipe_ids: z.array(z.string()).optional().describe('Array of recipe identifiers'),
        list_name: z.string().default('Groceries').describe('Target list name (defaults to "Groceries")'),
      }),
    },
    async ({ recipe_names, recipe_ids, list_name }) => {
      try {
        if (!recipe_names?.length && !recipe_ids?.length) {
          return {
            content: [{ type: 'text', text: 'Error: provide recipe_names or recipe_ids (non-empty array)' }],
            isError: true,
          };
        }

        const client = AnyListClient.getInstance();
        const allRecipes = await client.getRecipes();
        await client.getLists();
        const list = client.getListByName(list_name);
        if (!list) {
          return {
            content: [{ type: 'text', text: `List not found: "${list_name}"` }],
            isError: true,
          };
        }

        const resolvedRecipes: typeof allRecipes = [];
        const notFound: string[] = [];

        // Resolve by IDs
        if (recipe_ids) {
          for (const id of recipe_ids) {
            const recipe = allRecipes.find((r) => r.identifier === id);
            if (recipe) resolvedRecipes.push(recipe);
            else notFound.push(id);
          }
        }

        // Resolve by names
        if (recipe_names) {
          for (const name of recipe_names) {
            const term = name.toLowerCase();
            const recipe = allRecipes.find((r) => r.name?.toLowerCase() === term)
              ?? allRecipes.find((r) => r.name?.toLowerCase().includes(term));
            if (recipe) resolvedRecipes.push(recipe);
            else notFound.push(name);
          }
        }

        const lines: string[] = [];
        let totalAdded = 0;
        let totalSkipped = 0;
        let totalUnchecked = 0;

        for (const recipe of resolvedRecipes) {
          const result = await addRecipeIngredientsToList(client, recipe, list);
          totalAdded += result.added.length;
          totalSkipped += result.skipped.length;
          totalUnchecked += result.unchecked.length;
          lines.push(`${recipe.name}: +${result.added.length} added, ${result.unchecked.length} unchecked, ${result.skipped.length} skipped`);
        }

        if (notFound.length) {
          lines.push(`\nNot found: ${notFound.join(', ')}`);
        }

        lines.unshift(
          `Batch add to "${list_name}": ${totalAdded} added, ${totalUnchecked} unchecked, ${totalSkipped} already on list`,
        );

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error adding ingredients: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
```

**Step 2: Commit**

```bash
git add src/tools/groceries.ts
git commit -m "feat: add grocery tools for single and batch ingredient adding"
```

---

### Task 7: Server Entry Point

**Files:**
- Create: `src/index.ts`

**Step 1: Implement the MCP server entry point**

```typescript
import { McpServer } from '@modelcontextprotocol/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio.js';
import { registerRecipeTools } from './tools/recipes.js';
import { registerMealPlanTools } from './tools/meal-plan.js';
import { registerListTools } from './tools/lists.js';
import { registerGroceryTools } from './tools/groceries.js';

const server = new McpServer({
  name: 'anylist-mcp',
  version: '1.0.0',
});

registerRecipeTools(server);
registerMealPlanTools(server);
registerListTools(server);
registerGroceryTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add MCP server entry point with all tool registrations"
```

---

### Task 8: Build and Smoke Test

**Step 1: Build the project**

Run:
```bash
npx tsc
```

Expected: Clean compilation, no errors. Fix any type errors that arise.

**Step 2: Verify the server starts**

Run (will fail to connect to AnyList without real credentials, but should load):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | ANYLIST_EMAIL=test@test.com ANYLIST_PASSWORD=test node dist/index.js
```

Expected: The server should respond with an `initialize` result (or at least not crash on startup). The AnyList connection won't happen until a tool is called.

**Step 3: Fix any issues found during smoke test**

Address build errors or runtime issues.

**Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve build and startup issues"
```

---

### Task 9: Claude Desktop Configuration

**Step 1: Create a sample Claude Desktop MCP config snippet**

Create file `claude-desktop-config.json` showing the user how to add this server:

```json
{
  "mcpServers": {
    "anylist": {
      "command": "node",
      "args": ["/path/to/anylist-mcp/dist/index.js"],
      "env": {
        "ANYLIST_EMAIL": "your-email@example.com",
        "ANYLIST_PASSWORD": "your-password"
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add claude-desktop-config.json
git commit -m "docs: add Claude Desktop MCP server configuration example"
```

---

### Task 10: End-to-End Testing with Real Credentials

**Step 1: Set real credentials and test each tool**

Run the server with real credentials and test each tool via JSON-RPC. This is a manual verification step — test each tool one at a time via stdin and verify the responses make sense with real data.

Tools to test in order:
1. `get_lists` — verify list names come back
2. `get_list_items` with list_name "Groceries" — verify items
3. `get_recipes` — verify recipe summaries
4. `get_recipe_details` with a known recipe name — verify ingredients/steps
5. `get_meal_plan` — verify current week events
6. `get_meal_plan` with 6-week lookback — verify date filtering
7. `add_item_to_list` — add a test item, verify in AnyList app, then remove manually
8. `add_meal_plan_event` — add a test event, verify in app, then remove manually
9. `add_recipe_ingredients_to_list` — test with a recipe, verify items appear

**Step 2: Fix any issues found**

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: address issues found during e2e testing"
```
