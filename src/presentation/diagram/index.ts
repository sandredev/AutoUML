/** Public, Electron-independent API for the puml-viewer capability. */
export { buildTree, countByCategory } from '../../domain/diagram/classify';
export { parsePuml } from '../../application/puml/parser';
export type { Category, CategoryCounts, DiagramModel, ParseIssue, SidebarGroup } from '../../domain/diagram/model';
export { PumlViewer } from './PumlViewer';
export type { PumlViewerProps } from './PumlViewer';
export type { DiagramCanvasHandle } from './canvas/DiagramCanvas';
