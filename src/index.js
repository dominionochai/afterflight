import Resolver from '@forge/resolver';
import api, { assumeTrustedRoute } from '@forge/api';
import { runAnalysis, runApply } from './service.js';

const requestJira = (path, init) => api.asUser().requestJira(assumeTrustedRoute(path), init);

const resolver = new Resolver();
resolver.define('analyse', ({ payload }) => runAnalysis({ snapshotText: payload.snapshotText, requestJira }));
resolver.define('apply', ({ payload }) => runApply({ snapshotText: payload.snapshotText, filterIds: payload.filterIds, requestJira }));

export const handler = resolver.getDefinitions();
