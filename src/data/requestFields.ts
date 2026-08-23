/**
 * The field catalogue, shared with the backend rather than mirrored.
 *
 * The definitions live in the Supabase function directory because that is where they are
 * used to build the schema Claude is constrained to. That file imports nothing, so the
 * browser build can take it directly — which matters more than tidiness here: a copy
 * would drift, and a drifted catalogue means the CRM renders a field the extractor no
 * longer populates, or silently hides one it does.
 */
export * from "../../supabase/functions/_shared/requestFields";
