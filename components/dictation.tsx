"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon, MicIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { setDictationActive } from "@/components/dictation-state";
import { dispatchFocusedPluginShortcut } from "@/components/plugin-input-focus";
export { isDictationActive } from "@/components/dictation-state";

/**
 * Voice dictation — the LOCAL engine (ticket 12i, 2026-11-27; replaces the
 * Deepgram cloud engine of STT wave 1).
 *
 * The renderer captures mic audio in an AudioWorklet
 * (public/worklets/pcm-capture.js → linear16 16kHz mono) and keeps the
 * frames in memory while it listens. On stop, the whole recording goes to
 * POST /api/stt/transcribe, which runs Parakeet on this machine
 * (src/server/stt.ts) and returns the text; it appends into the PRIMARY
 * INPUT (see below). Audio never leaves the machine. The deferred-transcript
 * behavior (owner round 2) is unchanged: nothing textual renders while
 * recording, only the meter.
 *
 * The notes below are the history of the capture path; the parts about the
 * Deepgram socket, tokens and reconnects no longer apply.
 *
 * Ported patterns from the owner's pi `dictate` extension (his words:
 * "very well tuned") — see ~/.pi/agent/extensions/dictate:
 *   - generation counter: every start/stop increments it; all async
 *     handlers no-op when stale, so a dying session's socket can never
 *     tear down the current one.
 *   - meter: latest-RMS-never-resets — the level ref keeps the last
 *     observed value, so a tick with no fresh audio re-renders the last
 *     level instead of dropping to silence (60ms tick samples the ref).
 *   - dB mapping floor −50 / ceiling −10: the sweet spot for showing
 *     conversational speech as mid-height bars without pegging.
 *   - stop: mic dies FIRST (no more audio enqueues), then CloseStream,
 *     then a 3s safety net in case Deepgram never closes the socket.
 *   - interim_results=false, endpointing=300: his live-tuned params — no
 *     partial hypotheses, finals commit ~300ms after a pause (owner
 *     round 1: live words are distracting and shift the meter; the
 *     meter's width is FIXED while recording).
 *
 * Owner round 2 (2026-09-17, second live test):
 *   - DEFERRED transcript: finals accumulate in a buffer during the run
 *     and flush into the primary input ONCE, when the dictation ends
 *     (click-again/Esc → Deepgram flushes its last finals → socket close
 *     → one joined append). Nothing textual renders while recording —
 *     only the meter. Live output may return as a toggleable setting at
 *     the settings milestone; deferred is the only behavior for now.
 *   - ADAPTIVE meter: the strip's cell count derives from its measured
 *     width (4px pitch, 8–48 cells, ResizeObserver) so narrow rows (the
 *     draft view's tighter column) show fewer bars instead of
 *     overflowing under their neighbors.
 *
 * Owner round 1 (2026-09-17, first live mic test):
 *   - ONE primary transcription input at all times: the pending
 *     quiz/ask question's field while one waits (text mode → the answer
 *     field, select modes → "Your thinking"), else the page's composer.
 *     Implemented as a module-level registry the question form claims on
 *     mount — see useDictationTarget below.
 *   - Click → meter IMMEDIATELY (optimistic): the meter strip renders
 *     from the click, connection + TCC happen behind it. The token mint
 *     and the mic acquisition run CONCURRENTLY (Promise.all) to shrink
 *     the real gap.
 *
 * Meter rendering lives in <DictationBar> (own 60ms timer over the level
 * ref) so the 16-renders/sec never touch the page component — only the
 * tiny bar strip repaints.
 *
 * Start-latency mitigation wave (owner, 2026-09-27 — A+B+C+D, the
 * optimistic meter stays): the old start path serialized [token ∥ mic] →
 * NEW AudioContext → addModule fetch → WSS handshake, and DROPPED every
 * frame that arrived before the socket was OPEN — the first seconds of
 * speech never reached Deepgram. Now:
 *   - QUEUE-DON'T-DROP (A): frames arriving before OPEN buffer (capped,
 *     oldest dropped) and flush in order on open — captured speech is
 *     never lost, wherever in setup it lands.
 *   - PARALLEL HANDSHAKE (B, mic-gated): the handshake starts the moment
 *     the capture graph is live, not after it. Mic-gated, NOT token-gated:
 *     an OS TCC prompt can outlive Deepgram's 10s idle timeout.
 *   - PERSISTENT GRAPH (C): one app-lifetime AudioContext + a memoized
 *     worklet module — per-run contexts paid context creation AND a
 *     worklet-module fetch on every start (through the dev server in dev).
 *   - WARM TOKEN (D): pre-minted at page mount and refreshed after every
 *     run (TTL 3min); the click no longer waits on the remote mint. A
 *     stale-token handshake failure self-heals via the reconnect-once
 *     path, which always mints FRESH.
 *   - The honest floor stays: getUserMedia can't be pre-warmed (the mic
 *     indicator would stay lit) — hence the owner's optimistic meter.
 */

