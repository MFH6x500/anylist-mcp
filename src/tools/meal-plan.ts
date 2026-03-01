import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
