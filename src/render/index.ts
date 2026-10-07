/** Public, Electron-independent API for the puml-viewer capability. */
export { buildTree, countByCategory } from '../core/classify';
export { parsePuml } from '../core/parser';
export type { Category, CategoryCounts, DiagramModel, ParseIssue, SidebarGroup } from '../core/model';
export { PumlViewer } from './PumlViewer';
export type { PumlViewerProps } from './PumlViewer';
export type { DiagramCanvasHandle } from './canvas/DiagramCanvas';