/** Meter tuning — the owner's tested values, see the file header. */
const METER_FLOOR_DB = -50;
const METER_CEILING_DB = -10;
export const METER_TICK_MS = 60;
/** Rolling history: 48 cells × 60ms ≈ 2.9s of recent loudness. */
export const METER_CELLS = 48;

/** 128ms frames (pcm-capture.js); 4688 frames ≈ 10 minutes, the server's cap. */
const MAX_AUDIO_FRAMES = 4688;

export const DICTATION_ACTIVE_ELSEWHERE = "El dictado está activo en otro sitio";

// Mounted controllers do not claim capture. Only start() acquires the single
// window-wide owner, synchronously, before settings/mic/token awaits.
let recordingOwner: symbol | null = null;
let recordingTarget: ((text: string) => unknown) | null = null;
const controllers = new Map<symbol, { primary: boolean; toggle: () => void; cancel: () => void }>();
function toggleGlobalDictation() {
	if (dispatchFocusedPluginShortcut("toggle-dictation")) return;
	for (const controller of controllers.values()) {
		if (controller.primary) {
			controller.toggle();
			return;
		}
	}
}
function cancelGlobalDictation() {
	if (recordingOwner) controllers.get(recordingOwner)?.cancel();
}
function registerController(id: symbol, controller: { primary: boolean; toggle: () => void; cancel: () => void }) {
	if (controllers.size === 0) {
		window.addEventListener("lh:kbd-toggle-dictation", toggleGlobalDictation);
		window.addEventListener("lh:kbd-cancel-dictation", cancelGlobalDictation);
	}
	controllers.set(id, controller);
	return () => {
		controllers.delete(id);
		if (controllers.size === 0) {
			window.removeEventListener("lh:kbd-toggle-dictation", toggleGlobalDictation);
			window.removeEventListener("lh:kbd-cancel-dictation", cancelGlobalDictation);
		}
	};
}

/** Concatenate the captured Int16 frames into one linear16 body. */
export function joinPcmFrames(frames: readonly ArrayBuffer[]): Uint8Array {
	const total = frames.reduce((n, f) => n + f.byteLength, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const f of frames) {
		out.set(new Uint8Array(f), at);
		at += f.byteLength;
	}
	return out;
}

/** Send one recording to the local engine; resolves to its text. */
export async function transcribeLocally(pcm: Uint8Array, signal?: AbortSignal): Promise<string> {
	const res = await fetch("/api/stt/transcribe", {
		method: "POST",
		headers: { "Content-Type": "application/octet-stream" },
		body: pcm as BodyInit,
		signal,
	});
	const data = (await res.json().catch(() => ({}))) as { text?: string; message?: string };
	if (!res.ok) throw new Error(data.message ?? `Falló el dictado (${res.status})`);
	return (data.text ?? "").trim();
}

/* Persistent capture graph (mitigation C, owner 2026-09-27): one
 * app-lifetime AudioContext + a module-load memo. Created under the
 * click gesture (autoplay policy) and NEVER closed — per-run nodes
 * (source, worklet) disconnect at teardown instead. */
let sharedCtx: AudioContext | null = null;
let workletModule: Promise<void> | null = null;

