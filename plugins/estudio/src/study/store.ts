import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArea, parsePlan, parsePreferences, parseProposal, parseUnit } from './schema.ts';
import { StudyError, type PlanProposal, type StudyArea, type StudyPlan, type StudyPreferences, type StudyUnit } from './types.ts';
import { parseAttempt, parseExposures, parseTask } from '../practice/schema.ts';
import type { PracticeAttempt, PracticeTask, UnitExposures } from '../practice/types.ts';
import { parseDocument } from '../documents/schema.ts';
import type { StudyDocument } from '../documents/types.ts';
import { parseDraft, type KbDraft } from '../kb/drafts.ts';
import { parseConversation, type ConversationRecord } from '../sessions/types.ts';
import { parseNotebook, type Notebook } from '../notebooks/types.ts';
import { parseHechos, type HechosUnidad } from './hechos.ts';

const COLLECTIONS = ['units', 'plans', 'proposals', 'tasks', 'attempts', 'exposures', 'documents', 'kbDrafts', 'conversations', 'notebooks', 'areas', 'preferences', 'hechos'] as const;
type Collection = typeof COLLECTIONS[number];
type Versioned = { id: string; revision: number };

const RECORD_FILE = /^[A-Za-z0-9_-]{1,128}\.json$/;

export interface StudyStore {
  readonly root: string;
  getUnit(id: string): StudyUnit | null;
  listUnits(): StudyUnit[];
  saveUnit(unit: StudyUnit, expectedRevision: number | null): StudyUnit;
  getPlan(id: string): StudyPlan | null;
  listPlans(): StudyPlan[];
  savePlan(plan: StudyPlan, expectedRevision: number | null): StudyPlan;
  /** Moves a discarded plan to `plans/.papelera`. */
  trashPlan(id: string, expectedRevision: number): void;
  getProposal(id: string): PlanProposal | null;
  listProposals(planId?: string): PlanProposal[];
  saveProposal(proposal: PlanProposal, expectedRevision: number | null): PlanProposal;
  getTask(id: string): PracticeTask | null;
  listTasks(unitId?: string): PracticeTask[];
  saveTask(task: PracticeTask, expectedRevision: number | null): PracticeTask;
  getAttempt(id: string): PracticeAttempt | null;
  listAttempts(unitId?: string): PracticeAttempt[];
  saveAttempt(attempt: PracticeAttempt, expectedRevision: number | null): PracticeAttempt;
  /** Exposure log of a unit, keyed by the unit id. */
  getExposures(unitId: string): UnitExposures | null;
  saveExposures(exposures: UnitExposures, expectedRevision: number | null): UnitExposures;
  getDocument(id: string): StudyDocument | null;
  listDocuments(): StudyDocument[];
  saveDocument(document: StudyDocument, expectedRevision: number | null): StudyDocument;
  /** Moves a document record to `documents/.papelera`. */
  trashDocument(id: string, expectedRevision: number): void;
  getDraft(id: string): KbDraft | null;
  listDrafts(): KbDraft[];
  saveDraft(draft: KbDraft, expectedRevision: number | null): KbDraft;
  /** The plugin's record of a native conversation, keyed by its chat id. */
  getConversation(chatId: string): ConversationRecord | null;
  listConversations(): ConversationRecord[];
  saveConversation(conversation: ConversationRecord, expectedRevision: number | null): ConversationRecord;
  /** Moves the record of a deleted conversation to `conversations/.papelera`, with its space and unit. */
  trashConversation(chatId: string, expectedRevision: number): void;
  getNotebook(id: string): Notebook | null;
  listNotebooks(): Notebook[];
  saveNotebook(notebook: Notebook, expectedRevision: number | null): Notebook;
  /** Moves a notebook to `notebooks/.papelera`: removed from the app, still recoverable by hand. */
  trashNotebook(id: string, expectedRevision: number): void;
  getArea(id: string): StudyArea | null;
  listAreas(): StudyArea[];
  saveArea(area: StudyArea, expectedRevision: number | null): StudyArea;
  /** Hechos del ciclo de una unidad, por su id; null si no tiene ninguno. */
  getHechos(unitId: string): HechosUnidad | null;
  saveHechos(hechos: HechosUnidad, expectedRevision: number | null): HechosUnidad;
  getPreferences(): StudyPreferences | null;
  savePreferences(preferences: StudyPreferences, expectedRevision: number | null): StudyPreferences;
}

