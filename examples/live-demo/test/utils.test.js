import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotal } from '../src/utils.js';

describe('utils', () => {
  it('calculateTotal sums prices', () => {
    const total = calculateTotal([{ price: 10 }, { price: 20 }]);
    assert.equal(total, 30);
  });
});
