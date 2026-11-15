/**
 * Entity Type strings for the JCMA ID Mapping Report, taken from Atlassian's published list of mapping namespaces
 * (developer.atlassian.com/platform/app-migration/mappings). The report's own documented examples (jira:issue,
 * jira/classic:project, jira/classic/software:rapidView) match this list. That every row below appears in a given
 * report is UNVERIFIED until a real report is read. Users are absent on purpose: Atlassian keys user mappings by
 * email, username or user key, not by a plain ID column.
 */
export const DEFAULT_ENTITY_TYPES = Object.freeze({
  board: 'jira/classic/software:rapidView',
  component: 'jira:projectComponent',
  field: 'jira/classic:customField',
  filter: 'jira:filter',
  issue: 'jira:issue',
  issuetype: 'jira/classic:issueType',
  priority: 'jira:priority',
  project: 'jira/classic:project',
  status: 'jira/classic:issueStatus',
  version: 'jira:projectVersion',
});
