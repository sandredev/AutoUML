import { describe, expect, it } from 'vitest';
import { firstSegment } from '../../../../src/presentation/diagram/canvas/edgePath';

describe('firstSegment', () => {
  it('devuelve [desde, punta] saltando repetidos y null si es degenerado', () => {
    expect(firstSegment([10, 20, 10, 20, 30, 40])).toEqual([30, 40, 10, 20]);
    expect(firstSegment([5, 5])).toBeNull();
    expect(firstSegment([7, 7, 7, 7])).toBeNull();
  });
});
