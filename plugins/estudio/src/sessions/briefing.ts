import type { ConversationSummary } from './types.ts';

export interface BriefingInput {
  /** The space David is studying in; null when he works across all of them. */
  area: { name: string; description: string } | null;
  plan: { goal: string; units: string[] } | null;
  outsidePlan: string[];
  due: { title: string; taskKind: string; lastFailure: string | null; needsVerification: boolean }[];
  openAttempts: number;
  recent: { title: string; taskKind: string; fidelity: number | null; failureType: string | null; at: string }[];
  questions: string[];
  drafts: number;
  previous: { date: string; title: string; summary: ConversationSummary | null }[];
  /** No cheap model: previous conversations come without summaries. */
  summariesOff: boolean;
}

/** About 1,500 tokens: the briefing orients, `estudio_estado` and `estudio_buscar` give the detail. */
export const BRIEFING_MAX = 6000;
const PER_LIST = 8;

const bullets = (items: string[], max = PER_LIST) => [
  ...items.slice(0, max).map(x => `- ${x}`),
  ...(items.length > max ? [`- … y ${items.length - max} más`] : []),
];

/** The learner's situation when a conversation starts, in the prompt's language; record content stays as written. */
export function composeBriefing(input: BriefingInput): string {
  const out: string[] = [
    '## Where the learner left off',
    'Snapshot taken when this conversation started; it does not change during it. Call estudio_estado for the current state.',
  ];
  if (input.area) {
    out.push('', `Study space: «${input.area.name}»${input.area.description ? ` (${input.area.description})` : ''}. Plan, units, reviews and previous conversations below belong to this space only; the knowledge base search covers every space.`);
  }
  if (input.plan) {
    out.push('', `Study plan, goal: ${input.plan.goal}`, ...(input.plan.units.length ? bullets(input.plan.units, 12) : ['- (no units yet)']));
  } else out.push('', 'No study plan yet.');
  if (input.outsidePlan.length) out.push('', 'Active units outside the plan:', ...bullets(input.outsidePlan));

  if (input.due.length || input.openAttempts) {
    out.push('', `Due today: ${input.due.length} task(s)${input.openAttempts ? `, ${input.openAttempts} attempt(s) left unfinished` : ''}.`,
      ...bullets(input.due.map(d => `${d.title}: ${d.taskKind}${d.lastFailure ? `, last failure ${d.lastFailure}` : ''}${d.needsVerification ? ', needs verification' : ''}`)));
  } else out.push('', 'Nothing due today.');

  if (input.recent.length) {
    out.push('', 'Recent graded attempts (fidelity 0–3, as the learner judged it):',
      ...bullets(input.recent.map(r => `${r.at.slice(0, 10)} ${r.title}: ${r.taskKind}, fidelity ${r.fidelity ?? '?'}${r.failureType ? `, failure ${r.failureType}` : ''}`)));
  }
  if (input.questions.length) out.push('', 'Open questions in the knowledge base:', ...bullets(input.questions));
  if (input.drafts) out.push('', `${input.drafts} knowledge draft(s) wait for the learner's confirmation.`);

  if (input.previous.length) {
    out.push('', 'Previous conversations, most recent first:');
    for (const p of input.previous) {
      out.push(`- ${p.date} «${p.title}»${p.summary ? `: ${p.summary.tema}` : input.summariesOff ? '' : ' (not summarized yet)'}`);
      if (p.summary?.abierto.length) out.push(`  Left open: ${p.summary.abierto.join('; ')}`);
      if (p.summary?.siguiente) out.push(`  Next step: ${p.summary.siguiente}`);
    }
    if (input.summariesOff) out.push('(Conversation summaries are off: no cheap model is configured.)');
  }
  out.push('', 'If something was left open, offer to pick it up. Before re-explaining anything worked on earlier, ask the learner to recall it first.');

  const text = out.join('\n');
  return text.length <= BRIEFING_MAX ? text : `${text.slice(0, BRIEFING_MAX - 2)}\n…`;
}
