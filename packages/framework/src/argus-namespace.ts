import { argusFn, argusSpyOn } from './mock-fn.js';
import { mockNativeModule, resetNativeModules } from './native-mocks.js';

export function installArgusNamespace(g: Record<string, unknown>): void {
  g.argus = {
    fn: argusFn,
    spyOn: argusSpyOn,
    mockNativeModule,
    resetNativeModules,
  };
}
