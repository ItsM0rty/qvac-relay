import { prepareMiniLM, MINILM, minilmDirectory } from '../src/minilm.js';
await prepareMiniLM(AbortSignal.timeout(180_000));
console.log(
  JSON.stringify({
    prepared: true,
    model: MINILM,
    directory: minilmDirectory(),
    inference: 'offline-only after preparation',
  }),
);
