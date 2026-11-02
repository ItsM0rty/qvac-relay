#!/usr/bin/env bash
set -euo pipefail
report=artifacts/review-fixes-cfa92b6
export RELAY_SOURCE_COMMIT="$(git rev-parse HEAD)"
npm run bundle:qvac 2>&1 | tee "$report/bundle.log"
npm run build 2>&1 | tee "$report/full-build.log"
npm run format:check 2>&1 | tee "$report/format.log"
npm test 2>&1 | tee "$report/tests.tap"
npm run diagnose:review -- "$report/controlled.json" 2>&1 | tee "$report/controlled.log"
npm run evaluate -- --mode replay --trials 3 --output "$report/replay.json" 2>&1 | tee "$report/replay.log"
node --input-type=module <<'JS'
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {EVAL_HARNESS_HASH} from './dist/src/eval.js';
const directory='artifacts/review-fixes-cfa92b6';
const tap=await readFile(directory+'/tests.tap','utf8');
const count=(key)=>Number(tap.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]);
if(count('fail')!==0 || !count('pass')) throw new Error('Invalid test summary');
const controlled=JSON.parse(await readFile(directory+'/controlled.json','utf8'));
if(controlled.rows.some(row=>!row.passed)) throw new Error('Failed controlled diagnostic');
const manifest={sourceCommit:process.env.RELAY_SOURCE_COMMIT,baseReviewCommit:'cfa92b6cb4e5eec89b5412588b7cc175c28bd933',node:process.versions.node,platform:process.platform,arch:process.arch,lockSha256:createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),dependencyScope:'Existing installed dependencies and project-local Linux Node reused; no fresh installation.',checks:['bundle:qvac','build','format:check','npm test','diagnose:review','evaluate replay, 3 trials'],tests:{passed:count('pass'),failed:count('fail')},controlled:controlled.rows.map(row=>({caseId:row.caseId,passed:row.passed,status:row.status,calls:row.calls,repairs:row.repairs})),evalHarnessHash:EVAL_HARNESS_HASH,nativeInference:false,scope:'Controlled models and real temporary stores, existing separate-process P2P tests, diagnostic subprocess exit checks. No new native model trial. Earlier native reports remain attributed to their original source.'};
await writeFile(directory+'/verification.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
JS
