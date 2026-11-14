import { z } from 'zod';

export const MAX_MCP_INPUT_BYTES = 1024 * 1024;
export const MAX_RECIPE_SELECTORS = 100;
export const MAX_INPUT_TEXT_LENGTH = 4096;

// A plain .max() may run after element validation. Refuse the outer length
// first, before creating an error for every invalid element (b4926).
export const recipeSelectors = z.preprocess((value, context) => {
  if (Array.isArray(value) && value.length > MAX_RECIPE_SELECTORS) {
    context.addIssue({ code: 'custom', message: `At most ${MAX_RECIPE_SELECTORS} entries per recipe array; split the batch` });
    return z.NEVER;
  }
  return value;
}, z.array(z.string().max(MAX_INPUT_TEXT_LENGTH)).max(MAX_RECIPE_SELECTORS));
