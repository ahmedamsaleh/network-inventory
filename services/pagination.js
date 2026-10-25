/**
 * Server-side pagination/search/sort for bootstrap-table ("server" side
 * pagination, queryParamsType "limit"): the client sends
 * ?limit=&offset=&search=&sort=&order= and expects { total, rows }.
 */
const filters = require('./filters');

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 10;

/** Escapes a string so it can be used literally inside a RegExp. */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes the query string parameters.
 * @param {object} query          request.query
 * @param {object} options
 * @param {object} options.sortable   map of client field name -> database path
 * @param {string} options.defaultSort client field name used when `sort` is missing/unknown
 */
function parseQuery(query, { sortable, defaultSort }) {
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  let offset = parseInt(query.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const search = typeof query.search === 'string' ? query.search.trim() : '';

  const sortField = Object.prototype.hasOwnProperty.call(sortable, query.sort)
    ? query.sort
    : defaultSort;
  const direction = String(query.order || '').toLowerCase() === 'desc' ? -1 : 1;
  // _id as a tie breaker keeps pages stable when the sort key has duplicates
  const sort = { [sortable[sortField]]: direction, _id: direction };

  return { limit, offset, search, sort };
}

/** Case-insensitive "contains" filter over several fields (input is escaped). */
function searchFilter(search, fields) {
  if (!search) return {};
  const pattern = new RegExp(escapeRegExp(search), 'i');
  return { $or: fields.map((field) => ({ [field]: pattern })) };
}

/**
 * Runs the paginated query.
 * @returns {Promise<{total: number, rows: object[]}>}
 */
async function paginate(Model, { filter = {}, projection, sort, limit, offset, mapRow }) {
  const [total, docs] = await Promise.all([
    Model.countDocuments(filter),
    Model.find(filter, projection).sort(sort).skip(offset).limit(limit).lean(),
  ]);
  return { total, rows: mapRow ? docs.map(mapRow) : docs };
}

/**
 * Convenience wrapper used by the /pagination routes.
 * @param {object} spec { Model, searchFields, sortable, defaultSort, projection, mapRow }
 */
async function paginatedResponse(query, spec) {
  const { limit, offset, sort } = parseQuery(query, spec);
  return paginate(spec.Model, {
    // search + filter[...] criteria, shared with the exports (services/filters.js)
    filter: filters.buildFilter(spec, query),
    projection: spec.projection,
    sort,
    limit,
    offset,
    mapRow: spec.mapRow,
  });
}

module.exports = {
  MAX_LIMIT,
  DEFAULT_LIMIT,
  escapeRegExp,
  parseQuery,
  searchFilter,
  paginate,
  paginatedResponse,
};
