import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerRecipeTools } from './tools/recipes.js';
import { registerMealPlanTools } from './tools/meal-plan.js';
import { registerListTools } from './tools/lists.js';
import { registerGroceryTools } from './tools/groceries.js';

async function main() {
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
}

main().catch(console.error);
