/** @typedef {'project'|'status'|'issuetype'|'priority'|'user'|'version'|'component'|'filter'|'field'} EntityType */
/** @typedef {{ type: EntityType, literal: string, start: number, end: number }} Reference */
/** @typedef {{ kind: 'cf'|'str'|'op'|'punct'|'word', text: string, start: number, end: number }} Token */

const ENTITY_FIELDS = {
  project: 'project', status: 'status', issuetype: 'issuetype', type: 'issuetype', priority: 'priority',
  assignee: 'user', reporter: 'user', creator: 'user',
  fixversion: 'version', affectedversion: 'version', component: 'component', filter: 'filter',
};

const TOKEN = /(cf\[\d+\])|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(!=|!~|<=|>=|[=<>~])|([(),])|([^\s=!<>~(),"']+)/g;

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
  if (word === 'in' || word === 'is') return i + 1;
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
  return out;
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
    const valuesAt = afterOperator(tokens, i + 1);
    if (valuesAt < 0) return;
    const type = field.kind === 'cf' ? undefined : ENTITY_FIELDS[field.text.toLowerCase()];
    if (!type) refs.push({ type: 'field', literal: field.text, start: field.start, end: field.end });
    else for (const v of valueTokens(tokens, valuesAt)) refs.push({ type, literal: v.text, start: v.start, end: v.end });
  });
  return refs;
}

/** @param {string} jql @param {{ start: number, end: number, text: string }[]} edits */
export function rewrite(jql, edits) {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((out, e) => out.slice(0, e.start) + e.text + out.slice(e.end), jql);
}
