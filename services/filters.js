/**
 * Unified filtering shared by the pagination endpoints, the exports and the
 * external API.
 *
 * Query parameters understood for a dataset spec:
 *   search=<text>                    case-insensitive "contains" over spec.searchFields
 *   filter[<field>]=<value>          equals (case-insensitive for text, exact for numbers/booleans)
 *   filter[<field>]=a,b,c            any of (comma separated)
 *   filter[<field>][like]=<text>     case-insensitive "contains"
 *   filter[<field>][from]=<value>    >= (numbers, dates)
 *   filter[<field>][to]=<value>      <= (numbers, dates)
 *   filter[<field>][ne]=<value>      not equal
 *   filter[<field>][empty]=1         missing / empty value ([empty]=0: present and not blank)
 * Only the fields listed in spec.filterable (map: client name -> database
 * path, with an optional type: 'text' | 'number' | 'boolean' | 'date') are
 * accepted; unknown fields are ignored. User input is regex-escaped.
 * A spec may carry a fixed `baseFilter` (e.g. "not decommissioned") that is
 * always and-ed in, whatever the request asks for.
 */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFilterable(filterable) {
  const out = {};
  for (const [name, def] of Object.entries(filterable || {})) {
    out[name] = typeof def === 'string' ? { path: def, type: 'text' } : { type: 'text', ...def };
  }
  return out;
}

function castValue(type, raw) {
  const text = String(raw).trim();
  if (type === 'number') {
    const number = Number(text);
    return Number.isFinite(number) ? number : undefined;
  }
  if (type === 'boolean') {
    if (['true', '1', 'yes', 'on'].includes(text.toLowerCase())) return true;
    if (['false', '0', 'no', 'off'].includes(text.toLowerCase())) return false;
    return undefined;
  }
  if (type === 'date') {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return text;
}

function equalsCondition(type, raw) {
  const value = castValue(type, raw);
  if (value === undefined) return undefined;
  return type === 'text' ? new RegExp('^' + escapeRegExp(value) + '$', 'i') : value;
}

/** conditions for one field from a string or an operator object */
function fieldConditions(def, spec) {
  const conditions = [];
  if (spec === null || spec === undefined) return conditions;
  if (typeof spec !== 'object') {
    const text = String(spec).trim();
    if (text === '') return conditions;
    const parts = text
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      const values = parts
        .map((part) => equalsCondition(def.type, part))
        .filter((v) => v !== undefined);
      if (values.length) conditions.push({ [def.path]: { $in: values } });
    } else {
      const value = equalsCondition(def.type, text);
      if (value !== undefined) conditions.push({ [def.path]: value });
    }
    return conditions;
  }
  for (const [operator, raw] of Object.entries(spec)) {
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    switch (operator) {
      case 'like':
        conditions.push({ [def.path]: new RegExp(escapeRegExp(String(raw).trim()), 'i') });
        break;
      case 'from': {
        const value = castValue(def.type === 'text' ? 'text' : def.type, raw);
        if (value !== undefined) conditions.push({ [def.path]: { $gte: value } });
        break;
      }
      case 'to': {
        const value = castValue(def.type === 'text' ? 'text' : def.type, raw);
        if (value !== undefined) conditions.push({ [def.path]: { $lte: value } });
        break;
      }
      case 'ne': {
        const value = equalsCondition(def.type, raw);
        if (value !== undefined)
          conditions.push({
            [def.path]: { $not: value instanceof RegExp ? value : { $eq: value } },
          });
        break;
      }
      case 'empty': {
        const wantEmpty = castValue('boolean', raw);
        if (wantEmpty === true) {
          conditions.push({
            $or: [{ [def.path]: { $exists: false } }, { [def.path]: null }, { [def.path]: '' }],
          });
        } else if (wantEmpty === false) {
          // [empty]=0 -> present and not blank
          conditions.push({ [def.path]: { $nin: [null, ''] } }); // null also matches a missing field
        }
        break;
      }
      case 'in': {
        const values = String(raw)
          .split(',')
          .map((part) => equalsCondition(def.type, part))
          .filter((v) => v !== undefined);
        if (values.length) conditions.push({ [def.path]: { $in: values } });
        break;
      }
      default:
        break;
    }
  }
  return conditions;
}

/** Mongo filter for a dataset spec from request.query ({ search, filter }) */
function buildFilter(spec, query = {}) {
  const conditions = [];
  if (spec.baseFilter && Object.keys(spec.baseFilter).length) {
    conditions.push({ ...spec.baseFilter });
  }
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search && spec.searchFields && spec.searchFields.length) {
    const pattern = new RegExp(escapeRegExp(search), 'i');
    conditions.push({ $or: spec.searchFields.map((field) => ({ [field]: pattern })) });
  }
  const filterable = normalizeFilterable(spec.filterable);
  const requested = query.filter && typeof query.filter === 'object' ? query.filter : {};
  for (const [name, value] of Object.entries(requested)) {
    const def = filterable[name];
    if (!def) continue;
    conditions.push(...fieldConditions(def, value));
  }
  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

/** the criteria actually applied (for reporting back to the user) */
function describeCriteria(spec, query = {}) {
  const applied = [];
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) applied.push('search ~ "' + search + '"');
  const filterable = normalizeFilterable(spec.filterable);
  const requested = query.filter && typeof query.filter === 'object' ? query.filter : {};
  for (const [name, value] of Object.entries(requested)) {
    if (!filterable[name]) continue;
    if (typeof value === 'object' && value !== null) {
      for (const [operator, raw] of Object.entries(value)) {
        if (raw !== undefined && String(raw).trim() !== '')
          applied.push(name + ' ' + operator + ' ' + raw);
      }
    } else if (value !== undefined && String(value).trim() !== '') {
      applied.push(name + ' = ' + value);
    }
  }
  return applied;
}

module.exports = { buildFilter, describeCriteria, escapeRegExp, castValue };
