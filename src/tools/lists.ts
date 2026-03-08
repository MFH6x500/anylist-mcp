import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

  server.registerTool(
    'add_ingredient_to_list',
    {
      title: 'Add Ingredient to List',
      description: 'Add a specific ingredient from a recipe to a shopping list. Matches existing items or recent items by name for proper AnyList categorization.',
      inputSchema: z.object({
        recipe_name: z.string().optional().describe('Recipe name (case-insensitive match)'),
        recipe_id: z.string().optional().describe('Recipe identifier'),
        ingredient_name: z.string().describe('Name of the ingredient to add (matched against recipe ingredients)'),
        list_name: z.string().default('Groceries').describe('Target list name (defaults to "Groceries")'),
        event_id: z.string().optional().describe('Meal plan event identifier to link this ingredient to'),
        event_date: z.string().optional().describe('Meal plan event date in YYYY-MM-DD format'),
      }),
    },
    async ({ recipe_name, recipe_id, ingredient_name, list_name, event_id, event_date }) => {
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

        const term = ingredient_name.toLowerCase();
        const ingredient = recipe.ingredients.find((i) => i.name?.toLowerCase() === term)
          ?? recipe.ingredients.find((i) => i.name?.toLowerCase().includes(term))
          ?? recipe.ingredients.find((i) => i.rawIngredient?.toLowerCase().includes(term));

        if (!ingredient) {
          return {
            content: [{ type: 'text', text: `Ingredient "${ingredient_name}" not found in recipe "${recipe.name}"` }],
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

        const ingredientName = ingredient.name || ingredient.rawIngredient;

        await list.addIngredient(ingredient, {
          recipeId: recipe.identifier,
          recipeName: recipe.name,
          eventId: event_id,
          eventDate: event_date,
        });

        return {
          content: [{ type: 'text', text: `Added ingredient "${ingredientName}"${ingredient.quantity ? ` (${ingredient.quantity})` : ''} from "${recipe.name}" to "${list_name}"` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error adding ingredient: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
