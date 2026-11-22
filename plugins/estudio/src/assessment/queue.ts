/*
 * Adapted due-queue ordering from Ihjas-tk/study-harness,
 * learn/src/learn/queue.py at fd6eb70a035ac6014ae00862c3bea5e589fabda5.
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
import type { ReviewState } from './types.ts';
import { daysBetween } from './calendar.ts';

export function buildQueue(states: readonly ReviewState[], today: string): ReviewState[] {
  daysBetween(today, today);
  for (const state of states) {
    if (state.dueDate !== null) daysBetween(state.dueDate, today);
    if (state.lastConfidence !== null && (!Number.isFinite(state.lastConfidence) || state.lastConfidence < 0 || state.lastConfidence > 100)) {
      throw new AssessmentError('INVALID_INPUT', 'Invalid queue confidence');
    }
  }
  return states.filter(state => state.dueDate !== null && state.dueDate <= today).sort((a, b) => {
    const dateOrder = a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0;
    return dateOrder || (b.lastConfidence ?? -1) - (a.lastConfidence ?? -1)
      || (a.checkId < b.checkId ? -1 : a.checkId > b.checkId ? 1 : 0);
  });
}
