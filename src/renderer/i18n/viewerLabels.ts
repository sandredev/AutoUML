// Textos del visor (src/render) traducidos con el catálogo: src/render no conoce i18n, recibe este objeto.
import type { Category, RelType } from '../../core/model';
import type { ViewerLabels } from '../../render/labels';
import type { TranslateFn } from './I18nProvider';

const CATEGORIES: Category[] = ['sealed', 'abstract', 'interface', 'enum', 'record', 'annotation', 'class', 'external', 'undeclared'];
const REL_TYPES: RelType[] = ['EXTENDS', 'IMPLEMENTS', 'ASSOCIATION', 'DEPENDENCY', 'COMPOSITION', 'AGGREGATION'];

export function viewerLabels(t: TranslateFn): ViewerLabels {
  const categories = {} as Record<Category, string>;
  for (const c of CATEGORIES) categories[c] = t(`viewer.kind.${c}`);
  const relTypes = {} as Record<RelType, string>;
  for (const r of REL_TYPES) relTypes[r] = t(`viewer.rel.${r}`);
  return {
    canvasAria: t('viewer.canvasAria'),
    minimapAria: t('viewer.minimapAria'),
    paintError: t('viewer.paintError'),
    contextUnavailable: t('viewer.contextUnavailable'),
    collapsedSubtitle: t('viewer.collapsedSubtitle'),
    moreMembers: t('viewer.moreMembers'),
    tipPackage: t('viewer.tipPackage'),
    tipKind: t('viewer.tipKind'),
    tipRelations: t('viewer.tipRelations'),
    tipMultiplicity: t('viewer.tipMultiplicity'),
    tipLabel: t('viewer.tipLabel'),
    tipEntities: t('viewer.tipEntities'),
    noPackage: t('viewer.noPackage'),
    categories,
    relTypes,
    computeError: t('viewer.computeError'),
    computing: t('viewer.computing'),
    emptyTitle: t('viewer.emptyTitle'),
    emptyBody: t('viewer.emptyBody'),
    toolbarAria: t('viewer.toolbarAria'),
    relayouting: t('viewer.relayouting'),
    fallback: t('viewer.fallback'),
    fallbackBadge: t('viewer.fallbackBadge'),
    manual: t('viewer.manual'),
    refining: t('viewer.refining'),
    reset: t('viewer.reset'),
    resetTitle: t('viewer.resetTitle'),
  };
}
