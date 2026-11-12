// SYNTHETIC FIXTURE. Not a real Data Center or Cloud migration. Every defect below is planted by hand.
const owner = 'john@example.com';

/** @type {import('../src/engine.js').World} */
export const source = {
  entities: {
    project: [{ id: '10100', key: 'BIL', name: 'Billing' }, { id: '10200', key: 'PLT', name: 'Platform' }],
    status: [{ id: '3', name: 'Done' }, { id: '10001', name: 'In Review' }],
    field: [{ id: 'customfield_10016', name: 'Story Points' }, { id: 'customfield_10042', name: 'Team' }],
    user: [{ id: 'jsmith', name: 'John Smith', email: owner }],
  },
  filters: [
    { id: '1', ownerEmail: owner, name: 'Billing open', jql: 'project = 10100 AND status = 3' },
    { id: '2', ownerEmail: owner, name: 'Team work', jql: 'cf[10042] = "Apollo" AND assignee = jsmith' },
    { id: '3', ownerEmail: owner, name: 'Needs review', jql: 'status = "In Review"' },
    { id: '4', ownerEmail: owner, name: 'Points', jql: '"Story Points" > 5' },
    { id: '5', ownerEmail: owner, name: 'Combined', jql: 'filter = "Legacy bugs" AND project = BIL' },
    { id: '6', ownerEmail: owner, name: 'Legacy bugs', jql: 'project = 10200' },
  ],
};

/** Cloud state after a JCMA run that left every query as written. Project 10100 now belongs to Platform. */
/** @type {import('../src/engine.js').World} */
export const cloud = {
  entities: {
    project: [{ id: '10300', key: 'BIL', name: 'Billing' }, { id: '10100', key: 'PLT', name: 'Platform' }],
    status: [{ id: '10002', name: 'Done' }],
    field: [{ id: 'customfield_10020', name: 'Story point estimate' }, { id: 'customfield_10055', name: 'Team' }],
    user: [{ id: '557058:f58131cb', name: 'John Smith', email: owner }],
  },
  filters: [
    { id: '20001', ownerEmail: owner, name: 'Billing open', jql: 'project = 10100 AND status = 3' },
    { id: '20002', ownerEmail: owner, name: 'Team work', jql: 'cf[10042] = "Apollo" AND assignee = jsmith' },
    { id: '20003', ownerEmail: owner, name: 'Needs review', jql: 'status = "In Review"' },
    { id: '20004', ownerEmail: owner, name: 'Points', jql: '"Story Points" > 5' },
    { id: '20005', ownerEmail: owner, name: 'Combined', jql: 'filter = "Legacy bugs" AND project = BIL' },
  ],
};
