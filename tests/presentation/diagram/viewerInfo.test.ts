import { describe, expect, it } from 'vitest';
import { parsePuml } from '../../../src/application/puml/parser';
import { drawHiddenOf } from '../../../src/presentation/diagram/graph/filters';
import { aggregateCollapsed, PACKAGE_NODE_PREFIX } from '../../../src/presentation/diagram/layout/aggregate';
import { hiddenByPuml, outOfViewOf, shownRelationsOf } from '../../../src/presentation/diagram/viewerInfo';
import { canIgnore, ignoredCount, issueKey, visibleIssues } from '../../../src/presentation/components/issueKeys';
import type { ParseIssue } from '../../../src/domain/diagram/model';

const PUML = `@startuml
package a.core {
  class Farm
  class Base
}
package a.hw {
  class Sensor
}
class Alert
hide Alert
Farm --> Sensor
Farm --|> Base
@enduml`;

describe('qué se ve del documento (T11)', () => {
  const model = parsePuml(PUML);

  it('lo filtrado y lo oculto por hide queda fuera de la vista', () => {
    const shown = { ...model, types: model.types.filter((t) => t.id !== 'Alert') };
    const hidden = drawHiddenOf(shown, { hiddenTypes: ['Sensor'] });
    expect([...outOfViewOf(model, shown, hidden, new Set())].sort()).toEqual(['Alert', 'Sensor']);
    expect(shownRelationsOf(shown, hidden)).toBe(1);
  });

  it('un paquete plegado cuenta como visto (sus tipos están en la tarjeta del paquete)', () => {
    const collapsed = new Set(['a.core']);
    const agg = aggregateCollapsed(model, collapsed).model;
    expect(agg.types.some((t) => t.id === PACKAGE_NODE_PREFIX + 'a.core')).toBe(true);
    expect([...outOfViewOf(model, agg, null, collapsed)]).toEqual([]);
  });

  it('localiza la línea del hide que oculta cada tipo', () => {
    expect([...hiddenByPuml(model, PUML)]).toEqual([['Alert', 10]]);
    expect([...hiddenByPuml(model, null)]).toEqual([['Alert', null]]);
  });
});

describe('avisos ignorados (T11)', () => {
  const warn = (line: number, message: string): ParseIssue => ({ line, severity: 'warning', message });
  const err: ParseIssue = { line: 34, severity: 'error', message: 'Llave sin cerrar (abierta en la línea 34)' };

  it('la clave no depende de la línea: sobrevive a las ediciones', () => {
    expect(issueKey(warn(2, '!theme plain'))).toBe(issueKey(warn(9, '!theme plain')));
    expect(issueKey({ ...warn(2, 'x'), file: '/a/b/inc.puml' })).toBe('warning:inc.puml:x');
  });

  it('los errores no se ignoran y van primero', () => {
    expect(canIgnore(err)).toBe(false);
    const ignored = new Set([issueKey(warn(2, '!theme plain')), issueKey(err)]);
    const issues = [warn(2, '!theme plain'), warn(5, 'otro'), err];
    expect(visibleIssues(issues, ignored)).toEqual([err, warn(5, 'otro')]);
    expect(ignoredCount(issues, ignored)).toBe(1);
  });
});
