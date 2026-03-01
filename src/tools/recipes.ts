import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
