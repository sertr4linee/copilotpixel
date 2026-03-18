/**
 * Runtime detection, provider-agnostic
 */

declare function acquireVsCodeApi(): unknown;

export type Runtime = 'vscode' | 'browser';

export const runtime: Runtime = typeof acquireVsCodeApi !== 'undefined' ? 'vscode' : 'browser';

export const isBrowserRuntime = runtime === 'browser';
