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
}

/** An ordered list of units towards a goal. Dates come from the regulator, never from the plan. */
export interface StudyPlan {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  goal: string;
  unitIds: string[];
  archived: boolean;
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

export type PlanOp =
  | { op: 'add'; unitId: string; index?: number }
  | { op: 'remove'; unitId: string }
  | { op: 'move'; unitId: string; index: number };

export type ProposalStatus = 'pendiente' | 'aplicada' | 'rechazada' | 'obsoleta';

/** A change to a plan's structure; only David's confirmation applies it. */
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
