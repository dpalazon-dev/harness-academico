import type { PluginToolContext, PluginTools } from 'learnharness-plugin-api';
import type { StudyOperations } from './operations.ts';
import type { KbService } from './kb/service.ts';
import type { SearchResult } from './kb/search.ts';
import { StudyError } from './study/types.ts';

type AgentTool = ReturnType<PluginTools['create']>[number];
type ToolResult = Awaited<ReturnType<AgentTool['execute']>>;

const UNIT_KIND = { type: 'string', enum: ['concepto', 'procedimiento', 'argumento', 'modelo'] };
const UNIT_POLICY = { type: 'string', enum: ['recordar', 'reconstruir', 'ejecutar', 'localizar'] };
const PLAN_OP = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['add', 'remove', 'move'] },
    unitId: { type: 'string' },
    index: { type: 'integer', minimum: 0 },
  },
  required: ['op', 'unitId'],
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
  const plan = ops.currentPlan(filter);
  const { units, proposals } = ops.state(filter);
  const byId = new Map(units.map(u => [u.id, u]));
  const line = (id: string) => {
    const u = byId.get(id);
    return u ? `- [${u.id}] ${u.title} (${u.status}${u.policy ? `, ${u.policy}` : ''})${u.capability ? `: ${u.capability}` : ''}` : `- [${id}] (missing unit)`;
  };
  const parts: string[] = [];
  parts.push(plan ? `Plan [${plan.id}] goal: ${plan.goal}\n${plan.unitIds.length ? plan.unitIds.map(line).join('\n') : '(no units yet)'}` : 'No study plan yet.');
  const loose = units.filter(u => u.status !== 'archivada' && !plan?.unitIds.includes(u.id));
  if (loose.length) parts.push(`Units not in the plan:\n${loose.map(u => line(u.id)).join('\n')}`);
  const open = proposals.filter(p => p.status === 'pendiente');
  if (open.length) parts.push(`Pending proposals awaiting the learner:\n${open.map(p => `- [${p.id}] ${p.ops.map(o => `${o.op} ${o.unitId}`).join(', ')}${p.rationale ? ` — ${p.rationale}` : ''}`).join('\n')}`);
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
      description: "Read the learner's persistent study plan: goal, ordered units with their status, units outside the plan and pending proposals.",
      parameters: { type: 'object', properties: {}, additionalProperties: false } as never,
      execute: async (_id, _input, signal) => { guard(signal); return ok(describeState(ops, area()), { chatId: context.chatId }); },
    },
    {
      name: 'estudio_proponer_unidad', label: 'Propose study unit',
      description: 'Propose a new study unit: a capability the learner should be able to perform. It stays a proposal until the learner confirms it.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          capability: { type: 'string', maxLength: 4000, description: 'What the learner should be able to do, e.g. "explain why the derivative is a limit".' },
          criterion: { type: 'string', maxLength: 4000, description: 'Observable performance that would show the capability, after an interval and without help.' },
          kind: UNIT_KIND, policy: UNIT_POLICY,
        },
        required: ['title', 'capability', 'criterion'],
        additionalProperties: false,
      } as never,
      execute: async (_id, input, signal) => {
        guard(signal);
        try {
          const unit = ops.createUnit(input, { kind: 'tutor', chatId: context.chatId }, 'propuesta', area());
          return ok(`Proposed unit [${unit.id}] "${unit.title}". The learner will confirm or archive it.`, { ok: true, unitId: unit.id });
        } catch (error) { return refused(error); }
      },
    },
    {
      name: 'estudio_proponer_plan', label: 'Propose plan change',
      description: 'Propose adding, removing or reordering units in the study plan. Nothing changes until the learner applies the proposal. Give a goal only when no plan exists yet.',
      parameters: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          goal: { type: 'string', maxLength: 4000 },
          ops: { type: 'array', minItems: 1, maxItems: 100, items: PLAN_OP },
          rationale: { type: 'string', maxLength: 4000 },
        },
        required: ['ops', 'rationale'],
        additionalProperties: false,
      } as never,
      execute: async (_id, input, signal) => {
        guard(signal);
        try {
          const proposal = ops.proposePlanChange(input, 'tutor', area());
          return ok(`Proposal [${proposal.id}] recorded for plan [${proposal.planId}]. It waits for the learner.`, { ok: true, proposalId: proposal.id });
        } catch (error) { return refused(error); }
      },
    },
    ...kbTools,
    ...searchTools,
    ...(cierre ? [{
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
