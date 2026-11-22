import { fields, id, LIMITS, text } from './schema.ts';
import type { StudyStore } from './store.ts';
import { StudyError, type StudyArea } from './types.ts';
import { emptyConversation } from '../sessions/types.ts';

/** Which records a view shows: one space, or every record when null («Todos»). */
export type AreaFilter = string | null;

export const inArea = (record: { areaId: string | null }, filter: AreaFilter): boolean => filter === null || record.areaId === filter;

export interface AreasView { areas: StudyArea[]; activeAreaId: string | null }
export type MovableKind = 'unidad' | 'plan' | 'documento' | 'cuaderno';

export interface AreaService {
  view(): AreasView;
  /** The active space, or null for «Todos»; a missing or archived space reads as «Todos». */
  active(): StudyArea | null;
  activeId(): string | null;
  /** The space a conversation was started in, or the active one when it has none. */
  forChat(chatId: string): string | null;
  create(input: unknown): StudyArea;
  edit(input: unknown): StudyArea;
  activate(input: unknown): AreasView;
  /** Gives the active space everything that has none yet, conversations included. */
  adopt(chatIds: readonly string[]): { moved: number };
  /** Moves one record to a space; a plan takes its units with it. */
  move(input: unknown): { moved: number };
}

export function createAreaService(store: StudyStore, now: () => string, newId: () => string): AreaService {
  function existing(areaId: string): StudyArea {
    const area = store.getArea(areaId);
    if (!area) throw new StudyError('NOT_FOUND', 'El espacio no existe');
    return area;
  }

  function setActive(activeAreaId: string | null): void {
    const current = store.getPreferences();
    if ((current?.activeAreaId ?? null) === activeAreaId) return;
    store.savePreferences({ id: 'estudio', revision: (current?.revision ?? 0) + 1, activeAreaId }, current?.revision ?? null);
  }

  function active(): StudyArea | null {
    const areaId = store.getPreferences()?.activeAreaId ?? null;
    if (!areaId) return null;
    const area = store.getArea(areaId);
    return area && !area.archived ? area : null;
  }

  function target(value: unknown): string | null {
    if (value === null) return null;
    const area = existing(id(value, 'input.areaId'));
    if (area.archived) throw new StudyError('INVALID_TRANSITION', 'El espacio está archivado');
    return area.id;
  }

  return {
    view: () => ({ areas: store.listAreas().sort((a, b) => a.name.localeCompare(b.name, 'es')), activeAreaId: active()?.id ?? null }),
    active,
    activeId: () => active()?.id ?? null,

    forChat(chatId) {
      let areaId: string | null = null;
      try { areaId = store.getConversation(chatId)?.areaId ?? null; } catch { /* an unreadable record has no space */ }
      return areaId ?? active()?.id ?? null;
    },

    create(input) {
      const r = fields(input, ['name', 'description'], 'input');
      const name = text(r.name, LIMITS.areaName, 'input.name', { required: true }).trim();
      if (store.listAreas().some(a => a.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) throw new StudyError('CONFLICT', `Ya existe un espacio llamado «${name}»`);
      const at = now();
      const area = store.saveArea({
        id: newId(), revision: 1, name, description: r.description === undefined ? '' : text(r.description, LIMITS.areaDescription, 'input.description').trim(),
        archived: false, createdAt: at, updatedAt: at,
      }, null);
      setActive(area.id);
      return area;
    },

    edit(input) {
      const r = fields(input, ['id', 'expectedRevision', 'name', 'description', 'archived'], 'input');
      const area = existing(id(r.id, 'input.id'));
      if (!Number.isSafeInteger(r.expectedRevision)) throw new StudyError('INVALID_INPUT', 'expectedRevision must be an integer');
      const next: StudyArea = { ...area, revision: (r.expectedRevision as number) + 1, updatedAt: now() };
      if (r.name !== undefined) {
        next.name = text(r.name, LIMITS.areaName, 'input.name', { required: true }).trim();
        if (store.listAreas().some(a => a.id !== area.id && a.name.toLocaleLowerCase('es') === next.name.toLocaleLowerCase('es'))) throw new StudyError('CONFLICT', `Ya existe un espacio llamado «${next.name}»`);
      }
      if (r.description !== undefined) next.description = text(r.description, LIMITS.areaDescription, 'input.description').trim();
      if (r.archived !== undefined) {
        if (typeof r.archived !== 'boolean') throw new StudyError('INVALID_INPUT', 'archived must be a boolean');
        next.archived = r.archived;
      }
      const saved = store.saveArea(next, r.expectedRevision as number);
      if (saved.archived && store.getPreferences()?.activeAreaId === saved.id) setActive(null);
      return saved;
    },

    activate(input) {
      const r = fields(input, ['areaId'], 'input');
      setActive(target(r.areaId ?? null));
      return { areas: store.listAreas().sort((a, b) => a.name.localeCompare(b.name, 'es')), activeAreaId: active()?.id ?? null };
    },

    adopt(chatIds) {
      const areaId = active()?.id;
      if (!areaId) throw new StudyError('INVALID_TRANSITION', 'Elige primero un espacio');
      const at = now();
      let moved = 0;
      for (const u of store.listUnits()) if (u.areaId === null) { store.saveUnit({ ...u, areaId, revision: u.revision + 1, updatedAt: at }, u.revision); moved++; }
      for (const p of store.listPlans()) if (p.areaId === null) { store.savePlan({ ...p, areaId, revision: p.revision + 1, updatedAt: at }, p.revision); moved++; }
      for (const d of store.listDocuments()) if (d.areaId === null) { store.saveDocument({ ...d, areaId, revision: d.revision + 1 }, d.revision); moved++; }
      for (const n of store.listNotebooks()) if (n.areaId === null) { store.saveNotebook({ ...n, areaId, revision: n.revision + 1 }, n.revision); moved++; }
      // Conversations older than the plugin's record of them get one now, holding only their space.
      for (const chatId of chatIds) {
        const c = store.getConversation(chatId);
        if (c && c.areaId !== null) continue;
        const base = c ?? emptyConversation(chatId);
        store.saveConversation({ ...base, areaId, revision: base.revision + 1 }, c?.revision ?? null);
        moved++;
      }
      return { moved };
    },

    move(input) {
      const r = fields(input, ['kind', 'id', 'areaId'], 'input');
      const areaId = target(r.areaId ?? null);
      const recordId = id(r.id, 'input.id');
      const at = now();
      if (r.kind === 'unidad') {
        const u = store.getUnit(recordId);
        if (!u) throw new StudyError('NOT_FOUND', 'La unidad no existe');
        if (u.areaId !== areaId) store.saveUnit({ ...u, areaId, revision: u.revision + 1, updatedAt: at }, u.revision);
        return { moved: 1 };
      }
      if (r.kind === 'plan') {
        const p = store.getPlan(recordId);
        if (!p) throw new StudyError('NOT_FOUND', 'El plan no existe');
        let moved = 1;
        if (p.areaId !== areaId) store.savePlan({ ...p, areaId, revision: p.revision + 1, updatedAt: at }, p.revision);
        for (const unitId of p.unitIds) {
          const u = store.getUnit(unitId);
          if (u && u.areaId !== areaId) { store.saveUnit({ ...u, areaId, revision: u.revision + 1, updatedAt: at }, u.revision); moved++; }
        }
        return { moved };
      }
      if (r.kind === 'documento') {
        const d = store.getDocument(recordId);
        if (!d) throw new StudyError('NOT_FOUND', 'El documento no existe');
        if (d.areaId !== areaId) store.saveDocument({ ...d, areaId, revision: d.revision + 1 }, d.revision);
        return { moved: 1 };
      }
      if (r.kind === 'cuaderno') {
        const n = store.getNotebook(recordId);
        if (!n) throw new StudyError('NOT_FOUND', 'El cuaderno no existe');
        if (n.areaId !== areaId) store.saveNotebook({ ...n, areaId, revision: n.revision + 1 }, n.revision);
        return { moved: 1 };
      }
      throw new StudyError('INVALID_INPUT', 'kind must be unidad, plan, documento or cuaderno');
    },
  };
}
