import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parsePuml } from '../../../src/application/puml/parser';
import { Sidebar } from '../../../src/presentation/components/Sidebar';
import { entityTree } from '../../../src/presentation/components/entityGroups';

const PUML = '@startuml\nclass Customer\nclass Order\nCustomer --> Order\n@enduml\n';
const PKG = `@startuml
package domain.model.core {
  class Farm
  abstract class BaseEntity
}
package domain.enums {
  enum DeviceStatus
}
class Suelta
@enduml`;

describe('Sidebar con archivo externo (issue #4)', () => {
  it('muestra las entidades aunque no haya proyecto abierto', () => {
    const diagram = parsePuml(PUML);
    expect(diagram.types.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<Sidebar model={diagram} fileLabel="externo.puml" width={280} onResize={vi.fn()} selectedId={null} />);
    expect(html).toContain('Customer');
    expect(html).toContain('Order');
  });

  it('sigue mostrando el mensaje cuando no hay diagrama', () => {
    const html = renderToStaticMarkup(<Sidebar model={null} width={280} onResize={vi.fn()} selectedId={null} />);
    expect(html).toContain('Carga un .puml');
  });

  it('las entidades fuera de la vista van en su bloque, y las ocultas por hide llevan su línea', () => {
    const diagram = parsePuml(PKG);
    const html = renderToStaticMarkup(
      <Sidebar model={diagram} width={280} onResize={vi.fn()} outOfView={new Set(['Suelta'])} pumlHidden={new Map([['Suelta', 12]])} />,
    );
    expect(html).toContain('Fuera de la vista');
    // El bloque arranca plegado: el nombre no se pinta hasta abrirlo.
    expect(html).not.toContain('>Suelta<');
  });
});

describe('entityTree (T11)', () => {
  it('agrupa por paquete con prefijo y último segmento, y deja el paquete por defecto al final', () => {
    const tree = entityTree(parsePuml(PKG), 'package', new Set());
    expect(tree.groups.map((g) => [g.prefix, g.leaf])).toEqual([
      ['domain.', 'enums'],
      ['domain.model.', 'core'],
      ['', ''],
    ]);
    expect(tree.groups[1]?.items.map((i) => i.name)).toEqual(['BaseEntity', 'Farm']);
  });

  it('agrupa por tipo en el orden canónico', () => {
    const tree = entityTree(parsePuml(PKG), 'type', new Set());
    expect(tree.groups.map((g) => g.category)).toEqual(['abstract', 'enum', 'class']);
  });

  it('separa lo que está fuera de la vista y filtra por nombre o paquete', () => {
    const tree = entityTree(parsePuml(PKG), 'package', new Set(['Farm']), 'core');
    expect(tree.groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(['BaseEntity']);
    expect(tree.outOfView.map((i) => i.id)).toEqual(['Farm']);
  });
});
