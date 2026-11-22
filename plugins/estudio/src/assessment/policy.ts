/*
 * Adapted policy vocabulary/ladder from Ihjas-tk/study-harness,
 * learn/src/learn/ladder.py at fd6eb70a035ac6014ae00862c3bea5e589fabda5.
 * MIT License
 * Copyright (c) 2026 Ihjas-tk
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { AssessmentError } from './types.ts';
import type { AttemptAggregate, CheckRecord, CheckRevision, GradeEvent, ReviewState } from './types.ts';
import { addDays, daysBetween, instantMillis, localDate } from './calendar.ts';

const COOLDOWN_MS = 86_400_000;
const STEPS = [2, 7, 21, 60] as const;

interface CurrentGrade {
  attempt: AttemptAggregate;
  grade: GradeEvent;
  date: string;
  eligible: boolean;
}

function invalid(message: string): never {
  throw new AssessmentError('INVALID_INPUT', message);
}

function version(format: number, policy?: number): void {
  if (format !== 1 || (policy !== undefined && policy !== 1)) {
    throw new AssessmentError('UNSUPPORTED_FORMAT', 'Unsupported assessment format or review policy');
  }
}

export function activeReviewedRevision(check: CheckRecord): CheckRevision | null {
  version(check.formatVersion);
  for (const revision of check.revisions) version(1, revision.reviewPolicyVersion);
  if (check.archived || check.activeRevision === null) return null;
  const revision = check.revisions.find(item => item.revision === check.activeRevision);
  if (!revision) invalid('Active check revision does not exist');
  if (!revision.reviewed || revision.activatedAt === null) return null;
  instantMillis(revision.activatedAt);
  return revision;
}

/** Shared current-grade/eligibility selection for scheduling and calibration.
 * General structural validation belongs to schema.ts at the service boundary.
 * This core additionally rejects unsafe policy inputs instead of coercing them.
 */
export function collectCurrentGrades(check: CheckRecord, attempts: readonly AttemptAggregate[]): CurrentGrade[] {
  const active = activeReviewedRevision(check);
  const seen = new Map<string, string>();
  const result: CurrentGrade[] = [];
  for (const attempt of attempts) {
    version(attempt.formatVersion, attempt.reviewPolicyVersion);
    version(1, attempt.snapshot.reviewPolicyVersion);
    if (!active || attempt.checkId !== check.id || attempt.checkRevision !== active.revision) continue;
    // Activating unchanged draft content does not convert earlier draft trials
    // into current practice or mastery evidence.
    if (!attempt.snapshot.reviewed || attempt.snapshot.activatedAt === null) continue;
    // Duplicate IDs cannot become independent evidence. Conflicting copies have
    // no safe implicit winner; the caller must resolve the source of truth.
    const serialized = JSON.stringify(attempt);
    const previous = seen.get(attempt.id);
    if (previous !== undefined) {
      if (serialized !== previous) invalid('Conflicting duplicate attempt ID');
      continue;
    }
    seen.set(attempt.id, serialized);
    if (!['open', 'frozen', 'graded', 'abandoned'].includes(attempt.status)) invalid('Invalid attempt status');
    if (attempt.status !== 'graded') continue;
    if (attempt.frozenAt === null || attempt.grades.length === 0) invalid('Graded attempt requires frozen answer and grade');
    if (attempt.snapshot.revision !== attempt.checkRevision) invalid('Snapshot revision mismatch');
    if (!Number.isFinite(attempt.confidence) || attempt.confidence < 0 || attempt.confidence > 100) invalid('Invalid confidence');
    if (!['none', 'hint', 'partial_solution', 'solution', 'unknown'].includes(attempt.help)) invalid('Invalid help level');
    const opened = instantMillis(attempt.openedAt);
    const frozen = instantMillis(attempt.frozenAt);
    if (frozen < opened) invalid('Frozen time precedes opening');
    if (typeof attempt.episodeId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(attempt.episodeId)) invalid('Invalid episode ID');
    for (const event of attempt.grades) {
      if (!['cant', 'partial', 'fluent'].includes(event.score) || event.evaluator !== 'self') invalid('Unsupported grade');
      if (instantMillis(event.gradedAt) < frozen) invalid('Grade precedes freeze');
    }
    const grade = attempt.grades[attempt.grades.length - 1]!;
    const exposed = attempt.lastExposedAt === null ? null : instantMillis(attempt.lastExposedAt);
    const eligible = attempt.help === 'none' && attempt.snapshot.reviewed && attempt.snapshot.activatedAt !== null
      && exposed !== null && opened - exposed >= COOLDOWN_MS;
    result.push({ attempt, grade, eligible, date: localDate(attempt.frozenAt, attempt.timeZone) });
  }
  return result.sort((a, b) => {
    const time = a.attempt.frozenAt! < b.attempt.frozenAt! ? -1 : a.attempt.frozenAt! > b.attempt.frozenAt! ? 1 : 0;
    return time || (a.attempt.id < b.attempt.id ? -1 : a.attempt.id > b.attempt.id ? 1 : 0);
  });
}

export function deriveReview(check: CheckRecord, attempts: readonly AttemptAggregate[], now: string, timeZone = 'Europe/Madrid'): ReviewState | null {
  localDate(now, timeZone); // Explicit caller clock; this is current replay, not an as-of query.
  const current = collectCurrentGrades(check, attempts);
  const active = activeReviewedRevision(check);
  if (!active) return null;
  let eligibleAt: string | null = null;
  if (check.lastExposedAt !== null) {
    const value = instantMillis(check.lastExposedAt) + COOLDOWN_MS;
    eligibleAt = new Date(value).toISOString();
    instantMillis(eligibleAt);
  }
  const result: ReviewState = {
    checkId: check.id, checkRevision: active.revision, state: 'not_started', step: -1,
    dueDate: addDays(localDate(active.activatedAt!, timeZone), 2), eligibleAt,
    needsVerification: false, eligibleCount: 0, lastConfidence: null,
  };
  let durable = false;
  // Only the two earliest dates in distinct episodes are needed to find a
  // qualifying previous success. This bounds replay work per event.
  let earliest: { episode: string; date: string }[] = [];
  for (const { attempt, grade, date, eligible } of current) {
    result.lastConfidence = attempt.confidence;
    if (!eligible) {
      const practiceDue = addDays(date, 2);
      if (result.dueDate === null || practiceDue < result.dueDate) result.dueDate = practiceDue;
      if (grade.score !== 'fluent') result.needsVerification = true;
      continue;
    }
    result.eligibleCount += 1;
    result.needsVerification = false;
    if (grade.score !== 'fluent') {
      result.state = grade.score === 'cant' ? 'attempted' : 'familiar';
      result.step = -1;
      durable = false;
      earliest = [];
      result.dueDate = addDays(date, 2);
      continue;
    }
    result.step = Math.min(result.step + 1, STEPS.length - 1);
    durable ||= earliest.some(previous => previous.episode !== attempt.episodeId && daysBetween(previous.date, date) >= 7);
    const previous = earliest.find(item => item.episode === attempt.episodeId);
    if (previous) {
      if (date < previous.date) previous.date = date;
    } else earliest.push({ episode: attempt.episodeId, date });
    earliest.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    earliest = earliest.slice(0, 2);
    result.state = durable ? 'durable' : 'proficient';
    result.dueDate = addDays(date, durable ? 60 : STEPS[result.step]!);
  }
  return result;
}
