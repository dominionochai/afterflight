/** @typedef {'project'|'status'|'issuetype'|'priority'|'user'|'version'|'component'|'filter'|'field'} EntityType */
/** @typedef {{ type: EntityType, literal: string, start: number, end: number }} Reference */
/** @typedef {{ kind: 'cf'|'str'|'op'|'punct'|'word', text: string, start: number, end: number }} Token */

const ENTITY_FIELDS = {
  project: 'project', status: 'status', issuetype: 'issuetype', type: 'issuetype', priority: 'priority',
  assignee: 'user', reporter: 'user', creator: 'user',
  fixversion: 'version', affectedversion: 'version', component: 'component', filter: 'filter',
};

const TOKEN = /(cf\[\d+\])|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(!=|!~|<=|>=|[=<>~])|([(),])|([^\s=!<>~(),"']+)/g;

const KEYWORDS = new Set(['and', 'or', 'not', 'is', 'in', 'by', 'order', 'was', 'changed', 'from', 'to', 'after', 'before', 'on', 'during']);
const word = (token) => (token?.kind === 'word' ? token.text.toLowerCase() : '');

const isPunct = (token, char) => token?.kind === 'punct' && token.text === char;

/** @param {string} jql @returns {Token[]} */
function tokenize(jql) {
  return [...jql.matchAll(TOKEN)].map((m) => ({
    kind: m[1] ? 'cf' : m[2] !== undefined || m[3] !== undefined ? 'str' : m[4] ? 'op' : m[5] ? 'punct' : 'word',
    text: m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/** Index of the first value token after an operator at `i`, or -1 when `i` is not an operator. */
function afterOperator(tokens, i) {
  const t = tokens[i];
  if (!t) return -1;
  if (t.kind === 'op') return i + 1;
  const word = t.kind === 'word' ? t.text.toLowerCase() : '';
  if (word === 'in') return i + 1;
  if (word === 'is') return tokens[i + 1]?.text.toLowerCase() === 'not' ? i + 2 : i + 1;
  if (word === 'not' && tokens[i + 1]?.text.toLowerCase() === 'in') return i + 2;
  return -1;
}

function skipCall(tokens, open) {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (isPunct(tokens[i], '(')) depth++;
    if (isPunct(tokens[i], ')') && --depth === 0) return i + 1;
  }
  return tokens.length;
}

/** The value tokens at `at` (one value or a parenthesised list, functions skipped) and the index just past them. */
function valueTokens(tokens, at) {
  const isList = isPunct(tokens[at], '(');
  const out = [];
  let i = isList ? at + 1 : at;
  while (i < tokens.length && !isPunct(tokens[i], ')')) {
    if (isPunct(tokens[i + 1], '(')) i = skipCall(tokens, i + 1);
    else {
      if (tokens[i].kind !== 'punct') out.push(tokens[i]);
      i++;
    }
    if (!isList) break;
  }
  return { tokens: out, end: isList && isPunct(tokens[i], ')') ? i + 1 : i };
}

/** A date or function value of a history predicate (after, before, on, during) is skipped, not read as an entity. */
function skipValue(tokens, at) {
  if (isPunct(tokens[at], '(')) return skipCall(tokens, at);
  return isPunct(tokens[at + 1], '(') ? skipCall(tokens, at + 1) : at + 1;
}

/**
 * Entity values of `field was [not] [in] x [by u]` and `field changed [from x] [to y] [by u]`. The by-clause names
 * users whatever the field is; from, to and was values are of the field's own type.
 */
function historyRefs(tokens, i, type) {
  const refs = [];
  const take = (at, refType) => {
    const { tokens: values, end } = valueTokens(tokens, at);
    if (refType) values.forEach((token) => refs.push({ type: refType, token }));
    return end;
  };
  let j = i + 2;
  if (word(tokens[i + 1]) === 'was') {
    if (word(tokens[j]) === 'not') j++;
    if (word(tokens[j]) === 'in') j++;
    j = take(j, type);
  }
  for (;;) {
    const w = word(tokens[j]);
    if (w === 'from' || w === 'to') j = take(j + 1, type);
    else if (w === 'by') j = take(j + 1, 'user');
    else if (w === 'after' || w === 'before' || w === 'on' || w === 'during') j = skipValue(tokens, j + 1);
    else return refs;
  }
}

/**
 * Every entity a JQL string points at, in document order. A custom field is itself a reference;
 * for entity-valued system fields (project, status, assignee...) each value is.
 * @param {string} jql
 * @returns {Reference[]}
 */
export function extractReferences(jql) {
  const tokens = tokenize(jql);
  const refs = [];
  tokens.forEach((field, i) => {
    if (field.kind === 'op' || field.kind === 'punct') return;
    if (field.kind === 'word' && KEYWORDS.has(field.text.toLowerCase())) return;
    const history = word(tokens[i + 1]) === 'was' || word(tokens[i + 1]) === 'changed';
    const valuesAt = history ? -1 : afterOperator(tokens, i + 1);
    if (!history && valuesAt < 0) return;
    const type = field.kind === 'cf' ? undefined : ENTITY_FIELDS[field.text.toLowerCase()];
    if (!type) refs.push({ type: 'field', literal: field.text, start: field.start, end: field.end });
    const values = history
      ? historyRefs(tokens, i, type)
      : type ? valueTokens(tokens, valuesAt).tokens.map((token) => ({ type, token })) : [];
    for (const { type: valueType, token } of values) refs.push({ type: valueType, literal: token.text, start: token.start, end: token.end });
  });
  return refs;
}

const DATE_FUNCTIONS = /^(now|currentlogin|lastlogin|(startof|endof)(day|week|month|year))$/i;
const QUOTES_BALANCED = /^(?:[^"\\]|\\.|"(?:[^"\\]|\\.)*")*$/s;

/**
 * Parts of a query whose references are not read, so they can neither be checked nor repaired: functions that take
 * arguments (group functions, version functions, app functions that embed JQL) and an unterminated quoted string.
 * @param {string} jql @returns {string[]}
 */
export function unsupportedConstructs(jql) {
  const tokens = tokenize(jql);
  const found = QUOTES_BALANCED.test(jql) ? [] : ['an unterminated quoted string'];
  tokens.forEach((t, i) => {
    if (t.kind !== 'word' || KEYWORDS.has(t.text.toLowerCase()) || !isPunct(tokens[i + 1], '(')) return;
    const end = skipCall(tokens, i + 1);
    if (end - i > 3 && !DATE_FUNCTIONS.test(t.text)) found.push(jql.slice(t.start, tokens[end - 1].end));
  });
  return [...new Set(found)];
}

/** @param {string} jql @param {{ start: number, end: number, text: string }[]} edits */
export function rewrite(jql, edits) {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((out, e) => out.slice(0, e.start) + e.text + out.slice(e.end), jql);
}
