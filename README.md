# AnyList MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that connects AI assistants to [AnyList](https://www.anylist.com/) — giving them access to your shopping lists, recipes, and meal plans.

## Features

- **Shopping Lists** — View lists, check items, add freeform items or recipe ingredients
- **Recipes** — Search and retrieve full recipe details including ingredients and steps
- **Meal Planning** — View and schedule meals on your AnyList calendar
- **Grocery Helpers** — Add ingredients from one or multiple recipes to a list with duplicate handling

## Prerequisites

- Node.js >= 18
- An AnyList account (email/password)
- A local copy of the [anylist](https://github.com/codetheweb/anylist) API wrapper (see [Setup](#setup))

## Setup

1. Clone this repository and the anylist API wrapper side by side:

   ```
   git clone <this-repo> anylist-mcp
   git clone https://github.com/codetheweb/anylist anylist
   ```

2. Install dependencies in both:

   ```
   cd anylist && npm install && cd ..
   cd anylist-mcp && npm install
   ```

3. Build:

   ```
   npm run build
   ```

## Configuration

The server requires your AnyList credentials as environment variables:

| Variable | Description |
|---|---|
| `ANYLIST_EMAIL` | Your AnyList account email |
| `ANYLIST_PASSWORD` | Your AnyList account password |

### Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

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

### Other MCP Clients

Run the server via stdio transport:

```
ANYLIST_EMAIL=you@example.com ANYLIST_PASSWORD=secret node dist/index.js
```

Or for development:

```
ANYLIST_EMAIL=you@example.com ANYLIST_PASSWORD=secret npm run dev
```

## Tools

### Lists

| Tool | Description |
|---|---|
| `get_lists` | List all shopping lists with item counts |
| `get_list_items` | Get all items on a specific list |
| `add_item_to_list` | Add a freeform item to a list (with duplicate checking) |
| `add_ingredient_to_list` | Add a recipe ingredient to a list with proper categorization |

### Recipes

| Tool | Description |
|---|---|
| `get_recipes` | List all recipes, optionally filtered by name |
| `get_recipe_details` | Get full recipe details including ingredients and steps |

### Groceries

| Tool | Description |
|---|---|
| `add_recipe_ingredients_to_list` | Add all ingredients from a recipe to a list |
| `add_ingredients_to_list` | Batch add ingredients from multiple recipes to a list |

### Meal Planning

| Tool | Description |
|---|---|
| `get_meal_plan` | Get meal plan events for a date range (defaults to current week) |
| `add_meal_plan_event` | Schedule a recipe or event on a specific day |

## Tool Details

### `add_item_to_list`

Add a freeform item to a shopping list. If the item already exists and is checked off, it will be unchecked instead of duplicated.

- `item_name` (required) — Name of the item
- `list_name` (required) — Target list name
- `quantity` (optional) — e.g. "2 lbs", "3"

### `add_ingredient_to_list`

Add a specific ingredient from a recipe to a shopping list. Uses AnyList's ingredient handler for proper categorization, and matches against existing or recently used items.

- `recipe_name` or `recipe_id` (one required) — The recipe to pull from
- `ingredient_name` (required) — Ingredient name (case-insensitive, partial match)
- `list_name` (optional, default: "Groceries") — Target list

### `add_recipe_ingredients_to_list`

Add all ingredients from a single recipe to a list. Handles duplicates: skips items already present, unchecks previously checked-off items.

- `recipe_name` or `recipe_id` (one required)
- `list_name` (optional, default: "Groceries")

### `add_ingredients_to_list`

Batch version — add ingredients from multiple recipes at once. Deduplicates across recipes.

- `recipe_names` or `recipe_ids` (one required, array)
- `list_name` (optional, default: "Groceries")

### `get_recipe_details`

Get full recipe details including ingredients (with name, quantity, and notes) and preparation steps.

- `recipe_name` or `recipe_id` (one required)

### `add_meal_plan_event`

Schedule a recipe or titled event on the meal plan calendar.

- `date` (required) — YYYY-MM-DD format
- `recipe_name` or `recipe_id` (optional) — Recipe to schedule
- `title` (optional) — Event title (used if no recipe, or as override)
- `label` (optional) — e.g. "Breakfast", "Lunch", "Dinner"

## License

ISC