function ensureAudioGraph(): { ctx: AudioContext; module: Promise<void> } {
	if (!sharedCtx) sharedCtx = new AudioContext({ sampleRate: 16000 });
	if (!workletModule) {
		workletModule = sharedCtx.audioWorklet.addModule("/worklets/pcm-capture.js").catch((e: unknown) => {
			workletModule = null; // failed load: retry next run
			throw e;
		});
	}
	return { ctx: sharedCtx, module: workletModule };
}

/** RMS (0..1) → normalized 0..1 across the audible dB window. */
export function rmsToMeter(rms: number): number {
	if (rms <= 0) return 0;
	const db = 20 * Math.log10(rms);
	const t = (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB);
	return Math.max(0, Math.min(1, t));
}

/**
 * The primary-input registry: at most ONE non-composer input can claim the
 * dictation target while mounted — the pending question's answer/thinking
 * field (question-dock.tsx). The page's `append` (the composer) is the
 * fallback when nobody claims. Module-level by design: the claimant is a
 * sibling subtree far from the hook's owner, and there is exactly one
 * window, one pending question, one target at a time.
 */
let questionTarget: ((text: string) => void | Promise<void>) | null = null;
let composerTarget: ((text: string) => void) | null = null;

/** File references use the very same default destination as dictation,
 * including claims whose dock is currently collapsed. A focused editor can
 * insert at its caret instead; callers use this only as the fallback. */
export function appendToPrimaryInput(text: string): boolean {
	const target = questionTarget ?? composerTarget;
	if (!target) return false;
	target(text);
	return true;
}

/* The CORE finisher registry: the pending question's dock needs finish()
 * without a prop bridge. Explicit plugin controllers never register here;
 * their submit paths await their own controller.finish(). */
let dictationFinisher: (() => Promise<void>) | null = null;

/** Finish the core page's dictation before continuing (see Dictation.finish). */
export function finishDictation(): Promise<void> {
	return dictationFinisher ? dictationFinisher() : Promise.resolve();
}

/** Join a dictated final onto the current text (shared separator rule). */
export function joinDictation(current: string, final: string): string {
	return current ? current.replace(/\s+$/, "") + " " + final : final;
}

/**
 * Claim the dictation target while mounted (and `claimed` is true). The
 * unmount guard is identity-based so dev-mode double-invoked effects
 * can't clear another claimant.
 */
export function usePluginQuestionDictationTarget(append: (text: string) => void | Promise<void>, claimed: boolean) {
	useEffect(() => {
		if (!claimed) return;
		questionTarget = append;
		return () => {
			if (questionTarget === append) {
				// Cancel/discard an obsolete capture before releasing its destination.
				if (recordingTarget === append) cancelGlobalDictation();
				questionTarget = null;
			}
		};
	}, [append, claimed]);
}

export function useDictationTarget(append: (text: string) => void, claimed: boolean) {
	useEffect(() => {
		if (!claimed) return;
		questionTarget = append;
		return () => {
			if (questionTarget === append) questionTarget = null;
		};
	}, [append, claimed]);
}

export type DictationPhase = "idle" | "connecting" | "recording" | "stopping";

export interface DictationDestination { id: string; append: (text: string) => void | Promise<void> }

