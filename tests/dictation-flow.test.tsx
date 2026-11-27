import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { finishDictation, joinPcmFrames, useDictation, useDictationTarget, type Dictation } from "../components/dictation.tsx";
import { isDictationActive, useDictationActive } from "../components/dictation-state.ts";

// The local engine (ticket 12i): the recognizer is simulated at its client,
// the POST /api/stt/transcribe request. Audio frames come from a fake worklet.

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

class AudioGraph {
	state = "running";
	destination = {};
	audioWorklet = { addModule: async () => {} };
	createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
}
class Worklet {
	static all: Worklet[] = [];
	port: { onmessage?: (e: { data: unknown }) => void } = {};
	constructor() { Worklet.all.push(this); }
	connect() {}
	disconnect() {}
	/** One 128ms linear16 frame, filled with `value`. */
	frame(value = 1) {
		const buffer = new Int16Array(2048).fill(value).buffer;
		this.port.onmessage?.({ data: { type: "audio", buffer } });
	}
}

type Request = { body: Uint8Array; signal?: AbortSignal; reply: (response: Response) => void };

const globals = globalThis as Record<string, unknown>;
let restore: (() => void) | undefined;
let dispose: (() => Promise<void>) | undefined;

async function fixture() {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	const state = {
		nextMic: undefined as Promise<{ getTracks: () => { stop: () => void }[] }> | undefined,
		active: false,
		captures: 0,
		stops: 0,
		appends: [] as string[],
		requests: [] as Request[],
		claimed: undefined as ((text: string) => void) | undefined,
	};
	Worklet.all = [];
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({
		React, window: dom.window, document: dom.document, CustomEvent: dom.window.CustomEvent,
		navigator: { userAgent: "", platform: "", mediaDevices: { getUserMedia: async () => {
			state.captures++;
			if (state.nextMic) return state.nextMic;
			return { getTracks: () => [{ stop() { state.stops++; } }] };
		} } },
		AudioContext: AudioGraph, AudioWorkletNode: Worklet,
		IS_REACT_ACT_ENVIRONMENT: true,
		fetch: (url: string, init?: RequestInit) => {
			assert.equal(url, "/api/stt/transcribe");
			assert.equal(init?.method, "POST");
			const response = deferred<Response>();
			init?.signal?.addEventListener("abort", () => response.resolve(Promise.reject(new DOMException("aborted", "AbortError")) as unknown as Response));
			state.requests.push({ body: init!.body as Uint8Array, signal: init?.signal ?? undefined, reply: response.resolve });
			return response.promise;
		},
	})) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	restore = () => {
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globals[key];
		}
	};
	const { createRoot } = await import("react-dom/client");
	let latest!: Dictation;
	function Harness() {
		const claimed = state.claimed;
		useDictationTarget(React.useCallback((text: string) => claimed?.(text), [claimed]), !!claimed);
		latest = useDictation({ append: (text) => state.appends.push(text) });
		state.active = useDictationActive();
		return null;
	}
	const root = createRoot(document.getElementById("root")!);
	dispose = async () => { await act(async () => { root.unmount(); }); };
	return {
		state,
		get dictation() { return latest; },
		mount: async () => { await act(async () => { root.render(<Harness />); }); },
		unmount: () => dispose!(),
		/** Answer the latest transcription request. */
		reply: async (text: string, status = 200) => {
			await act(async () => { state.requests.at(-1)!.reply(Response.json(status === 200 ? { text } : { message: text }, { status })); });
		},
	};
}

afterEach(async () => { await dispose?.(); restore?.(); dispose = undefined; restore = undefined; });

test("stop sends the whole recording once and appends the engine's text", async () => {
	const f = await fixture(); await f.mount();
	await act(async () => { f.dictation.toggle(); });
	assert.equal(f.dictation.phase, "recording");
	assert.equal(f.state.active, true);
	await act(async () => { Worklet.all[0]!.frame(1); Worklet.all[0]!.frame(2); });
	assert.equal(f.state.requests.length, 0, "nothing is sent while recording");
	await act(async () => { f.dictation.stop(); });
	assert.equal(f.dictation.phase, "stopping");
	assert.equal(f.state.stops, 1, "the microphone dies before transcription");
	assert.equal(f.state.requests.length, 1);
	assert.equal(f.state.requests[0]!.body.byteLength, 2 * 2048 * 2);
	await f.reply("Hola mundo");
	assert.deepEqual(f.state.appends, ["Hola mundo"]);
	assert.equal(f.dictation.phase, "idle");
	assert.equal(f.state.active, false);
});

test("a missing engine shows the server's explanation and appends nothing", async () => {
	const f = await fixture(); await f.mount();
	await act(async () => { f.dictation.toggle(); });
	await act(async () => { Worklet.all[0]!.frame(); f.dictation.stop(); });
	await f.reply("El dictado local no está instalado: faltan el motor o el modelo de voz", 503);
	assert.equal(f.dictation.phase, "idle");
	assert.match(f.dictation.error!, /no está instalado/);
	assert.deepEqual(f.state.appends, []);
	// The next click retries and clears the error.
	await act(async () => { f.dictation.toggle(); });
	assert.equal(f.dictation.error, null);
	assert.equal(f.dictation.phase, "recording");
});

test("stopping with no captured audio sends no request", async () => {
	const f = await fixture(); await f.mount();
	await act(async () => { f.dictation.toggle(); });
	await act(async () => { f.dictation.stop(); });
	assert.equal(f.state.requests.length, 0);
	assert.equal(f.dictation.phase, "idle");
	assert.deepEqual(f.state.appends, []);
});

