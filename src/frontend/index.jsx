import React, { useState } from 'react';
import ForgeReconciler, {
  Button, Checkbox, CodeBlock, DynamicTable, Heading, Lozenge, SectionMessage, Stack, Tab, TabList, TabPanel, Tabs, Text, TextArea, Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { DEFAULT_ENTITY_TYPES } from '../entity-types.js';

const TYPE_KEYS = Object.keys(DEFAULT_ENTITY_TYPES);
const head = (labels) => ({ cells: labels.map((content) => ({ key: content, content })) });
const FILTER_HEAD = head(['Apply', 'Filter', 'Original', 'Proposed', 'Used by boards', 'Used by plans', 'Atlassian check', 'Why']);
const RESULT_HEAD = head(['Filter', 'Data Center', 'Cloud as migrated', 'Cloud after repair']);
const QUERY_HEAD = head(['Board', 'Kind', 'Name', 'JQL', 'Problems']);
const BOARD_HEAD = head(['Board', 'Status', 'Config findings', 'Missing issues', 'Unexpected issues', 'Notes']);

const describeOpen = (open) => open.map((o) => `${o.type} "${o.was}" ${o.status}${o.meant ? ` (meant ${o.meant})` : ''}`).join('; ');

function boardRow(b) {
  if (b.status !== 'compared') {
    return [b.name, <Lozenge appearance="danger">{b.status}</Lozenge>, '', '', '', 'No ID mapping entry for this board'];
  }
  const clean = b.configFindings.length === 0 && b.issues.missing.length === 0;
  const notes = [b.sourceTruncated && 'DC export truncated', !b.issues.complete && 'some issues unmapped'].filter(Boolean).join('; ');
  return [
    b.name,
    <Lozenge appearance={clean ? 'success' : 'warning'}>{clean ? 'matches' : 'differs'}</Lozenge>,
    b.configFindings.map((f) => `${f.area}: ${f.detail}`).join('; '),
    b.issues.missing.map((m) => `${m.sourceId} (${m.reason})`).join(', '),
    b.issues.unexpected.join(', '),
    notes,
  ];
}

const App = () => {
  const [snapshotText, setSnapshotText] = useState('');
  const [idMappingCsv, setIdMappingCsv] = useState('');
  const [types, setTypes] = useState({});
  const [analysis, setAnalysis] = useState();
  const [picked, setPicked] = useState([]);
  const [outcome, setOutcome] = useState();
  const [rollback, setRollback] = useState();
  const [boards, setBoards] = useState();
  const [parity, setParity] = useState();
  const [queries, setQueries] = useState();
  const [report, setReport] = useState();
  const [error, setError] = useState();

  const overrides = Object.fromEntries(Object.entries(types).filter(([, v]) => v));
  const filterPayload = { snapshotText, ...(idMappingCsv ? { idMappingCsv, types: overrides } : {}) };
  const boardPayload = { snapshotText, idMappingCsv, types: overrides };

  const call = async (action, payload, onResult) => {
    setError();
    try {
      onResult(await invoke(action, payload));
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  };
  const analyse = () => call('analyse', filterPayload, (result) => {
    setAnalysis(result);
    setPicked(result.filters.filter((f) => f.canRepair).map((f) => f.filterId));
    setOutcome();
    setRollback();
  });
  const apply = () => call('apply', { ...filterPayload, filterIds: picked }, (result) => { setOutcome(result); setRollback(); });
  const undo = () => call('rollback', { runId: outcome.runId }, setRollback);
  const compareBoards = () => call('boardParity', boardPayload, setBoards);
  const compareResultSets = () => call('resultParity', filterPayload, setParity);
  const checkQueries = () => call('boardQueries', {}, setQueries);
  const makeReport = () => call('report', { ...filterPayload, ...(idMappingCsv ? boardPayload : {}) }, setReport);
  const queryRows = queries?.findings.map((q, i) => ({ key: `q${i}`, cells: [q.boardName, q.kind, q.name, q.jql, q.problems.join(' | ')].map((content, j) => ({ key: `c${j}`, content })) }));
  const describeResult = (c) => (c ? (c.status === 'unknown' ? `unknown: ${c.reason}` : `${c.status} (${c.cloudTotal})`) : 'no repair needed');
  const parityRows = parity?.map((p) => ({ key: p.filterId, cells: [p.name, String(p.sourceTotal), describeResult(p.asMigrated), describeResult(p.afterRepair)].map((content, j) => ({ key: `c${j}`, content })) }));
  const toggle = (id) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));

  const filterRows = analysis?.filters.map((f) => ({
    key: f.filterId,
    cells: [
      { key: 'apply', content: f.canRepair ? <Checkbox label="Apply" isChecked={picked.includes(f.filterId)} onChange={() => toggle(f.filterId)} /> : '' },
      { key: 'name', content: f.name },
      { key: 'original', content: f.original },
      { key: 'proposed', content: f.canRepair ? f.proposed : 'unchanged' },
      { key: 'boards', content: f.boards.map((b) => b.name).join(', ') },
      { key: 'plans', content: f.plans.map((p) => p.name).join(', ') },
      { key: 'check', content: f.check ? (f.check.introduced.length ? `Problems: ${f.check.introduced.join(' | ')}` : `OK (${f.check.resolved.length} resolved)`) : '' },
      { key: 'why', content: f.why.join(' ') },
    ],
  }));
  const boardRows = boards?.map((b, i) => ({ key: `${b.boardId}-${i}`, cells: boardRow(b).map((content, j) => ({ key: `c${j}`, content })) }));

  return (
    <Stack space="space.200">
      <Heading as="h2">Afterflight</Heading>
      {error && <SectionMessage appearance="error" title="Failed"><Text>{error}</Text></SectionMessage>}
      <Tabs id="afterflight-tabs">
        <TabList>
          <Tab>Inputs</Tab>
          <Tab>Filters</Tab>
          <Tab>Results</Tab>
          <Tab>Boards</Tab>
          <Tab>Report</Tab>
        </TabList>
        <TabPanel>
          <Stack space="space.150">
            <Text weight="bold">Data Center snapshot (JSON)</Text>
            <TextArea value={snapshotText} isMonospaced minimumRows={6} onChange={(e) => setSnapshotText(e.target.value)} />
            <Text weight="bold">JCMA ID Mapping Report (CSV). Recommended for filters, required for boards</Text>
            <TextArea value={idMappingCsv} isMonospaced minimumRows={6} onChange={(e) => setIdMappingCsv(e.target.value)} />
            <Text>Entity Type strings default to Atlassian's published names. Override one only if your report names it differently:</Text>
            {TYPE_KEYS.map((k) => (
              <Textfield key={k} placeholder={`${k}: ${DEFAULT_ENTITY_TYPES[k]}`} value={types[k]} onChange={(e) => setTypes({ ...types, [k]: e.target.value })} />
            ))}
          </Stack>
        </TabPanel>
        <TabPanel>
          <Stack space="space.150">
            <Button appearance="primary" onClick={analyse}>Analyse filters</Button>
            {analysis?.checkNote && <SectionMessage appearance="warning" title="Atlassian check did not run"><Text>{analysis.checkNote}</Text></SectionMessage>}
            {analysis?.boardsNote && <SectionMessage appearance="information" title="Boards not fully checked"><Text>{analysis.boardsNote}</Text></SectionMessage>}
            {analysis?.plansNote && <SectionMessage appearance="information" title="Plans not checked"><Text>{analysis.plansNote}</Text></SectionMessage>}
            {analysis?.notMigrated.length > 0 && (
              <SectionMessage appearance="warning" title="Filters not migrated"><Text>{analysis.notMigrated.map((f) => f.name).join(', ')}</Text></SectionMessage>
            )}
            {filterRows && <DynamicTable head={FILTER_HEAD} rows={filterRows} />}
            {filterRows && <Button appearance="primary" isDisabled={picked.length === 0} onClick={apply}>Apply selected</Button>}
            {outcome && (
              <SectionMessage appearance={outcome.stillStale.length || outcome.failed.length || outcome.auditErrors.length || outcome.unverified.length ? 'warning' : 'success'} title={`Applied (run ${outcome.runId})`}>
                <Text>{`Repaired ${outcome.done.length}, already done ${outcome.skipped.length}, ignored ${outcome.ignored.length}. Still stale: ${outcome.stillStale.join(', ') || 'none'}. Failed: ${outcome.failed.map((f) => `${f.name} (${f.message})`).join('; ') || 'none'}. Audit problems: ${outcome.auditErrors.join('; ') || 'none'}. Not verified live: ${outcome.unverified.join(', ') || 'none'}.${outcome.verifyNote ? ` ${outcome.verifyNote}` : ''}`}</Text>
              </SectionMessage>
            )}
            {outcome?.done.length > 0 && <Button onClick={undo}>Roll back this run</Button>}
            {rollback && (
              <SectionMessage appearance={rollback.failed.length ? 'warning' : 'success'} title="Rollback">
                <Text>{`Restored ${rollback.done.length}, already original ${rollback.skipped.length}. Left alone because changed since: ${rollback.failed.map((f) => f.name).join(', ') || 'none'}.`}</Text>
              </SectionMessage>
            )}
          </Stack>
        </TabPanel>
        <TabPanel>
          <Stack space="space.150">
            <Button appearance="primary" onClick={compareResultSets}>Compare filter results</Button>
            <Text>Compares what each filter returns in Data Center with Cloud as migrated and as it would be after repair. Needs a snapshot exported with results; run as an administrator on both sides.</Text>
            {parityRows && <DynamicTable head={RESULT_HEAD} rows={parityRows} />}
          </Stack>
        </TabPanel>
        <TabPanel>
          <Stack space="space.150">
            <Button appearance="primary" isDisabled={!idMappingCsv} onClick={compareBoards}>Compare boards</Button>
            {!idMappingCsv && <Text>Board comparison needs the ID Mapping Report (Inputs tab).</Text>}
            {boardRows && <DynamicTable head={BOARD_HEAD} rows={boardRows} />}
            <Button onClick={checkQueries}>Check quick filters and sub-queries</Button>
            {queries && <Text>{`Checked ${queries.checked} quick filter(s) and sub-queries on Cloud; ${queries.findings.length} with problems. Fixes are manual: Cloud has no write route for these.${queries.note ? ` ${queries.note}` : ''}`}</Text>}
            {queryRows && queryRows.length > 0 && <DynamicTable head={QUERY_HEAD} rows={queryRows} />}
          </Stack>
        </TabPanel>
        <TabPanel>
          <Stack space="space.150">
            <Button appearance="primary" onClick={makeReport}>Generate integrity report</Button>
            {report && <CodeBlock text={report.markdown} language="markdown" shouldWrapLongLines />}
          </Stack>
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(<App />);
