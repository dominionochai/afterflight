const LABELS = { issuetype: 'issue type', field: 'custom field', version: 'version', component: 'component' };
const label = (type) => LABELS[type] ?? type;

/**
 * One plain sentence for a finding, or undefined when there is nothing to tell the admin.
 * @param {import('./engine.js').Finding} f
 */
export function explain(f) {
  const what = `${label(f.type)} "${f.was}"`;
  switch (f.status) {
    case 'wrong-entity':
      return `${what} is still valid in Cloud but now means "${f.resolvesNowTo}". In Data Center it meant "${f.meant}", so this query would silently return the wrong results. Proposed: "${f.targetName}".`;
    case 'stale':
      return `${what} no longer exists in Cloud. In Data Center it meant "${f.meant}". Proposed: "${f.targetName}".`;
    case 'missing':
      return `The ${label(f.type)} "${f.meant}" has no counterpart in Cloud${f.mappedCloudId ? ` (the ID Mapping Report points at ${f.mappedCloudId}, which does not exist)` : ''}.${f.resolvesNowTo ? ` The reference still resolves to "${f.resolvesNowTo}", so the query may silently match the wrong thing.` : ''} Repair this by hand.`;
    case 'ambiguous':
      return `The ${label(f.type)} "${f.meant}" matches more than one Cloud entity by name. Add the ID Mapping Report or repair this by hand.`;
    case 'structure-changed':
      return 'JCMA changed the shape of this query, so its references cannot be paired with the original. Review it by hand.';
    default:
      return undefined;
  }
}

/** A sentence for a query part that is not analysed. @param {string} construct */
export function explainUnanalysed(construct) {
  return construct.startsWith('an unterminated')
    ? 'The query has an unterminated quoted string, so its references may be misread and none were repaired. Check it by hand.'
    : `The query uses ${construct}, which Afterflight does not analyse, so references inside it were not checked or repaired. Check it by hand.`;
}