test("cancel during transcription aborts the request and discards its text", async () => {
	const f = await fixture(); await f.mount();
	await act(async () => { f.dictation.toggle(); });
	await act(async () => { Worklet.all[0]!.frame(); f.dictation.stop(); });
	const request = f.state.requests[0]!;
	await act(async () => { f.dictation.cancel(); });
	assert.equal(request.signal?.aborted, true);
	assert.equal(f.dictation.phase, "idle");
	await act(async () => { request.reply(Response.json({ text: "late text" })); });
	assert.deepEqual(f.state.appends, []);
});

test("side recording has a fixed destination, and main finish never waits for or stops it", async () => {
	const f = await fixture(); await f.mount();
	const side: string[] = []; const other: string[] = [];
	await act(async () => { f.dictation.toggleFor({ id: "side:first", append: (text) => { side.push(text); } }); });
	await act(async () => { Worklet.all[0]!.frame(); });
	assert.equal(f.dictation.destinationId, "side:first");
	await act(async () => { await finishDictation(); await f.dictation.finishFor("side:another"); });
	assert.equal(f.dictation.phase, "recording");
	assert.deepEqual(side, []);
	// A shortcut at another focused input stops the current run, not a second capture.
	await act(async () => { f.dictation.toggleFor({ id: "side:another", append: (text) => { other.push(text); } }); });
	assert.equal(f.dictation.phase, "stopping"); assert.equal(f.state.captures, 1);
	await f.reply("Side words");
	assert.deepEqual(side, ["Side words"]); assert.deepEqual(other, []); assert.deepEqual(f.state.appends, []);
});

test("side finish waits for the transcript and flushes once into its original destination", async () => {
	const f = await fixture(); await f.mount(); const side: string[] = [];
	await act(async () => { f.dictation.toggleFor({ id: "side:thread", append: (text) => { side.push(text); } }); });
	await act(async () => { Worklet.all[0]!.frame(); });
	let finished = false; let done!: Promise<void>;
	await act(async () => { done = f.dictation.finishFor("side:thread").then(() => { finished = true; }); });
	assert.equal(finished, false); assert.deepEqual(side, []);
	await f.reply("Closing words");
	await act(async () => { await done; });
	assert.equal(finished, true); assert.deepEqual(side, ["Closing words"]);
	await act(async () => { await f.dictation.finishFor("side:thread"); });
	assert.deepEqual(side, ["Closing words"]);
});

test("closing side recording during microphone setup cannot leave a late live capture", async () => {
	const f = await fixture(); const mic = deferred<{ getTracks: () => { stop: () => void }[] }>();
	f.state.nextMic = mic.promise; await f.mount();
	await act(async () => { f.dictation.toggleFor({ id: "side:connecting", append: (text) => { f.state.appends.push(text); } }); });
	assert.equal(f.dictation.phase, "connecting");
	await act(async () => { await f.dictation.finishFor("side:connecting"); });
	assert.equal(f.dictation.phase, "idle");
	await act(async () => { mic.resolve({ getTracks: () => [{ stop() { f.state.stops++; } }] }); });
	assert.equal(f.state.stops, 1); assert.equal(Worklet.all.length, 0); assert.deepEqual(f.state.appends, []);
	assert.equal(f.state.requests.length, 0);
});

test("main recording retains its starting question field when later focus/claims change", async () => {
	const f = await fixture(); const first: string[] = []; const later: string[] = [];
	f.state.claimed = (text) => first.push(text); await f.mount();
	await act(async () => { f.dictation.toggle(); });
	await act(async () => { Worklet.all[0]!.frame(); });
	f.state.claimed = (text) => later.push(text); await f.mount();
	await act(async () => { f.dictation.stop(); });
	await f.reply("Main reasoning");
	assert.deepEqual(first, ["Main reasoning"]); assert.deepEqual(later, []); assert.deepEqual(f.state.appends, []);
});

test("unmount during recording stops resources and never sends the departing page's audio", async () => {
	const f = await fixture(); await f.mount();
	await act(async () => { f.dictation.toggle(); });
	await act(async () => { Worklet.all[0]!.frame(); });
	await f.unmount();
	assert.equal(f.state.stops, 1);
	assert.equal(isDictationActive(), false);
	await act(async () => { Worklet.all[0]!.frame(); });
	assert.equal(f.state.requests.length, 0);
	assert.deepEqual(f.state.appends, []);
});

test("microphone permission resolving after unmount immediately stops the late stream", async () => {
	const f = await fixture(); await f.mount();
	const mic = deferred<{ getTracks: () => { stop: () => void }[] }>();
	f.state.nextMic = mic.promise;
	await act(async () => { f.dictation.toggle(); });
	assert.equal(f.state.captures, 1);
	await f.unmount();
	await act(async () => { mic.resolve({ getTracks: () => [{ stop() { f.state.stops++; } }] }); });
	assert.equal(f.state.stops, 1);
	assert.equal(Worklet.all.length, 0);
	assert.equal(isDictationActive(), false);
});

test("joinPcmFrames keeps frame order and bytes", () => {
	const a = new Int16Array([1, 2]).buffer;
	const b = new Int16Array([3]).buffer;
	assert.deepEqual([...new Int16Array(joinPcmFrames([a, b]).buffer)], [1, 2, 3]);
});
