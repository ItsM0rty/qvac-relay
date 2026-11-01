import { DeterministicSelector, type Selector } from './context.js';
import { LayaSelector } from './laya.js';
import { MiniLMSelector } from './minilm.js';
export type SelectorMode = 'deterministic' | 'minilm' | 'laya';
export function createSelector(mode: string): Selector & { close?: () => Promise<void> } {
  if (mode === 'deterministic') return new DeterministicSelector();
  if (mode === 'minilm') return new MiniLMSelector();
  if (mode === 'laya') return new LayaSelector();
  throw new Error('RELAY_SELECTOR must be deterministic, minilm or laya');
}
