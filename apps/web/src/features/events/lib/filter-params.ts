import { ListEventsInput } from "@minitickets/shared";

// The events filters live in the URL: /events?venue=Pune&from=2026-11-01&to=2026-11-30.
// WHY THE URL (and not React state):
// - shareable: copy the address, send it, and the other person sees the same filtered list;
// - reload / back / forward keep the filters, because the browser keeps the address;
// - the SERVER can read them (the page's searchParams), so it renders the filtered list into the
//   first HTML, exactly like the unfiltered one.
// These small functions are used by both the server page and the filter form, so both read and
// write the URL the same way.

// The filter values as TEXT: what the inputs hold and what the URL carries. "" = not set.
export type FilterValues = { venue: string; from: string; to: string };
export type FilterErrors = Partial<Record<keyof FilterValues, string>>;

// Top to bottom on screen; focus goes to the first invalid field in this order.
export const filterFields = ["venue", "from", "to"] as const;

export const noFilters: FilterValues = { venue: "", from: "", to: "" };

// 1. Read the filters from the page's search params. Next gives each one as a string, as an array
//    (when the URL repeats it: ?venue=a&venue=b; we take the first) or undefined (missing).
export function readFilterParams(params: Record<string, string | string[] | undefined>): FilterValues {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  return { venue: first(params.venue), from: first(params.from), to: first(params.to) };
}

// 2. Check the values with the SHARED schema (the API runs it again). Empty fields are left out,
//    so "" means "no filter" and never "a date that is not valid".
//    Returns the input for events.list, or the first message per field.
export function parseFilters(
  values: FilterValues,
): { success: true; input: ListEventsInput } | { success: false; errors: FilterErrors } {
  const result = ListEventsInput.safeParse(withoutEmpty(values));
  if (result.success) return { success: true, input: result.data };

  const errors: FilterErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof FilterValues;
    if (!errors[field]) errors[field] = issue.message;
  }
  return { success: false, errors };
}

// 3. The address for these filters, with empty fields left out (and the venue trimmed), so the
//    URL stays short and clean: "/events?venue=Pune&from=2026-11-01", or just "/events".
export function filtersHref(values: FilterValues): string {
  const query = new URLSearchParams(withoutEmpty(values)).toString();
  return query ? `/events?${query}` : "/events";
}

// 4. Is any filter set? (Shows the "Clear filters" link and the "nothing matches" text.)
export function hasFilters(values: FilterValues): boolean {
  return Object.keys(withoutEmpty(values)).length > 0;
}

// Only the fields that have a value (after trimming), in the fixed order above.
function withoutEmpty(values: FilterValues): Partial<FilterValues> {
  const result: Partial<FilterValues> = {};
  for (const field of filterFields) {
    const value = values[field].trim();
    if (value) result[field] = value;
  }
  return result;
}
