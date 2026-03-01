# AnyList MCP Server Design

## Overview

An MCP server that wraps the unofficial [AnyList API](https://github.com/kevdliu/anylist) to give Claude access to meal plans, recipes, and shopping lists. The primary workflow: review past meal plans and recipes, recommend meals for the week, schedule them, and add ingredients to the "Groceries" list.

## Decisions

- **Location:** `/Users/david/code/anylist-mcp`
- **Runtime:** TypeScript on Node.js
- **Auth:** Environment variables (`ANYLIST_EMAIL`, `ANYLIST_PASSWORD`)
- **Transport:** stdio (standard for Claude Desktop)
- **Connection:** Lazy connect on first tool call, auto-reconnect on session expiry
- **Recommendations:** Data-only tools; Claude reasons about suggestions using recipe + meal history data

## Tools

### Reading

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_meal_plan` | Get meal plan events for a date range | `start_date?`, `end_date?` (defaults to current week) |
| `get_recipes` | List all saved recipes (name, rating, times, servings) | `search?` (optional text filter) |
| `get_recipe_details` | Full recipe with ingredients and preparation steps | `recipe_name` or `recipe_id` |
| `get_lists` | List all shopping lists | none |
| `get_list_items` | Get items on a specific list | `list_name` |

### Writing

| Tool | Description | Parameters |
|------|-------------|------------|
| `add_meal_plan_event` | Schedule a recipe on a specific day | `recipe_name` or `recipe_id`, `date`, `label?` |
| `add_recipe_ingredients_to_list` | Add one recipe's ingredients to a list | `recipe_name` or `recipe_id`, `list_name?` (default: "Groceries") |
| `add_ingredients_to_list` | Batch add ingredients from multiple recipes | `recipe_names` or `recipe_ids` (array), `list_name?` (default: "Groceries") |
| `add_item_to_list` | Add a freeform item to a list | `item_name`, `list_name`, `quantity?` |

## Architecture

```
anylist-mcp/
├── src/
│   ├── index.ts          # MCP server entry point, tool registration
│   ├── anylist-client.ts  # Lazy connection wrapper around anylist library
│   └── tools/
│       ├── meal-plan.ts   # get_meal_plan, add_meal_plan_event
│       ├── recipes.ts     # get_recipes, get_recipe_details
│       ├── lists.ts       # get_lists, get_list_items, add_item_to_list
│       └── groceries.ts   # add_recipe_ingredients_to_list, add_ingredients_to_list
├── package.json
├── tsconfig.json
└── .env.example
```

### anylist-client.ts

Singleton wrapper around the `anylist` npm package:
- Lazy login: connects on first tool call, not at server startup
- Auto-reconnect: if a call fails due to session expiry, re-login and retry once
- Exposes typed methods that tool handlers call

### Tool modules

Each file exports:
- Tool definitions (name, description, JSON Schema for input)
- Handler functions that use the client singleton

### index.ts

- Creates the MCP server via `@modelcontextprotocol/sdk`
- Registers all tools from tool modules
- Reads `ANYLIST_EMAIL` and `ANYLIST_PASSWORD` from environment
- Starts stdio transport

## Key Behaviors

### Recommended meal planning workflow

1. Call `get_meal_plan` with ~6-week lookback to see recent eating patterns
2. Call `get_recipes` to see the full recipe library
3. Use history to understand current preferences and avoid repeating meals too soon
4. Recommend meals balancing variety with recent favorites
5. On approval, call `add_meal_plan_event` for each day
6. Call `add_ingredients_to_list` with all recipe names targeting "Groceries"

Tool descriptions will encode this workflow so Claude naturally follows it.

### Duplicate ingredient handling

When adding items to a list:
1. Check `list.getItemByName()` for existing items
2. If found and checked off → uncheck it (marks it active again)
3. If found and unchecked → skip it (already on the list)
4. If not found → create and add new item

### Error handling

Tools return structured error messages (not exceptions) so Claude gets useful context on failures (e.g., "Recipe 'Tacos' not found" rather than a stack trace).

## Dependencies

- `anylist` - Unofficial AnyList API wrapper
- `@modelcontextprotocol/sdk` - MCP server SDK
- `typescript`, `tsx` - Build and development
