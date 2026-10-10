import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildTree, countByCategory } from '../../../src/domain/diagram/classify';
import { parsePuml } from '../../../src/application/puml/parser';
import { Sidebar } from '../../../src/presentation/components/Sidebar';

const PUML = '@startuml\nclass Customer\nclass Order\nCustomer --> Order\n@enduml\n';

describe('Sidebar con archivo externo (issue #4)', () => {
  it('muestra las entidades aunque no haya proyecto abierto', () => {
    const diagram = parsePuml(PUML);
    expect(diagram.types.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(
      <Sidebar
        project={null}
        externalName="externo.puml"
        width={280}
        onResize={vi.fn()}
        groups={buildTree(diagram)}
        counts={countByCategory(diagram)}
        selectedId={null}
      />,
    );
    expect(html).toContain('Customer');
    expect(html).toContain('Order');
    expect(html).toContain('externo.puml');
  });

  it('sigue mostrando el mensaje cuando no hay diagrama ni proyecto', () => {
    const html = renderToStaticMarkup(
      <Sidebar project={null} width={280} onResize={vi.fn()} groups={[]} counts={null} selectedId={null} />,
    );
    expect(html).toContain('Carga un .puml');
  });
});
