# AnyList MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that connects AI assistants to [AnyList](https://www.anylist.com/) — giving them access to your shopping lists, recipes, and meal plans.

## Features

- **Shopping Lists** — View lists and item categories, assign categories, add freeform items or recipe ingredients
- **Recipes** — Search and retrieve full recipe details including ingredients and steps
- **Meal Planning** — View and schedule meals on your AnyList calendar
- **Grocery Helpers** — Add ingredients from one or multiple recipes to a list with duplicate handling

## Prerequisites

- Node.js >= 18
- An AnyList account (email/password)

## Setup

1. Clone this repository:

   ```
   git clone <this-repo> anylist-mcp
   cd anylist-mcp
   ```

2. Install dependencies:

   ```
   npm install
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
| `get_list_items` | Get all items on a specific list, including categoryMatchId and categoryName |
| `get_categories` | Get account category names and match IDs, including custom categories |
| `set_item_category` | Assign an existing item to a category with fresh-read verification, or return it to Other |
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

### `get_categories` and `set_item_category`

Call `get_categories` to discover category names and `categoryMatchId` values.
The category record's `id` is different from the match ID used to assign items.
Names and match IDs come from the account, including its custom categories;
the server does not guess aisle IDs from names.

To categorise an item, call `set_item_category` with:

- `list_name` (required): exact shopping list name.
- `item_id` (required): the item's `id` returned by `get_list_items`.
- Exactly one of `category_name` (exact name, ignoring case and surrounding
  whitespace) or `category_match_id` (a `categoryMatchId` from `get_categories`).

Example: `{"list_name":"Groceries","item_id":"<item-id>","category_name":"Dairy"}`.
Use the same tool with `category_name: "Other"` to undo an assignment, or choose
another category. Repeating the current assignment does not send another write.
Unknown categories, ambiguous category names and duplicate list names are refused.
The tool changes only the selected item's category; it does not create categories
or categorise other items automatically. Account categories can be hidden or
ordered differently by a list's display settings, which this tool does not change.

`get_list_items` now includes `categoryMatchId` and `categoryName`; an unmapped
match ID remains visible with a null name. Saving errors, ignored writes and failed verification reads are reported as tool
errors. Success after a write requires a fresh server read to return the requested
category. An error after sending a write does not imply that it was rolled back;
a later call refreshes the item before retrying.

Category discovery uses `_getUserData` from the lockfile-pinned `anylist` library,
because that library has no public category reader. Keep the category tests when
upgrading it. `npm test` builds TypeScript and runs the MCP protocol tests with
synthetic protobuf responses and captured HTTP writes. These cover the actual
library's protobuf encoding and multipart request, custom categories, ambiguity,
ignored writes, read-back failures, retries and returning to Other; they never
connect to a real account. The category writer sends the full decoded item in
`listItem` and the match ID in `originalValue`. The pinned library's generic
`Item.save()` puts it in `updatedValue`, which the service ignores. Other item
fields, including per-list category assignments, are preserved; this tool still
changes the account category match ID, not per-list category-group settings.

After landing this branch, build the deployed connector with `npm ci` and
`npm run build`, then restart or reconnect its MCP client to discover the new
tools. Repeat on every machine using a separate connector checkout. Building a
private worktree does not update an already-running server.

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
