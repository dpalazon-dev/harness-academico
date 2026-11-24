import type { PluginToolContext, PluginTools } from 'learnharness-plugin-api';
import type { StudyOperations } from './operations.ts';
import type { KbService } from './kb/service.ts';
import type { SearchResult } from './kb/search.ts';
import { StudyError } from './study/types.ts';

type AgentTool = ReturnType<PluginTools['create']>[number];
type ToolResult = Awaited<ReturnType<AgentTool['execute']>>;

const ELEMENT_TYPE = { type: 'string', enum: ['tema', 'tarea', 'hito'], description: 'tema: something to learn; tarea: something to do (read chapter 3, solve exercise X); hito: a checkpoint or deadline.' };
const ELEMENT = {
  type: 'object',
  properties: {
    tipo: ELEMENT_TYPE,
    titulo: { type: 'string', minLength: 1, maxLength: 500, description: 'One short line, in Spanish.' },
    fecha: { type: 'string', description: 'Only on a hito, when the learner gave a date: YYYY-MM-DD.' },
  },
  required: ['tipo', 'titulo'],
  additionalProperties: false,
};
const PLAN_OP = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['add', 'remove', 'move'] },
    tipo: ELEMENT_TYPE,
    titulo: { type: 'string', maxLength: 500, description: 'For add.' },
    fecha: { type: 'string', description: 'For add of a hito: YYYY-MM-DD.' },
    elementoId: { type: 'string', description: 'For remove and move.' },
    index: { type: 'integer', minimum: 0, description: 'Position (0-based); for add it is optional and defaults to the end.' },
  },
  required: ['op'],
  additionalProperties: false,
};

function ok(text: string, details: unknown): ToolResult {
  return { content: [{ type: 'text', text }], details };
}

function refused(error: unknown): ToolResult {
  if (error instanceof StudyError) return { content: [{ type: 'text', text: `Refused: ${error.message}` }], details: { ok: false, code: error.code }, isError: true } as ToolResult;
  throw error;
}

