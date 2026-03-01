import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AnyListClient } from '../anylist-client.js';

async function addRecipeIngredientsToList(
  client: AnyListClient,
  recipe: { name: string; ingredients: Array<{ name: string; rawIngredient: string; quantity: string }> },
  list: { getItemByName(name: string): { checked: boolean; save(): Promise<void> } | undefined; addItem(item: any): Promise<any> },
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
