import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { openStudyStore, type StudyStore } from '../src/study/store.ts';
import type { ElementoPlan, PlanProposal, StudyPlan, StudyUnit } from '../src/study/types.ts';

export const NOW = '2026-11-11T10:00:00.000Z';
export const LATER = '2026-11-11T11:00:00.000Z';

export function tempStore(t: TestContext): StudyStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-study-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return openStudyStore(root);
}

export function unit(overrides: Partial<StudyUnit> = {}): StudyUnit {
  return {
    id: 'u1', revision: 1, createdAt: NOW, updatedAt: NOW, status: 'activa', title: 'Derivada como límite',
    capability: 'Explicar por qué la derivada es un límite', criterion: 'Lo explico sin mirar', kind: 'concepto',
    policy: 'reconstruir', graphNodeIds: [], sources: [], checkIds: [], origin: { kind: 'manual' }, notes: '', areaId: null,
    ...overrides,
  };
}

export function plan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return { id: 'p1', revision: 1, createdAt: NOW, updatedAt: NOW, goal: 'Cálculo diferencial', estado: 'activo', elementos: [], origen: 'manual', areaId: null, ...overrides };
}

/** A tema; with `unitId` it is linked to that unit. */
export function tema(id: string, overrides: Partial<ElementoPlan> = {}): ElementoPlan {
  return { id, tipo: 'tema', titulo: `Tema ${id}`, hecho: false, ...overrides };
}

export function proposal(overrides: Partial<PlanProposal> = {}): PlanProposal {
  return {
    id: 'q1', revision: 1, planId: 'p1', baseRevision: 1, ops: [{ op: 'add', tipo: 'tema', titulo: 'Límites' }], rationale: 'Base necesaria',
    author: 'tutor', status: 'pendiente', createdAt: NOW, ...overrides,
  };
}