export function describeState(ops: StudyOperations, filter: string | null = null): string {
  const plans = ops.plans(filter);
  const { units, proposals } = ops.state(filter);
  const byId = new Map(units.map(u => [u.id, u]));
  const linked = new Set(ops.plans(null).flatMap(p => p.elementos.flatMap(e => (e.unitId ? [e.unitId] : []))));
  const parts: string[] = [];
  if (plans.length === 0) parts.push('No study plan yet.');
  for (const plan of plans) {
    const lines = plan.elementos.map(e => {
      const u = e.unitId ? byId.get(e.unitId) : undefined;
      return `- [${e.id}] ${e.tipo}: ${e.titulo}${e.fecha ? ` (${e.fecha})` : ''}${e.hecho ? ' (done)' : ''}${u ? ` → unit [${u.id}] (${u.status})${u.capability ? `: ${u.capability}` : ''}` : ''}`;
    });
    parts.push(`Plan [${plan.id}] (${plan.estado === 'propuesto' ? 'proposed, awaiting the learner' : 'active'}) goal: ${plan.goal}\n${lines.length ? lines.join('\n') : '(no elements yet)'}`);
  }
  const loose = units.filter(u => u.status === 'activa' && !linked.has(u.id));
  if (loose.length) parts.push(`Units not in any plan:\n${loose.map(u => `- [${u.id}] ${u.title}${u.capability ? `: ${u.capability}` : ''}`).join('\n')}`);
  const open = proposals.filter(p => p.status === 'pendiente');
  if (open.length) {
    parts.push(`Pending plan changes awaiting the learner:\n${open.map(p => `- [${p.id}] on plan [${p.planId}]: ${p.ops.map(o => (o.op === 'add' ? `add ${o.tipo} "${o.titulo}"` : `${o.op} ${o.elementoId}`)).join(', ')}${p.rationale ? ` — ${p.rationale}` : ''}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** Records a block closing (ADR 0004) on a unit; `unidad` is the unit the conversation was opened about. */
export interface CierreBloque { registrar(unitId: string, chatId: string): void; unidad(): string | null }

/** `area` is the conversation's space (or the active one): the plan the tutor reads and what it proposes belong to it. */
export function createStudyTools(ops: StudyOperations, context: PluginToolContext, active: () => void, kb?: KbService, searchKb?: (input: unknown) => SearchResult,
  area: () => string | null = () => null, cierre?: CierreBloque): AgentTool[] {
  const guard = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('Cancelled'); active(); };
  const searchTools: AgentTool[] = searchKb ? [{
    name: 'estudio_buscar', label: 'Search study knowledge',
    description: "Search the learner's knowledge base (confirmed claims, entities, questions, syntheses) and the text of incorporated papers. Returns hits with their page locator, related records one hop away, and what was covered. Use it before teaching or proposing claims about a paper.",
    parameters: { type: 'object', properties: { consulta: { type: 'string', maxLength: 1000 }, entidad: { type: 'string', description: 'Entity id to restrict to.' }, tipos: { type: 'array', items: { type: 'string' } }, k: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false } as never,
    execute: async (_id, input, signal) => {
      guard(signal);
      try {
        const r = searchKb(input);
        const line = (h: SearchResult['hits'][number]) => `- [${h.id}] (${h.kind}${h.locator ? `, ${h.locator}` : ''}${h.via ? `, via ${h.via}` : ''}) ${h.title}: ${h.snippet}`;
        const parts = [r.vacio === 'base_vacia' ? 'The knowledge base and paper index are empty.' : r.vacio === 'sin_coincidencias' ? 'No matches.' : r.vacio === 'consulta_vacia' ? 'The query has only stopwords; use content words.' : r.hits.map(line).join('\n')];
        if (r.relacionados.length) parts.push(`Related:\n${r.relacionados.map(line).join('\n')}`);
        parts.push(`Coverage: ${r.cobertura.registros} records, ${r.cobertura.secciones} source sections, ${r.cobertura.conversaciones} past conversations, ${r.cobertura.notas ?? 0} of his notebooks, ${r.cobertura.coincidencias} matches${r.cobertura.truncado ? ' (truncated)' : ''}${r.cobertura.documentosNoListos ? `, ${r.cobertura.documentosNoListos} sources not searchable yet` : ''}.`);
        return ok(parts.join('\n\n'), { ok: true, hits: r.hits.length });
      } catch (error) { return refused(error); }
    },
  }] : [];
  const kbTools: AgentTool[] = kb ? [{
    name: 'estudio_proponer_hecho', label: 'Propose a paper claim',
    description: 'Propose a claim made by an incorporated paper, with the literal quote and its physical page. The quote is verified against the page; the claim waits as a draft until the learner confirms it into the knowledge base.',
    parameters: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
        page: { type: 'integer', minimum: 1 },
        quote: { type: 'string', minLength: 1, maxLength: 2000, description: 'Exact text as it appears on that page.' },
        afirmacion: { type: 'string', minLength: 1, maxLength: 4000, description: 'What the paper claims, in Spanish, with its conditions.' },
        titulo: { type: 'string', maxLength: 300 },
        fecha: { type: 'string', description: 'Publication date of the paper: YYYY, YYYY-MM or YYYY-MM-DD.' },
        entidades: { type: 'array', maxItems: 20, description: 'Entities the claim is about. Give `id` to reuse a known entity, or `nombre` (an existing name or alias is reused; a new one needs `clase_entidad`, default concepto).', items: { type: 'object', properties: { id: { type: 'string' }, nombre: { type: 'string' }, clase_entidad: { type: 'string', enum: ['tarea', 'metodo', 'dataset', 'metrica', 'concepto', 'familia_modelo'] }, alias: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
      },
      required: ['documentId', 'page', 'quote', 'afirmacion'],
      additionalProperties: false,
    } as never,
    execute: async (_id, input, signal) => {
      guard(signal);
      try {
        const draft = await kb.captureFact(input, 'tutor');
        return ok(`Claim drafted (${draft.id}). It waits for the learner to confirm it.`, { ok: true, draftId: draft.id });
      } catch (error) { return refused(error); }
    },
  }] : [];
  return [
    {
      name: 'estudio_estado', label: 'Study plan',
      description: "Read the learner's study plans in this space (proposed and active, each with its elements and the units linked to its temas), units not in any plan and pending plan changes.",
      parameters: { type: 'object', properties: {}, additionalProperties: false } as never,
      execute: async (_id, _input, signal) => { guard(signal); return ok(describeState(ops, area()), { chatId: context.chatId }); },
    },
    {
      name: 'estudio_proponer_plan', label: 'Propose study plan',
      description: 'Propose a whole new study plan in one call: a goal and a short flat list of elements (temas to learn, tareas to do, hitos as checkpoints). It stays proposed until the learner accepts or discards it. It creates no study units: the learner turns a tema into a unit when he decides to work on it.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', minLength: 1, maxLength: 4000, description: 'What the learner wants to achieve, in his words where possible.' },
          elementos: { type: 'array', minItems: 1, maxItems: 100, items: ELEMENT },
        },
        required: ['goal', 'elementos'],
        additionalProperties: false,
      } as never,
      execute: async (_id, input, signal) => {
        guard(signal);
        try {
          const plan = ops.proposePlan(input, context.chatId, area());
          return ok(`Proposed plan [${plan.id}] with ${plan.elementos.length} elements. The learner will accept or discard it.`, { ok: true, planId: plan.id });
        } catch (error) { return refused(error); }
      },
    },
    {
      name: 'estudio_cambiar_plan', label: 'Propose plan change',
      description: 'Propose adding, removing or reordering elements of an active study plan. Nothing changes until the learner applies the proposal.',
      parameters: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          ops: { type: 'array', minItems: 1, maxItems: 100, items: PLAN_OP },
          rationale: { type: 'string', maxLength: 4000 },
        },
        required: ['planId', 'ops', 'rationale'],
        additionalProperties: false,
      } as never,
      execute: async (_id, input, signal) => {
        guard(signal);
        try {
          const proposal = ops.proposePlanChange(input);
          return ok(`Proposal [${proposal.id}] recorded for plan [${proposal.planId}]. It waits for the learner.`, { ok: true, proposalId: proposal.id });
        } catch (error) { return refused(error); }
      },
    },
    ...kbTools,
    ...searchTools,
    ...(cierre ? [{
      name: 'estudio_proponer_capacidad', label: 'Suggest capability and criterion',
      description: "Suggest the capability (what the learner should be able to do) and the criterion (observable performance that would show it, after an interval and without help) of a study unit. It waits on the unit until the learner accepts or discards it; a new suggestion replaces the previous one. Without unitId it applies to the unit this conversation was opened about.",
      parameters: {
        type: 'object',
        properties: {
          capability: { type: 'string', minLength: 1, maxLength: 4000, description: 'E.g. "explain why the derivative is a limit".' },
          criterion: { type: 'string', minLength: 1, maxLength: 4000 },
          unitId: { type: 'string' },
        },
        required: ['capability', 'criterion'],
        additionalProperties: false,
      } as never,
      execute: async (_id: string, input: unknown, signal?: AbortSignal) => {
        guard(signal);
        const { unitId: given, ...rest } = (input ?? {}) as { unitId?: unknown };
        const unitId = given ?? cierre.unidad();
        if (typeof unitId !== 'string') return refused(new StudyError('INVALID_INPUT', 'This conversation is not about a unit: give its unitId'));
        try {
          ops.suggestCapability(unitId, rest, context.chatId);
          return ok('Suggestion recorded on the unit. The learner will accept or discard it.', { ok: true, unitId });
        } catch (error) { return refused(error); }
      },
    } as AgentTool, {
      name: 'estudio_cerrar_bloque', label: 'Record block closing',
      description: "Record on a study unit that a work block was closed: his reconstruction without looking, your contrast, his repair and his line of change (Δ) and doubts (?). Call it once, after he gave that line. Without unitId it records it on the unit this conversation was opened about.",
      parameters: { type: 'object', properties: { unitId: { type: 'string' } }, additionalProperties: false } as never,
      execute: async (_id: string, input: unknown, signal?: AbortSignal) => {
        guard(signal);
        const unitId = (input as { unitId?: unknown } | null)?.unitId ?? cierre.unidad();
        if (typeof unitId !== 'string') return refused(new StudyError('INVALID_INPUT', 'This conversation is not about a unit: give its unitId'));
        try {
          cierre.registrar(unitId, context.chatId);
          return ok('Block closing recorded on the unit.', { ok: true, unitId });
        } catch (error) { return refused(error); }
      },
    } as AgentTool] : []),
  ];
}
