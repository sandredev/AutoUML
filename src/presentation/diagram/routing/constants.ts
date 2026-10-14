// src/presentation/diagram/routing/constants.ts — constantes canónicas de ruteo ortogonal y paquetes (puro, sin DOM/React).

/** Margen estricto de paquete: arriba deja espacio para la pestaña del nombre. */
export const PKG_PAD = { top: 30, left: 16, bottom: 16, right: 16 } as const;

/** Formato ELK equivalente a PKG_PAD. */
export const PKG_PADDING = '[top=30,left=16,bottom=16,right=16]';

/** Inflado de obstáculos (NodeBox, PackageBox, NoteBox) para reservar canal libre. */
export const EDGE_GAP = 10;

/** Costes del A* Manhattan (ortho-router). */
export const BEND_PENALTY = 12;
export const CROSS_PENALTY = 50;
export const UTURN_PENALTY = 36;
/** Castigo suave en A*: evita solapes colineales sin causar rodeos gigantes. */
export const COLINEAR_OVERLAP_PENALTY = 500;

/** Separación transversal entre carriles de aristas paralelas o antiparalelas (a->b y b->a). */
export const CHANNEL_STEP = 10;

/** Margen desde la esquina de una tarjeta para colocar pins de puertos. */
export const PORT_CORNER_INSET = 24;

/** Separación mínima entre pins candidatos de una misma cara. */
export const MIN_PORT_STEP = 16;

/** Longitud mínima del tramo perpendicular de salida/entrada a un puerto (stub). */
export const PORT_STUB = 20;

/** Tolerancia geométrica canónica (geometry-tdd). */
export const EPS = 0.01;

/** Distancia mínima al borde real de un obstáculo ajeno (geometry-tdd nearBorder). */
export const NEAR_BORDER_EPS = 2;