export type Dictation = {
	phase: DictationPhase;
	/** One shared recorder; an explicit side destination never claims the main input. */
	destinationId: string;
	blocked?: boolean;
	toggleFor: (destination: DictationDestination) => void;
	finishFor: (destinationId: string) => Promise<void>;
	/** Terminal-state explanation, shown inside the wide button (cleared on the next start). */
	error: string | null;
	/** Latest observed RMS, 0..1 — sampled by the meter's own tick, never reset. */
	levelRef: { current: number };
	/** Not idle — from the click until the stop completes (the optimistic window). */
	active: boolean;
	/** End + KEEP the transcript: flush the deferred buffer into the primary
	 *  input (the Stop pill and ⌘D). */
	toggle: () => void;
	stop: () => void;
	/** FINISH, THEN CONTINUE (owner, 2026-10-01 "nothing gets lost" round):
	 *  if a run is live, stop it and resolve only when the run has fully
	 *  ended — the engine's text has landed in the target field. A
	 *  submit path awaits this before building its payload, so a learner
	 *  who forgets to stop dictation before Enter never loses the spoken
	 *  reasoning. Idle → resolves immediately (the common no-run submit
	 *  pays nothing). Every terminal path runs cleanup(), and cleanup()
	 *  settles the waiters. Cancel (Esc) normally resolves after discarding
	 *  buffered speech; cancel/dispose during asynchronous transcript delivery
	 *  rejects instead, so a waiting submit cannot send stale text. */
	finish: () => Promise<void>;
	/** End + DISCARD the transcript: no flush, immediate teardown. The Esc
	 *  semantics (owner, 2026-09-17 round 3): Esc is a cancel, not a stop —
	 *  before, it flushed exactly like the toggle did. */
	cancel: () => void;
	/** Clear the terminal error without starting a run. */
	clearError: () => void;
};

/**
 * Shared capture engine with one synchronous window-wide recording owner.
 * Each primary run captures its main/question or explicit side destination.
 * Explicit plugin controllers never claim the primary target or finisher;
 * their asynchronous transcript delivery is part of finishing.
 */
