export type UnitKind = 'concepto' | 'procedimiento' | 'argumento' | 'modelo';
export type UnitPolicy = 'recordar' | 'reconstruir' | 'ejecutar' | 'localizar';
export type UnitStatus = 'propuesta' | 'activa' | 'archivada';

export const UNIT_KINDS: readonly UnitKind[] = ['concepto', 'procedimiento', 'argumento', 'modelo'];
export const UNIT_POLICIES: readonly UnitPolicy[] = ['recordar', 'reconstruir', 'ejecutar', 'localizar'];
export const UNIT_STATUSES: readonly UnitStatus[] = ['propuesta', 'activa', 'archivada'];

export interface SourceRef { path: string; locator?: string }

export interface UnitOrigin {
  kind: 'sondeo' | 'manual' | 'tutor';
  chatId?: string;
  toolCallId?: string;
  strand?: string;
}

/** A capability David wants to be able to perform, not a single graph proposition. */
export interface StudyUnit {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status: UnitStatus;
  title: string;
  capability: string;
  criterion: string;
  kind: UnitKind | null;
  policy: UnitPolicy | null;
  graphNodeIds: string[];
  sources: SourceRef[];
  checkIds: string[];
  origin: UnitOrigin;
  notes: string;
  /** Space the unit belongs to; null when it belongs to none (records older than spaces read as null). */
  areaId: string | null;
  /** Capability and criterion the tutor suggested from a conversation about the unit; David accepts or discards it. */
  sugerencia?: SugerenciaUnidad;
}

export interface SugerenciaUnidad { capability: string; criterion: string; chatId: string; createdAt: string }

export type PlanEstado = 'propuesto' | 'activo' | 'archivado';
export type TipoElemento = 'tema' | 'tarea' | 'hito';
export const PLAN_ESTADOS: readonly PlanEstado[] = ['propuesto', 'activo', 'archivado'];
export const TIPOS_ELEMENTO: readonly TipoElemento[] = ['tema', 'tarea', 'hito'];

/** One line of a plan. A tema is what to learn and becomes a unit when David works on it; a tarea is something to do;
 * a hito is a checkpoint, with an optional date that is only shown (dates of reviews come from the regulator). */
export interface ElementoPlan {
  id: string;
  tipo: TipoElemento;
  titulo: string;
  /** Marked by David; the cycle of a linked unit never marks it. */
  hecho: boolean;
  /** Only on a tema: the unit created when David chose to work on it. */
  unitId?: string;
  /** Only on a hito: local date YYYY-MM-DD. */
  fecha?: string;
}

/** A goal with a flat, ordered list of light elements. A space may have several. */
export interface StudyPlan {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  goal: string;
  /** A plan the tutor drafted stays `propuesto` until David accepts or discards it whole. */
  estado: PlanEstado;
  elementos: ElementoPlan[];
  origen: 'tutor' | 'manual';
  /** Conversation where the tutor drafted it. */
  chatId?: string;
  areaId: string | null;
  /** Last proposal applied to this plan; tells an already-applied proposal from a stale one. */
  lastAppliedProposalId?: string;
}

/** A subject David studies: everything he creates while it is active belongs to it. */
export interface StudyArea {
  id: string;
  revision: number;
  name: string;
  description: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The plugin's own settings, one record. `activeAreaId` null means «Todos». */
export interface StudyPreferences {
  id: 'estudio';
  revision: number;
  activeAreaId: string | null;
}

/** A change to the elements of a plan. `add` creates a new element; its id is given when it is applied. */
export type PlanOp =
  | { op: 'add'; tipo: TipoElemento; titulo: string; fecha?: string; index?: number }
  | { op: 'remove'; elementoId: string }
  | { op: 'move'; elementoId: string; index: number };

/** David's own edits, applied at once: the proposal ops plus editing an element in place. `fecha: null` clears it. */
export type CambioPlan =
  | PlanOp
  | { op: 'edit'; elementoId: string; titulo?: string; hecho?: boolean; fecha?: string | null };

export type ProposalStatus = 'pendiente' | 'aplicada' | 'rechazada' | 'obsoleta';

/** A change the tutor suggests for an active plan; only David's confirmation applies it. */
export interface PlanProposal {
  id: string;
  revision: number;
  planId: string;
  baseRevision: number;
  ops: PlanOp[];
  rationale: string;
  author: 'tutor' | 'david';
  status: ProposalStatus;
  createdAt: string;
  decidedAt?: string;
}

export type StudyErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'CORRUPT_DATA' | 'INVALID_TRANSITION';

export class StudyError extends Error {
  readonly code: StudyErrorCode;
  constructor(code: StudyErrorCode, message: string) {
    super(message);
    this.name = 'StudyError';
    this.code = code;
  }
}
