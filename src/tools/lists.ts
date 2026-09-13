import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AnyListClient } from '../anylist-client.js';

export function registerListTools(server: McpServer) {
  server.registerTool(
    'get_categories',
    {
      title: 'Get Categories',
      description: 'Get account category names and categoryMatchId values, including custom categories. Use these match IDs with set_item_category; record IDs are different.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const categories = await AnyListClient.getInstance().getCategories();
        return { content: [{ type: 'text', text: JSON.stringify(categories, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching categories: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'set_item_category',
    {
      title: 'Set Item Category',
      description: 'Assign an existing shopping-list item to an account category. Use an item ID from get_list_items and exactly one category selector: an exact name (case-insensitive) or category_match_id from get_categories. Can also move an item back to Other.',
      inputSchema: z.object({
        list_name: z.string().min(1).describe('Exact shopping list name'),
        item_id: z.string().min(1).describe('Item ID from get_list_items'),
        category_name: z.string().trim().min(1).optional().describe('Exact category name, ignoring case'),
        category_match_id: z.string().min(1).optional().describe('categoryMatchId from get_categories, not the category record ID'),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ list_name, item_id, category_name, category_match_id }) => {
      try {
        if ((category_name === undefined) === (category_match_id === undefined)) {
          throw new Error('Provide exactly one of category_name or category_match_id');
        }
        const client = AnyListClient.getInstance();
        // Refresh the item and category metadata together before every mutation,
        // including retries after an uncertain save response.
        const lists = await client.getLists();
        const matchingLists = lists.filter((l) => l.name === list_name);
        if (matchingLists.length !== 1) {
          throw new Error(matchingLists.length ? `Ambiguous list name: "${list_name}"` : `List not found: "${list_name}"`);
        }
        const item = matchingLists[0].getItemById(item_id);
        if (!item) throw new Error(`Item not found on "${list_name}": ${item_id}`);
        const categories = await client.getCategories(false);
        const matches = categories.filter((c) => category_match_id !== undefined
          ? c.categoryMatchId === category_match_id
          : c.name.trim().toLowerCase() === category_name!.toLowerCase());
        const matchIds = new Set(matches.map((c) => c.categoryMatchId));
        if (matchIds.size === 0) throw new Error('Category not found. Use get_categories for available names and match IDs.');
        if (matchIds.size > 1) throw new Error('Ambiguous category name. Use category_match_id from get_categories.');
        const category = matches[0];
        const changed = item.categoryMatchId !== category.categoryMatchId;
        if (changed) {
          item.categoryMatchId = category.categoryMatchId;
          await item.save();
        }
        return { content: [{ type: 'text', text: JSON.stringify({
          itemId: item.identifier, listName: list_name,
          categoryMatchId: category.categoryMatchId, categoryName: category.name, changed,
        }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error setting item category: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

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

        const categories = await client.getCategories(false);
        const result = list.items.map((i) => ({
          id: i.identifier,
          name: i.name,
          quantity: i.quantity ?? null,
          details: i.details ?? null,
          checked: i.checked,
          categoryMatchId: i.categoryMatchId,
          categoryName: categories.find((c) => c.categoryMatchId === i.categoryMatchId)?.name ?? null,
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
