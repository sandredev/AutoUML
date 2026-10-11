// tests/presentation/diagram/palette/fuzzy.test.ts — búsqueda difusa de la paleta (T10).
import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzySearch } from '../../../../src/presentation/diagram/palette/fuzzy';

const labels = (r: { item: { label: string } }[]): string[] => r.map((x) => x.item.label);
const items = (...ls: string[]) => ls.map((label, i) => ({ id: 'i' + i, label }));

describe('fuzzyMatch', () => {
  it('devuelve null si la consulta no es subsecuencia', () => {
    expect(fuzzyMatch('xyz', 'UserService')).toBeNull();
    expect(fuzzyMatch('su', 'Us')).toBeNull();
  });

  it('marca los índices coincidentes del texto original (subsecuencia prefiere inicios de palabra)', () => {
    expect(fuzzyMatch('us', 'UserService')?.indices).toEqual([0, 1]);
    expect(fuzzyMatch('usv', 'UserService')?.indices).toEqual([0, 4, 7]);
  });

  it('ignora mayúsculas y acentos', () => {
    expect(fuzzyMatch('CANCION', 'Canción')?.indices).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(fuzzyMatch('ó', 'Pedido')?.indices).toEqual([5]);
    expect(fuzzyMatch('o', 'Pedidó')?.indices).toEqual([5]);
  });

  it('ignora espacios de la consulta', () => {
    expect(fuzzyMatch('user serv', 'UserService')).not.toBeNull();
  });

  it('prefiere el inicio de palabra a una letra suelta (camelCase y separadores)', () => {
    expect(fuzzyMatch('s', 'UserService')?.indices).toEqual([4]);
    expect(fuzzyMatch('r', 'app.repo')?.indices).toEqual([4]);
  });

  it('consulta vacía: coincide con puntuación 0', () => {
    expect(fuzzyMatch('', 'Algo')).toEqual({ score: 0, indices: [] });
  });
});

describe('fuzzySearch', () => {
  it('prefijo > inicio de palabra > contiguo interior > subsecuencia', () => {
    const r = fuzzySearch('ser', items('Laser', 'UserService', 'Service', 'SomeEntityRepo'));
    expect(labels(r)).toEqual(['Service', 'UserService', 'Laser', 'SomeEntityRepo']);
  });

  it('a igual puntuación gana el más corto y luego el orden original (estable)', () => {
    const r = fuzzySearch('a', items('Ab', 'Ac', 'Abc'));
    expect(labels(r)).toEqual(['Ab', 'Ac', 'Abc']);
  });

  it('descarta los que no coinciden', () => {
    expect(labels(fuzzySearch('zz', items('Uno', 'Dos')))).toEqual([]);
  });

  it('consulta vacía: todos en el orden original', () => {
    expect(labels(fuzzySearch('  ', items('B', 'A', 'C')))).toEqual(['B', 'A', 'C']);
  });

  it('respeta el límite', () => {
    expect(fuzzySearch('', items('a', 'b', 'c'), 2)).toHaveLength(2);
  });

  it('varias palabras: cada una puntúa por su cuenta (una etiqueta con espacios no cae a subsecuencia)', () => {
    expect(labels(fuzzySearch('export pdf', items('ExportPdfService', 'Exportar PDF')))[0]).toBe('Exportar PDF');
    expect(fuzzyMatch('plegar todo', 'Plegar todo')!.score).toBeGreaterThan(fuzzyMatch('plegartodo', 'Plegar todo')!.score);
    expect(fuzzyMatch('plegar todo', 'Plegar todo')?.indices).toEqual([0, 1, 2, 3, 4, 5, 7, 8, 9, 10]);
    expect(fuzzyMatch('export xyz', 'Exportar PDF')).toBeNull();
  });

  it('es determinista', () => {
    const list = items('OrderLine', 'Order', 'ordinal', 'Border', 'OrderRepository');
    expect(labels(fuzzySearch('ord', list))).toEqual(labels(fuzzySearch('ord', [...list])));
    expect(labels(fuzzySearch('ord', list))[0]).toBe('Order');
  });
});
