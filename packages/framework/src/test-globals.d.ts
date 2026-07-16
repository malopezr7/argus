import type {
  describe as DescribeFunction,
  it as ItFunction,
  test as TestFunction,
} from './jest-api.js';
import type { expect as ExpectFunction } from './matchers.js';

declare global {
  const describe: typeof DescribeFunction;
  const expect: typeof ExpectFunction;
  const it: typeof ItFunction;
  const test: typeof TestFunction;
}
