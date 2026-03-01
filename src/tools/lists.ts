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
}
