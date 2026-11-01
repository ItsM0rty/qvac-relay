import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContext, DeterministicSelector, estimateTokens, INSTRUCTIONS, project, validateHistory, type Selector } from '../src/context.js';
import { parseRecord, revision, type EvidenceRecord } from '../src/records.js';
import { RelayError } from '../src/policy.js';
import type { Message } from '../src/qvac.js';
const signal = new AbortController().signal;
function evidence(id: string, title: string, text = 'Details'): EvidenceRecord {
  return parseRecord({ id, owner: 'a'.repeat(64), caseId: 'demo', createdAt: '2026-10-31T00:00:00Z', schemaVersion: 1, kind: 'evidence', title, text }) as EvidenceRecord;
}
const records = [evidence('z', 'Unrelated note'), evidence('b', 'Deployment failure'), evidence('a', 'Deployment failure')];
const args = { task: 'Investigate deployment failure', records, history: [] as Message[], tools: [], selector: new DeterministicSelector(), signal };
test('baseline selection uses task overlap and stable ID tie breaks', async () => {
  const selection = await new DeterministicSelector().select(args.task, project(records));
  assert.deepEqual(selection.ids, ['a', 'b', 'z']);
});
test('projection bounds snippets and carries full-record revisions', () => {
  const record = evidence('long', 'Long log', 'x'.repeat(2000));
  const candidate = project([record])[0]!;
  assert.equal(candidate.text.length, 240);
  assert.equal(candidate.revision, revision(record));
  assert.equal('owner' in candidate, false);
});
test('context preserves trusted instructions, task, feedback, requests and tool protocol', async () => {
  const history: Message[] = [
    {role:'assistant',content:'',toolCalls:[{id:'call-1',name:'read_record',arguments:{id:'a'}}]},
    {role:'tool',content:'Observed result',toolCallId:'call-1',toolName:'read_record'},
  ];
  const { title: _title, text: _text, ...base } = records[0]!;
  const request = parseRecord({ ...base, kind:'request', id:'request-1', question:'Need deployment log' });
  const context = await buildContext({ ...args, records:[...records,request], history, feedback:'Quote exact source text.' });
  assert.equal(context.history[0]?.content, INSTRUCTIONS);
  assert.match(context.history[1]!.content, /Investigate deployment failure/);
  assert.match(context.history[1]!.content, /Need deployment log/);
  assert.match(context.history[1]!.content, /Quote exact source text/);
  assert.deepEqual(context.history.slice(-2), history);
});
test('required context survives a selector that omits all candidates', async () => {
  const selector: Selector = {select:async()=>({ids:[],policy:'omit-all'})};
  const context = await buildContext({...args,selector,requiredIds:['z']});
  assert.deepEqual(context.selection.ids,['z']);
  assert.match(context.history[2]!.content,/Unrelated note/);
  await assert.rejects(buildContext({...args,requiredIds:['absent']}), (error:unknown)=>error instanceof RelayError && error.code==='MISSING_REQUIRED');
});
test('selector errors, duplicate IDs and unknown IDs visibly fall back', async () => {
  const selectors: Selector[] = [
    {select:async()=>{throw new Error('selector unavailable');}},
    {select:async()=>({ids:['a','a'],policy:'broken'})},
    {select:async()=>({ids:['invented'],policy:'broken'})},
    {select:async()=>({ids:null,policy:'broken'} as unknown as Awaited<ReturnType<Selector['select']>>)},
  ];
  for(const selector of selectors){
    const context = await buildContext({...args,selector});
    assert.equal(context.selection.policy,'deterministic');
    assert.ok(context.selection.fallback);
    assert.deepEqual(context.selection.ids,['a','b','z']);
  }
});
test('budget prunes optional evidence and refuses to prune required protocol', async () => {
  const empty = await buildContext({...args,records:[]});
  const context = await buildContext({...args,budget:empty.estimatedTokens});
  assert.deepEqual(context.selection.ids,[]);
  assert.ok(context.estimatedTokens<=empty.estimatedTokens);
  await assert.rejects(buildContext({...args,budget:empty.estimatedTokens,requiredIds:['a']}), (error:unknown)=>error instanceof RelayError && error.code==='CONTEXT_OVERFLOW');
  await assert.rejects(buildContext({...args,budget:1}), (error:unknown)=>error instanceof RelayError && error.kind==='overflow');
  assert.ok(estimateTokens('☃')>estimateTokens('x'));
});
test('protocol rejects orphaned, mismatched, repeated and unresolved call IDs', () => {
  const call: Message = {role:'assistant',content:'',toolCalls:[{id:'c',name:'read_record',arguments:{id:'a'}}]};
  const result: Message = {role:'tool',content:'result',toolCallId:'c',toolName:'read_record'};
  validateHistory([call,result]);
  for(const history of [[result],[call],[call,{...result,toolName:'different'}],[call,result,result],
    [call,result,call,result],[call,{role:'user' as const,content:'skip result'}],
    [{...call,role:'user' as const},result]]) assert.throws(()=>validateHistory(history));
});
test('selector cancellation propagates without deterministic fallback', async () => {
  const controller = new AbortController(); controller.abort();
  const selector: Selector = {select:async()=>{throw new DOMException('Cancelled','AbortError');}};
  await assert.rejects(buildContext({...args,signal:controller.signal,selector}), (error:unknown)=>error instanceof RelayError && error.kind==='cancelled');
});


test('cancellation is checked before selector execution and after a normal selector return', async () => {
  const before = new AbortController(); before.abort(); let calls=0;
  const normal: Selector = {select:async()=>{calls++;return {ids:['a'],policy:'normal'};}};
  await assert.rejects(buildContext({...args,signal:before.signal,selector:normal}), (error:unknown)=>error instanceof RelayError && error.kind==='cancelled');
  assert.equal(calls,0);
  const during = new AbortController();
  const aborting: Selector = {select:async()=>{during.abort();return {ids:['a'],policy:'normal'};}};
  await assert.rejects(buildContext({...args,signal:during.signal,selector:aborting}), (error:unknown)=>error instanceof RelayError && error.kind==='cancelled');
});
