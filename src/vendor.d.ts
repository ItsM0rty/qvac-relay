declare module 'corestore' {
  import { EventEmitter } from 'node:events';
  import { Duplex } from 'node:stream';
  export interface Core extends EventEmitter {
    key: Buffer;
    length: number;
    writable: boolean;
    ready(): Promise<void>;
    update(options?: { wait?: boolean }): Promise<boolean>;
  }
  export default class Corestore {
    constructor(directory: string);
    ready(): Promise<void>;
    session(): Corestore;
    get(options: {key?: Buffer; name?: string}): Core;
    replicate(initiator: boolean): Duplex;
    close(): Promise<void>;
  }
}

declare module 'hyperbee2' {
  import { EventEmitter } from 'node:events';
  import { Readable } from 'node:stream';
  import Corestore, { Core } from 'corestore';
  export interface Entry { key: Buffer; value: Buffer; seq: number }
  export interface ReadOptions { timeout?: number; wait?: boolean }
  export interface EntryStream extends Readable { [Symbol.asyncIterator](): AsyncIterableIterator<Entry> }
  export default class Hyperbee2 extends EventEmitter {
    constructor(store: Corestore, options?: ReadOptions & {key?: Buffer; writable?: boolean; autoUpdate?: boolean});
    core: Core;
    ready(): Promise<void>;
    close(): Promise<void>;
    update(): void;
    snapshot(options?: ReadOptions): Hyperbee2;
    get(key: Buffer, options?: ReadOptions): Promise<Entry | null>;
    createReadStream(options?: { limit?: number }): EntryStream;
    write(): { tryPut(key: Buffer, value: Buffer): void; flush(): Promise<void>; close(): Promise<void>; closed: boolean };
  }
}
