import React, { useState } from 'react';
import ForgeReconciler, { Button, Checkbox, DynamicTable, Heading, SectionMessage, Stack, Text, Textarea } from '@forge/react';
import { invoke } from '@forge/bridge';

const HEAD = { cells: ['Apply', 'Filter', 'Original', 'Proposed', 'Left for you'].map((content) => ({ key: content, content })) };

const describeOpen = (open) => open.map((o) => `${o.type} "${o.was}" ${o.status}${o.meant ? ` (meant ${o.meant})` : ''}`).join('; ');

const App = () => {
  const [snapshotText, setSnapshotText] = useState('');
  const [analysis, setAnalysis] = useState();
  const [picked, setPicked] = useState([]);
  const [outcome, setOutcome] = useState();
  const [error, setError] = useState();

  const call = async (action, payload, onResult) => {
    setError();
    try {
      onResult(await invoke(action, payload));
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  };
  const analyse = () => call('analyse', { snapshotText }, (result) => {
    setAnalysis(result);
    setPicked(result.filters.filter((f) => f.canRepair).map((f) => f.filterId));
    setOutcome();
  });
  const apply = () => call('apply', { snapshotText, filterIds: picked }, setOutcome);
  const toggle = (id) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));

  const rows = analysis?.filters.map((f) => ({
    key: f.filterId,
    cells: [
      { key: 'apply', content: f.canRepair ? <Checkbox label="Apply" isChecked={picked.includes(f.filterId)} onChange={() => toggle(f.filterId)} /> : '' },
      { key: 'name', content: f.name },
      { key: 'original', content: f.original },
      { key: 'proposed', content: f.canRepair ? f.proposed : 'unchanged' },
      { key: 'open', content: describeOpen(f.open) },
    ],
  }));

  return (
    <Stack space="space.200">
      <Heading as="h2">Afterflight</Heading>
      <Textarea label="Data Center snapshot (JSON)" onChange={(e) => setSnapshotText(e.target.value)} />
      <Button appearance="primary" onClick={analyse}>Analyse</Button>
      {error && <SectionMessage appearance="error" title="Failed"><Text>{error}</Text></SectionMessage>}
      {analysis?.notMigrated.length > 0 && (
        <SectionMessage appearance="warning" title="Filters not migrated">
          <Text>{analysis.notMigrated.map((f) => f.name).join(', ')}</Text>
        </SectionMessage>
      )}
      {rows && <DynamicTable head={HEAD} rows={rows} />}
      {rows && <Button appearance="primary" isDisabled={picked.length === 0} onClick={apply}>Apply selected</Button>}
      {outcome && (
        <SectionMessage appearance={outcome.stillStale.length ? 'warning' : 'confirmation'} title="Applied">
          <Text>{`Repaired ${outcome.done.length}, already done ${outcome.skipped.length}, ignored ${outcome.ignored.length}. Still stale: ${outcome.stillStale.join(', ') || 'none'}.`}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<App />);
