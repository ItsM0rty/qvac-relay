import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { RelayStore } from './store.js';
import { briefSchema, idSchema, parseRecord, revision, stableId, type BriefRecord, type CheckpointRecord, type RelayRecord } from './records.js';
import { buildContext, DeterministicSelector, type Selector } from './context.js';
import type { Message, Model, ToolSpec } from './qvac.js';
import { checkCancelled, classify, failureSignature, RelayError, repairDecision } from './policy.js';

const schemas = {
  find_evidence: z.strictObject({query:z.string().max(200)}),
  read_record: z.strictObject({id:idSchema}),
  request_information: z.strictObject({question:z.string().trim().min(1).max(500)}),
  save_brief: briefSchema.pick({facts:true,uncertainty:true,missing:true}),
};
export const TOOLS: ToolSpec[] = Object.entries(schemas).map(([name,schema])=>({name,
  description: ({find_evidence:'Search this case. Read matching records before citing.',read_record:'Read evidence with its ID and revision.',request_information:'Persist a question for another peer. Reuse existing questions.',save_brief:'Save cited facts, uncertainty, and unresolved questions. Exact quotes required.'} as Record<string,string>)[name]!,
  parameters:z.toJSONSchema(schema) as Record<string,unknown>}));
export function validateArguments(name: string, args: unknown): Record<string,unknown> {
  if (!Object.hasOwn(schemas,name)) throw new RelayError('UNKNOWN_TOOL',`Tool ${name} is not permitted.`);
  const parsed = schemas[name as keyof typeof schemas].safeParse(args);
  if (!parsed.success) throw new RelayError('ARGUMENTS',JSON.stringify(parsed.error.issues.map(i=>({field:i.path.join('.'),code:i.code,message:i.message}))).slice(0,1800));
  return parsed.data;
}
export function latestCheckpoint(records: RelayRecord[], owner: string): CheckpointRecord | undefined {
  return records.filter((r):r is CheckpointRecord=>r.kind==='checkpoint'&&r.owner===owner)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.calls-a.calls||b.id.localeCompare(a.id))[0];
}
export function contributions(records: RelayRecord[], checkpoint: CheckpointRecord): string[] {
  return records.filter(r=>r.kind==='evidence'&&r.owner!==checkpoint.owner&&r.requestId&&checkpoint.requestIds.includes(r.requestId)&&!checkpoint.consumed.includes(r.id)).map(r=>r.id).sort();
}
export interface RunOptions {signal?:AbortSignal; selector?:Selector; runId?:string; consumed?:string[]; requiredIds?:string[]; maxCalls?:number; maxRepairs?:number; contextBudget?:number; timeoutMs?:number; initialCalls?:number; initialRepairs?:number; initialFailure?:string;}
export class Agent {
  private active = false;
  private controller?:AbortController;
  get isActive():boolean{return this.active;}
  cancel():void{this.controller?.abort(new DOMException('User cancelled','AbortError'));}
  constructor(readonly store:RelayStore, readonly model:Model) {}
  private async trace(runId:string,event:string,data:Record<string,unknown>):Promise<void> {
    const directory=join(this.store.directory,'traces'); await mkdir(directory,{recursive:true});
    await appendFile(join(directory,`${runId}.jsonl`),JSON.stringify({at:new Date().toISOString(),runId,peer:this.store.owner,event,...data})+'\n');
  }
  async run(caseId:string,options:RunOptions={}):Promise<CheckpointRecord> {
    if(this.active) throw new RelayError('BUSY','This peer already has active work.','infrastructure');
    idSchema.parse(caseId);if(options.runId)idSchema.parse(options.runId);
    const timeoutMs=options.timeoutMs??180_000;
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3_600_000)throw new RelayError('OPTIONS','timeoutMs must be between1 and3600000.');
    for(const value of [options.maxCalls??10,options.maxRepairs??2,options.initialCalls??0,options.initialRepairs??0])if(!Number.isSafeInteger(value)||value<0||value>1000)throw new RelayError('OPTIONS','Attempt counters must be integers between0 and1000.');
    this.active=true;
    this.controller=new AbortController();
    const deadline=AbortSignal.timeout(timeoutMs);
    const signal=AbortSignal.any([this.controller.signal,deadline,...(options.signal?[options.signal]:[])]);
    const runId=options.runId??randomUUID(); let calls=options.initialCalls??0,repairs=options.initialRepairs??0,lastFailure=options.initialFailure;
    let briefId:string|undefined; let reason:string|undefined; let requestIds:string[]=[];
    const consumed=[...new Set(options.consumed??[])].sort(); let task='';
    let clock=Date.now(); let sequence=0;
    const stamp=()=>new Date(clock=Math.max(Date.now(),clock+1)).toISOString();
    const checkpoint=async(status:CheckpointRecord['status'])=>{
      const record=parseRecord({schemaVersion:1,kind:'checkpoint',id:stableId(runId,'checkpoint',String(sequence++)),owner:this.store.owner,caseId,createdAt:stamp(),runId,status,task,calls,repairs,consumed,requestIds,...(lastFailure?{lastFailure}:{}),...(briefId?{briefId}:{}),...(reason?{reason}:{})}) as CheckpointRecord;
      await this.store.put(record); await this.trace(runId,'transition',{status,calls,repairs,reason}); return record;
    };
    try {
      checkCancelled(signal);
      let snapshot=await this.store.snapshot(caseId);
      const cases=snapshot.records.filter(r=>r.kind==='case');
      if(cases.length!==1||cases[0]!.owner!==this.store.owner) throw new RelayError('CASE_OWNER','Exactly one local-owned case is required.','infrastructure');
      task=cases[0]!.kind==='case'?cases[0]!.task:'';
      const existingRun=snapshot.records.filter((r):r is CheckpointRecord=>r.kind==='checkpoint'&&r.runId===runId&&r.owner===this.store.owner).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
      if(existingRun)return existingRun;
      clock=Math.max(clock,...snapshot.records.filter(r=>r.kind==='checkpoint'&&r.owner===this.store.owner).map(r=>Date.parse(r.createdAt)));
      requestIds=snapshot.records.filter(r=>r.kind==='request'&&r.owner===this.store.owner).map(r=>r.id);
      await checkpoint('running');
      await this.trace(runId,'start',{model:this.model.name,requiredIds:options.requiredIds??[],consumed,budgets:{calls:options.maxCalls??10,repairs:options.maxRepairs??2,context:options.contextBudget??7000}});
      const read=new Map<string,{revision:string,text:string}>(); const usedCallIds=new Set<string>(); const actions=new Map<string,number>(); let history:Message[]=[]; let feedback:string|undefined;
      const selector=options.selector??new DeterministicSelector(); let cachedKey=''; let cached:Awaited<ReturnType<Selector['select']>>|undefined;
      const memo:Selector={select:async(t,c,s)=>{
        const key=stableId(t,JSON.stringify(c));
        if(key!==cachedKey){
          await this.model.release?.();
          try{cached=await selector.select(t,c,s);if(new Set(cached.ids).size!==cached.ids.length||cached.ids.some(id=>!c.some(v=>v.id===id)))throw new Error('Invalid selector IDs');}
          catch(error){checkCancelled(s);cached={...await new DeterministicSelector().select(t,c),fallback:String(error)};}
          cachedKey=key;
        }
        return cached!;
      }};
      for(;calls<(options.maxCalls??10);) {
        checkCancelled(signal);
        snapshot=await this.store.snapshot(caseId);
        const context=await buildContext({task,records:snapshot.records,history,tools:TOOLS,selector:memo,requiredIds:options.requiredIds,signal,budget:options.contextBudget,feedback});
        await this.trace(runId,'context',{...context.selection,estimatedInputTokens:context.estimatedTokens,tokenAccounting:'conservative UTF-8 byte estimate plus template allowance',fingerprint:snapshot.fingerprint});
        calls++;await checkpoint('running');
        let reply;
        try {reply=await this.model.complete(context.history,TOOLS,signal);}
        catch(error){if(classify(error)==='cancelled'||signal.aborted)throw new RelayError('CANCELLED','Inference cancelled.','cancelled');if(classify(error)==='overflow')throw new RelayError('NATIVE_CONTEXT_OVERFLOW','Native context overflow despite the input estimate. Reduce evidence or context budget.','overflow');throw new RelayError('MODEL_FAILED',error instanceof Error?error.message:String(error),'model');}
        checkCancelled(signal);
        await this.trace(runId,'model',{stopReason:reply.stopReason,stats:reply.stats,calls:reply.calls.map(c=>({id:c.id,name:c.name})),toolErrorCount:reply.toolErrors.length});
        if(reply.stopReason==='length'&&reply.calls.length===0) throw new RelayError('OUTPUT_LIMIT','Model exhausted output budget without an action.','model');
        if(reply.calls.length===0) {
          const error=new RelayError(reply.toolErrors.length?'MALFORMED_CALL':'NO_ACTION',reply.toolErrors.length?'Native tool output was malformed. Emit a valid declared tool.':'No brief saved. Use a tool to investigate or save_brief.');
          const signature=failureSignature(error);
          if(repairDecision(repairs,lastFailure,signature,'validation',options.maxRepairs??2)==='stop')throw error;
          lastFailure=signature;repairs++;feedback=error.message;await checkpoint('running');continue;
        }
        const ids=new Set<string>();
        if(reply.calls.some(c=>!c.id||ids.has(c.id)||!ids.add(c.id))) throw new RelayError('CALL_IDS','Invalid or duplicate model call IDs.','model');
        if([...ids].some(id=>usedCallIds.has(id)))throw new RelayError('CALL_IDS','Reused model call ID.','model');
        for(const id of ids)usedCallIds.add(id);
        history.push({role:'assistant',content:'',toolCalls:reply.calls});
        let fatal:unknown; let saved=false;
        for(const call of reply.calls) {
          let result:unknown;
          try {
            checkCancelled(signal);
            if(reply.calls.length!==1)throw new RelayError('PARALLEL_DENIED','Use one tool per turn so dependencies have results.');
            const args=validateArguments(call.name,call.arguments);
            const current=await this.store.snapshot(caseId);
            checkCancelled(signal);
            const actionKey=stableId(call.name,JSON.stringify(args),current.fingerprint);
            const repetitions=actions.get(actionKey)??0;actions.set(actionKey,repetitions+1);
            if(repetitions>=2)throw new RelayError('NO_PROGRESS','This action already returned a result twice against unchanged data. Use the existing result, read a relevant record, or request missing information.');
            if(call.name==='find_evidence') {
              const query=String(args.query).toLowerCase();
              result=current.records.filter(r=>r.kind==='evidence'&&`${r.title} ${r.text}`.toLowerCase().includes(query)).slice(0,12).map(r=>({id:r.id,revision:revision(r),title:r.kind==='evidence'?r.title:''}));
            } else if(call.name==='read_record') {
              const record=current.records.find(r=>r.id===args.id&&r.kind==='evidence');
              if(!record||record.kind!=='evidence')throw new RelayError('RECORD_NOT_FOUND',`Evidence ${String(args.id)} is not available in this case.`);
              const text=record.text.slice(0,1000);read.set(record.id,{revision:revision(record),text});
              result={id:record.id,revision:revision(record),text,truncated:text.length!==record.text.length};
            } else if(call.name==='request_information') {
              const question=String(args.question);const id=stableId(this.store.owner,caseId,'request',question.toLowerCase());
              const existing=current.records.find(r=>r.id===id);
              const record=existing??parseRecord({schemaVersion:1,kind:'request',id,owner:this.store.owner,caseId,createdAt:stamp(),question});
              checkCancelled(signal);await this.store.put(record); if(!requestIds.includes(id))requestIds.push(id);
              result={id,question,persisted:true};
            } else if(call.name==='save_brief') {
              if(current.fingerprint!==snapshot.fingerprint)throw new RelayError('STALE_CONTEXT','Locally available evidence changed. Read the new evidence before saving.');
              const draft=schemas.save_brief.parse(args);
              const cited=new Set<string>();
              for(const fact of draft.facts)for(const source of fact.sources){
                const evidence=current.records.find(r=>r.id===source.id&&r.kind==='evidence'); const seen=read.get(source.id);
                if(!evidence||!seen)throw new RelayError('UNREAD_SOURCE',`Read evidence ${source.id} before citing it.`);
                if(revision(evidence)!==source.revision||seen.revision!==source.revision)throw new RelayError('REVISION',`Use the current revision for ${source.id}.`);
                if(!seen.text.includes(source.quote))throw new RelayError('QUOTE',`Quote must be an exact substring of the read result for ${source.id}.`);
                cited.add(source.id);
              }
              for(const id of options.requiredIds??[])if(!cited.has(id))throw new RelayError('COVERAGE',`Cite required contribution ${id}.`);
              const open=current.records.filter(r=>r.kind==='request'&&r.owner===this.store.owner&&!current.records.some(e=>e.kind==='evidence'&&e.requestId===r.id));
              if(open.length&&!draft.missing.length)throw new RelayError('MISSING_COVERAGE','List unresolved requested information in missing.');
              if(draft.missing.length&&!open.length)throw new RelayError('REQUEST_REQUIRED','Persist a request_information question for missing evidence before saving.');
              const record=parseRecord({schemaVersion:1,kind:'brief',id:stableId(runId,'brief'),owner:this.store.owner,caseId,createdAt:stamp(),...draft,basedOn:current.fingerprint}) as BriefRecord;
              checkCancelled(signal);
              await this.store.put(record,{expectedFingerprint:current.fingerprint});briefId=record.id;saved=true;result={id:record.id,persisted:true};
            }
            await this.trace(runId,'tool',{callId:call.id,name:call.name,ok:true,recordId:typeof result==='object'&&result!==null&&'id' in result?result.id:undefined,...(Array.isArray(result)?{resultIds:result.map(r=>r.id),resultCount:result.length}:{}),...(call.name==='read_record'?{requestedId:args.id}:{})});
            lastFailure=undefined;feedback=undefined;
          }catch(error){
            const kind=classify(error);const signature=failureSignature(error);
            result={ok:false,code:error instanceof RelayError?error.code:'TOOL_INFRASTRUCTURE',feedback:error instanceof Error?error.message:String(error)};
            await this.trace(runId,'validation',{callId:call.id,name:call.name,kind,signature});
            if(repairDecision(repairs,lastFailure,signature,kind,options.maxRepairs??2)==='stop')fatal=error;
            else {repairs++;lastFailure=signature;feedback=JSON.stringify(result);}
          }
          history.push({role:'tool',toolCallId:call.id,toolName:call.name,content:JSON.stringify(result)});
        }
        if(fatal)throw fatal;
        if(saved){const all=await this.store.list(caseId);const pending=all.some(r=>r.kind==='request'&&requestIds.includes(r.id)&&!all.some(e=>e.kind==='evidence'&&e.requestId===r.id));return await checkpoint(pending?'pending':'completed');}
        await checkpoint('running');
        // Retain complete protocol groups. Older resolved groups can leave context;
        // accepted writes remain in the store and citation reads must be repeated if needed.
        const groups:Message[][]=[];for(const message of history){if(message.role==='assistant')groups.push([message]);else groups.at(-1)!.push(message);}
        history=groups.slice(-2).flat();
      }
      throw new RelayError('CALL_BUDGET','Model call budget exhausted.','model');
    }catch(error){
      reason=`${classify(error)}: ${error instanceof Error?error.message:String(error)}`.slice(0,2000);
      await this.trace(runId,'stop',{reason});
      if(!task)throw error;
      return await checkpoint(classify(error)==='cancelled'||signal.aborted?'cancelled':'failed');
    }finally{try{await this.model.release?.();}finally{this.active=false;this.controller=undefined;}}
  }
}
