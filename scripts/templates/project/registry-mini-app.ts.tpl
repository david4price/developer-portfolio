import type { MiniAppInput } from '../schema.js';

/** Set `status` to 'available' once the app really works (its page then drops the badge). */
export const __camel__MiniApp: MiniAppInput = {
  slug: '__slug__',
  title: __titleJson__,
  summary: __summaryJson__,
  status: 'planned',
};