/** One JSON file per record, written atomically. Single-process, so revisions guard against stale writers. */
export function openStudyStore(root: string): StudyStore {
  for (const collection of COLLECTIONS) fs.mkdirSync(path.join(root, collection), { recursive: true });

  function file(collection: Collection, id: string): string {
    return path.join(root, collection, `${id}.json`);
  }

  function read<T>(collection: Collection, id: string, parse: (v: unknown) => T): T | null {
    let raw: string;
    try { raw = fs.readFileSync(file(collection, id), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try { return parse(JSON.parse(raw)); }
    catch (error) { throw new StudyError('CORRUPT_DATA', `${collection}/${id}.json is unreadable: ${(error as Error).message}`); }
  }

  /** Shown as is in the views, so in Spanish and without storage paths. */
  const CONFLICT = 'Esto cambió mientras tanto: vuelve a cargarlo e inténtalo de nuevo';

  /** Removed from the app, kept on disk: `<collection>/.papelera/<id>-<ms>.json`. */
  function trash<T extends Versioned>(collection: Collection, id: string, expected: number, parse: (v: unknown) => T): void {
    const current = read(collection, id, parse);
    if (!current) throw new StudyError('NOT_FOUND', `${collection}/${id} no existe`);
    if (current.revision !== expected) throw new StudyError('CONFLICT', CONFLICT);
    const bin = path.join(root, collection, '.papelera');
    fs.mkdirSync(bin, { recursive: true });
    fs.renameSync(file(collection, id), path.join(bin, `${id}-${Date.now()}.json`));
  }

  /** Lists valid records; temporary files are skipped and a corrupt record does not hide the rest. */
  function list<T>(collection: Collection, parse: (v: unknown) => T): T[] {
    const records: T[] = [];
    for (const name of fs.readdirSync(path.join(root, collection)).sort()) {
      if (!RECORD_FILE.test(name)) continue;
      try { const record = read(collection, name.slice(0, -5), parse); if (record) records.push(record); }
      catch (error) { if (!(error instanceof StudyError && error.code === 'CORRUPT_DATA')) throw error; }
    }
    return records;
  }

  function save<T extends Versioned>(collection: Collection, record: T, expectedRevision: number | null, parse: (v: unknown) => T): T {
    const valid = parse(record);
    const current = read(collection, valid.id, parse);
    if ((current?.revision ?? null) !== expectedRevision) {
      throw new StudyError('CONFLICT', CONFLICT);
    }
    if (valid.revision !== (expectedRevision ?? 0) + 1) throw new StudyError('INVALID_INPUT', `${collection}/${valid.id} must be saved with revision ${(expectedRevision ?? 0) + 1}`);
    const target = file(collection, valid.id);
    const temporary = path.join(root, collection, `.${valid.id}-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(valid, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, target);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    return structuredClone(valid);
  }

  return {
    root,
    getUnit: id => read('units', id, parseUnit),
    listUnits: () => list('units', parseUnit),
    saveUnit: (unit, expected) => save('units', unit, expected, parseUnit),
    getPlan: id => read('plans', id, parsePlan),
    listPlans: () => list('plans', parsePlan),
    savePlan: (plan, expected) => save('plans', plan, expected, parsePlan),
    trashPlan: (id, expected) => trash('plans', id, expected, parsePlan),
    getProposal: id => read('proposals', id, parseProposal),
    listProposals: planId => list('proposals', parseProposal).filter(p => planId === undefined || p.planId === planId),
    saveProposal: (proposal, expected) => save('proposals', proposal, expected, parseProposal),
    getTask: id => read('tasks', id, parseTask),
    listTasks: unitId => list('tasks', parseTask).filter(t => unitId === undefined || t.unitId === unitId),
    saveTask: (task, expected) => save('tasks', task, expected, parseTask),
    getAttempt: id => read('attempts', id, parseAttempt),
    listAttempts: unitId => list('attempts', parseAttempt).filter(a => unitId === undefined || a.unitId === unitId),
    saveAttempt: (attempt, expected) => save('attempts', attempt, expected, parseAttempt),
    getExposures: unitId => read('exposures', unitId, parseExposures),
    saveExposures: (exposures, expected) => save('exposures', exposures, expected, parseExposures),
    getDocument: id => read('documents', id, parseDocument),
    listDocuments: () => list('documents', parseDocument),
    saveDocument: (document, expected) => save('documents', document, expected, parseDocument),
    getDraft: id => read('kbDrafts', id, parseDraft),
    listDrafts: () => list('kbDrafts', parseDraft),
    saveDraft: (draft, expected) => save('kbDrafts', draft, expected, parseDraft),
    getConversation: id => read('conversations', id, parseConversation),
    listConversations: () => list('conversations', parseConversation),
    saveConversation: (conversation, expected) => save('conversations', conversation, expected, parseConversation),
    trashConversation: (id, expected) => trash('conversations', id, expected, parseConversation),
    getNotebook: id => read('notebooks', id, parseNotebook),
    listNotebooks: () => list('notebooks', parseNotebook),
    saveNotebook: (notebook, expected) => save('notebooks', notebook, expected, parseNotebook),
    trashNotebook: (id, expected) => trash('notebooks', id, expected, parseNotebook),
    trashDocument: (id, expected) => trash('documents', id, expected, parseDocument),
    getArea: id => read('areas', id, parseArea),
    listAreas: () => list('areas', parseArea),
    saveArea: (area, expected) => save('areas', area, expected, parseArea),
    getHechos: unitId => read('hechos', unitId, parseHechos),
    saveHechos: (hechos, expected) => save('hechos', hechos, expected, parseHechos),
    getPreferences: () => read('preferences', 'estudio', parsePreferences),
    savePreferences: (preferences, expected) => save('preferences', preferences, expected, parsePreferences),
  };
}