export function useDictation({ append, destination = "primary", disabled = false }: {
	append: (text: string) => void;
	/** Explicit destinations never register or consult the core primary target. */
	destination?: "primary" | "explicit";
	disabled?: boolean;
}): Dictation {
	const primary = destination === "primary";
	const owner = useRef(Symbol("dictation")).current;
	const [phase, setPhaseState] = useState<DictationPhase>("idle");
	const phaseRef = useRef<DictationPhase>("idle");
	const setPhase = useCallback((next: DictationPhase) => {
		phaseRef.current = next;
		setPhaseState(next);
	}, []);
	const [destinationId, setDestinationId] = useState("main");
	const destinationRef = useRef<DictationDestination | null>(null);
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;
	const [error, setError] = useState<string | null>(null);
	/** Latest RMS from the worklet — the meter samples this (dictate pattern). */
	const levelRef = useRef(0);
	/** Fresh fallback for the next start; a live run retains its own target. */
	const appendRef = useRef(append);
	appendRef.current = append;
	useEffect(() => {
		if (!primary) return;
		const target = (text: string) => appendRef.current(text);
		composerTarget = target;
		return () => {
			if (composerTarget === target) composerTarget = null;
		};
	}, [primary]);

	// Live machinery (non-render values). The MediaStream tracks stop and
	// the per-run nodes disconnect on teardown; the AudioContext is
	// app-lifetime (mitigation C).
	const streamRef = useRef<MediaStream | null>(null);
	/** Per-run graph nodes — the CONTEXT outlives runs (mitigation C). */
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const workletRef = useRef<AudioWorkletNode | null>(null);
	/** The run's captured audio, in order; cleared at teardown so a dead
	 *  run's audio can't leak into the next. */
	const audioRef = useRef<ArrayBuffer[]>([]);
	/** The in-flight transcription request; cancel/teardown aborts it. */
	const requestRef = useRef<AbortController | null>(null);
	const genRef = useRef(0); // stale-handler guard (dictate pattern)
	/** The deferred transcript (owner round 2): the engine's text lands here
	 *  and flushes into the primary input once, at teardown. */
	const bufferRef = useRef<string[]>([]);
	/** Resolvers waiting for the run to fully end (finish(), owner
	 *  2026-10-01): released by cleanup() — every terminal path runs it. */
	const waitersRef = useRef<Array<{ resolve: () => void; reject: (error: unknown) => void }>>([]);
	const appendFailureRef = useRef<{ error: unknown } | null>(null);
	const appendPendingRef = useRef(false);

	/** Flush into this run's fixed destination. Called exactly once at cleanup; the
	 *  buffer clears itself so double-cleanup is a no-op. */
	const flush = useCallback((): unknown => {
		if (bufferRef.current.length === 0) return;
		const text = bufferRef.current.join(" ");
		bufferRef.current = [];
		return (destinationRef.current?.append ?? appendRef.current)(text);
	}, []);

	/** Full teardown of one run's machinery. Idempotent; generation-guarded by callers. */
	const cleanup = useCallback(() => {
		const endGen = ++genRef.current;
		let appended: unknown;
		// A second cleanup (cancel/dispose) cannot turn an unfinished async
		// append into a successful finish: that would send the old draft.
		let failure: { error: unknown } | null = appendPendingRef.current
			? { error: new DOMException("Dictation transcript delivery canceled", "AbortError") }
			: null;
		appendPendingRef.current = false;
		try {
			appended = flush(); // exactly one append, after the final transcript
		} catch (error) {
			failure = { error };
		}
		requestRef.current?.abort();
		requestRef.current = null;
		audioRef.current = [];
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		workletRef.current?.disconnect();
		workletRef.current = null;
		// The AudioContext is app-lifetime (mitigation C) — nodes die, it stays.
		const complete = (failed: { error: unknown } | null) => {
			if (endGen !== genRef.current) return;
			appendPendingRef.current = false;
			appendFailureRef.current = failed;
			if (failed) setError(failed.error instanceof Error ? failed.error.message : "No se pudo aplicar la transcripción del dictado");
			if (recordingOwner === owner) {
				recordingOwner = null;
				recordingTarget = null;
				setDictationActive(false);
			}
			setPhase("idle");
			// A plugin's async onTranscript is part of finishing, not a
			// fire-and-forget notification: send must see its controlled text.
			for (const waiter of waitersRef.current.splice(0)) {
				if (failed) waiter.reject(failed.error);
				else waiter.resolve();
			}
		};
		if (appended && typeof (appended as PromiseLike<unknown>).then === "function") {
			appendPendingRef.current = true;
			setPhase("stopping");
			// Both branches consume the promise, including stop-without-finish.
			void Promise.resolve(appended).then(() => complete(null), (error: unknown) => complete({ error }));
		} else complete(failure);
	}, [flush, owner, setPhase]);

	const start = useCallback(async (destination?: DictationDestination) => {
		if (disabledRef.current || phaseRef.current !== "idle") return;
		if (recordingOwner !== null && recordingOwner !== owner) {
			setError(DICTATION_ACTIVE_ELSEWHERE);
			return;
		}
		const target = destination ?? { id: "main", append: primary ? questionTarget ?? appendRef.current : (text: string) => appendRef.current(text) };
		destinationRef.current = target;
		setDestinationId(target.id);
		recordingOwner = owner;
		recordingTarget = target.append;
		setDictationActive(true);
		setError(null);
		appendFailureRef.current = null;
		setPhase("connecting");
		bufferRef.current = []; // fresh run, fresh buffer (round 2)
		audioRef.current = []; // fresh run, fresh audio
		const gen = ++genRef.current;

		// 127.0.0.1 is a secure context, so getUserMedia works without TLS;
		// macOS TCC prompts on first use.
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
			if (gen !== genRef.current) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			streamRef.current = stream;

			// Mitigation C: app-lifetime context + memoized worklet module —
			// per-run costs (context creation, module fetch) are gone.
			const { ctx, module } = ensureAudioGraph();
			await module;
			if (ctx.state === "suspended") await ctx.resume();
			if (gen !== genRef.current) return;

			const worklet = new AudioWorkletNode(ctx, "pcm-capture");
			workletRef.current = worklet;
			worklet.port.onmessage = (e) => {
				if (gen !== genRef.current) return;
				const msg = e.data as { type: string; rms?: number; buffer?: ArrayBuffer };
				if (msg.type === "level") {
					levelRef.current = msg.rms ?? 0; // never reset to zero (dictate pattern)
				} else if (msg.type === "audio" && msg.buffer) {
					// Past the cap the recording keeps its first ten minutes.
					if (audioRef.current.length < MAX_AUDIO_FRAMES) audioRef.current.push(msg.buffer);
				}
			};
			const source = ctx.createMediaStreamSource(stream);
			sourceRef.current = source;
			source.connect(worklet);
			// Pull the graph with silence out (the worklet writes no output) —
			// an unconnected worklet node is never clocked.
			worklet.connect(ctx.destination);
		} catch (e) {
			if (gen !== genRef.current) return;
			const msg =
				e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
					? "Permiso de micrófono denegado"
					: e instanceof Error
						? e.message
						: "Micrófono no disponible";
			setError(msg);
			cleanup();
			return;
		}
		if (gen !== genRef.current) return;
		setPhase("recording");
	}, [cleanup, owner, primary, setPhase]);

	const stop = useCallback(() => {
		const gen = genRef.current;
		if (phaseRef.current !== "recording" && phaseRef.current !== "connecting") return;
		setPhase("stopping");

		// Mic dies FIRST — no more audio enqueues (dictate pattern). The
		// per-run nodes die with it; the AudioContext stays (mitigation C).
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		workletRef.current?.disconnect();
		workletRef.current = null;

		const frames = audioRef.current;
		audioRef.current = [];
		if (frames.length === 0) {
			cleanup();
			return;
		}
		const request = new AbortController();
		requestRef.current = request;
		transcribeLocally(joinPcmFrames(frames), request.signal).then(
			(text) => {
				if (gen !== genRef.current) return;
				requestRef.current = null;
				if (text) bufferRef.current.push(text);
				cleanup();
			},
			(e: unknown) => {
				if (gen !== genRef.current) return;
				requestRef.current = null;
				setError(e instanceof Error ? e.message : "Falló el dictado");
				cleanup();
			},
		);
	}, [cleanup, setPhase]);

	const cancel = useCallback(() => {
		if (phaseRef.current === "idle") return;
		// Discard first, teardown second — cleanup() flushes, and the now-empty
		// buffer makes that flush a no-op. Also kills a "stopping" run: the
		// flush already underway is abandoned (its timer is cleared inside).
		bufferRef.current = [];
		cleanup();
	}, [cleanup]);

	const finishCurrent = useCallback((): Promise<void> => {
		return new Promise((resolve, reject) => {
			if (phaseRef.current === "idle") {
				if (appendFailureRef.current) reject(appendFailureRef.current.error);
				else resolve();
				return;
			}
			waitersRef.current.push({ resolve, reject });
			// "stopping" is already ending — the waiter just rides to cleanup.
			if (phaseRef.current === "recording" || phaseRef.current === "connecting") stop();
		});
	}, [stop]);
	const finishFor = useCallback((id: string) => destinationRef.current?.id === id ? finishCurrent() : Promise.resolve(), [finishCurrent]);
	// A main submission must not stop or wait for side-input recording.
	const finish = useCallback(() => finishFor("main"), [finishFor]);

	// Publish finish() for the sibling subtrees (the pending question's
	// dock) — registered for as long as this page owns the hook.
	useEffect(() => {
		if (!primary) return;
		dictationFinisher = finish;
		return () => {
			if (dictationFinisher === finish) dictationFinisher = null;
		};
	}, [finish, primary]);

	const toggleFor = useCallback((destination?: DictationDestination) => {
		if (phaseRef.current === "idle") void start(destination);
		else if (phaseRef.current === "recording" || phaseRef.current === "connecting") stop();
		// Focus chooses where to START. An active run always stops into its
		// original destination, even after focus moves to a different field.
	}, [start, stop]);
	const toggle = useCallback(() => toggleFor(), [toggleFor]);

	// One shared pair of shortcut listeners, regardless of widget count:
	// focused plugin control first, otherwise core fallback; Esc always
	// cancels the actual recording owner rather than the focused widget.
	useEffect(() => {
		return () => {
			// Navigation cancels capture: invalidate every pending await before
			// releasing resources, and never append into a different page's input.
			bufferRef.current = [];
			cleanup();
		};
	}, [cleanup]);
	useEffect(() => registerController(owner, { primary, toggle, cancel }), [owner, primary, toggle, cancel]);

	return {
		phase,
		destinationId,
		toggleFor,
		finishFor,
		error,
		levelRef,
		active: phase !== "idle",
		toggle,
		stop,
		finish,
		cancel,
		clearError: () => setError(null),
	};
}

