import mongoose from "mongoose";

// Input guards for the generic /api/entities/:entityName CRUD routes.
//
// Every entity is scoped to its owner with `created_by`. These helpers make sure
// nothing the client sends (query string or body) can widen or rewrite that scope.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Set by the server or Mongo, never by the client.
const PROTECTED_FIELDS = new Set(["_id", "id", "__v", "created_by", "created_date", "updated_date"]);
// Never filterable: would let a caller probe secrets one query at a time.
const HIDDEN_FIELDS = new Set(["password", "refresh_token", "google_id"]);
const RESERVED_QUERY_KEYS = new Set(["sort", "limit", "skip"]);

const DEFAULT_LIMIT = 200;
// The bulk-import dialogs ask for 100000 to load everything for duplicate checks.
const MAX_LIMIT = 100000;

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive exact-match regex for user-supplied text (no regex injection). */
export const exactMatchCI = (s) => new RegExp(`^${escapeRegex(String(s).trim())}$`, "i");

/**
 * Validate a create/update body: it must be a plain object, may not contain Mongo
 * update operators, and silently loses server-controlled fields (clients such as
 * the Settings page legitimately PUT back the whole object they loaded).
 */
export function sanitizeWriteBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  const clean = {};
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith("$")) throw new HttpError(400, `Update operators are not allowed ("${key}")`);
    const root = key.split(".")[0];
    if (PROTECTED_FIELDS.has(root) || HIDDEN_FIELDS.has(root)) continue;
    clean[key] = value;
  }
  return clean;
}

/** Turn ?field=value query params into an exact-match filter over known schema fields. */
export function buildListFilters(Model, query = {}) {
  const filters = {};
  for (const [key, value] of Object.entries(query)) {
    if (RESERVED_QUERY_KEYS.has(key)) continue;
    const field = key === "id" ? "_id" : key;

    if (field === "created_by" || HIDDEN_FIELDS.has(field)) {
      throw new HttpError(400, `Cannot filter by "${key}"`);
    }
    if (field !== "_id" && !Model.schema.path(field)) {
      throw new HttpError(400, `Unknown filter field "${key}"`);
    }
    // Only plain strings: an object or array here is a Mongo operator ({$ne: ...}).
    if (typeof value !== "string" || value.length > 200) {
      throw new HttpError(400, `Invalid value for filter "${key}"`);
    }
    if (field === "_id" && !mongoose.isValidObjectId(value)) {
      throw new HttpError(400, `Invalid value for filter "${key}"`);
    }
    filters[field] = value;
  }
  return filters;
}

/** ?sort=field or ?sort=-field, limited to real schema fields (or an explicit allow-list). */
export function parseSort(Model, sort, allowedFields = null) {
  if (sort === undefined || sort === "") return { created_date: -1 };
  if (typeof sort !== "string") throw new HttpError(400, "Invalid sort");
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  const allowed = allowedFields ? allowedFields.includes(field) : Boolean(Model.schema.path(field));
  if (!allowed) throw new HttpError(400, `Cannot sort by "${field}"`);
  return { [field]: desc ? -1 : 1 };
}

export function parsePagination(query = {}) {
  const toInt = (v, fallback) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    limit: Math.min(MAX_LIMIT, Math.max(1, toInt(query.limit, DEFAULT_LIMIT))),
    skip: Math.max(0, toInt(query.skip, 0)),
  };
}

/** Map an error to a response status: our own HttpError, Mongoose bad-input errors, else the fallback. */
export function statusFor(error, fallback = 500) {
  if (error instanceof HttpError) return error.status;
  if (error?.name === "CastError" || error?.name === "ValidationError") return 400;
  return fallback;
}
