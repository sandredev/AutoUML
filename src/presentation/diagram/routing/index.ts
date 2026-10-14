// src/presentation/diagram/routing/index.ts — API pública del motor de ruteo ortogonal y paquetes (puro, sin DOM/React).
export {
  BEND_PENALTY,
  CHANNEL_STEP,
  COLINEAR_OVERLAP_PENALTY,
  CROSS_PENALTY,
  EDGE_GAP,
  EPS,
  MIN_PORT_STEP,
  NEAR_BORDER_EPS,
  PKG_PAD,
  PKG_PADDING,
  PORT_CORNER_INSET,
  PORT_STUB,
  UTURN_PENALTY,
} from './constants';
export {
  clipToBox,
  distToBoxBorder,
  oppositeSide,
  pinCountForLength,
  type PinPair,
  pinsOnSide,
  type PortPin,
  type PortSide,
  rankSidePairs,
  type RectBox,
  selectPinOnSide,
  selectPinPair,
  sideNormal,
  snapPointToBoxBorder,
} from './ports';
export {
  type ChannelPushResult,
  fitPackageBoxes,
  openPackageChannels,
  packageBoxesFromModel,
} from './packageFit';
export { assignEdgeLanes, type LaneAssignment, SegmentOccupancy } from './channels';
export { buildHananGrid, collectObstaclesForEdge, type HananGrid, type ObstacleBox, ObstacleIndex, segmentHitsObstacle } from './graph';
export { nudgeEdges } from './nudge';
export {
  computeDiagramBounds,
  normalizeOrthoPolyline,
  rerouteAffectedEdges,
  routeAllEdges,
} from './router';