/**
 * The stats-bar dictation slot (owner placement, round 1): the row's middle
 * is one strip that is always the full free width —
 *
 *   idle      a wide, quiet "Dictate" button (mic + label, grayed out — the
 *             whole middle is the affordance, per the owner).
 *   active    optimistic from the CLICK: red stop pill + the fixed-width
 *             meter (no interim text ever shifts it). Spinner while
 *             the local engine transcribes the recording.
 *   error     the wide button again, label swapped for the failure reason
 *             (full text in the tooltip), cleared on the next click.
 */
export function DictationBar({ dictation, disabled = false }: { dictation: Dictation; disabled?: boolean }) {
	const { phase, error, levelRef, toggle, active, blocked } = dictation;
	const [levels, setLevels] = useState<number[]>(() => new Array(METER_CELLS).fill(0));
	/** Adaptive cell count (owner round 2): derived from the meter's
	 *  measured width — narrow rows show fewer bars instead of
	 *  overflowing under neighbors. */
	const [cellCount, setCellCount] = useState(METER_CELLS);
	const meterRef = useRef<HTMLDivElement | null>(null);

	// The meter's own heartbeat — 60ms samples of the level ref into a
	// rolling ring. Only THIS strip re-renders; the page never does.
	useEffect(() => {
		if (!active) return;
		setLevels(new Array(METER_CELLS).fill(0));
		const id = setInterval(() => {
			setLevels((ring) => {
				const next = ring.slice(1);
				next.push(rmsToMeter(levelRef.current));
				return next;
			});
		}, METER_TICK_MS);
		return () => clearInterval(id);
	}, [active, levelRef]);

	// Fit the cell count to the available width (4px pitch per cell:
	// 2px bar + 2px gap, clamped 8..48). The meter div's width is set by
	// the row's free space — cells carry no minimum width — so measuring
	// it once per activation + on resize keeps the strip honest in the
	// draft/home rows where the slider leaves little middle.
	useEffect(() => {
		if (!active) return;
		const el = meterRef.current;
		if (!el) return;
		const fit = () => {
			const w = el.clientWidth;
			setCellCount(Math.max(8, Math.min(METER_CELLS, Math.floor(w / 4))));
		};
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, [active]);

	if (!active) {
		return (
			<Hint
				// The error line truncates in the button; its tooltip reveals it.
				label={error ?? "Dictar"}
				action={error ? undefined : "toggle-dictation"}
				side="top"
			>
				<button
					type="button"
					// An error click is a retry; the next start clears it.
					onClick={toggle}
					disabled={disabled || blocked}
					aria-label={error ? `Falló el dictado: ${error}` : "Iniciar dictado"}
					data-testid="dictation-toggle"
					className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-border/50 bg-card/50 text-xs text-muted-foreground/70 shadow-lg backdrop-blur transition-colors hover:border-border hover:text-muted-foreground"
				>
					<MicIcon className="size-3.5" />
					<span className="max-w-full truncate">{error ?? "Dictar"}</span>
				</button>
			</Hint>
		);
	}

	return (
		<div className="flex w-full min-w-0 items-center gap-2" data-testid="dictation-bar">
			<Hint label="Detener dictado (Esc)" side="top">
				<button
					type="button"
					onClick={toggle}
					disabled={phase === "stopping"}
					aria-label="Detener dictado"
					data-testid="dictation-toggle"
					className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-destructive/10 px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
				>
					{phase === "stopping" ? <Loader2Icon className="size-3.5 animate-spin" /> : <MicIcon className="size-3.5" />}
					Detener
				</button>
			</Hint>
			<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
			<div ref={meterRef} className="flex h-4 min-w-0 flex-1 items-center gap-[2px]" data-testid="dictation-meter">
				{levels.slice(-cellCount).map((v, i) => (
					<span
						key={i}
						className="min-w-0 flex-1 rounded-full bg-foreground/40"
						style={{ height: `${2 + Math.round(v * 14)}px` }}
					/>
				))}
			</div>
		</div>
	);
}
