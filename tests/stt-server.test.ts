import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
	findSttEngine,
	handleTranscribe,
	pcmToWav,
	STT_MAX_PCM_BYTES,
	STT_MISSING_MESSAGE,
	STT_MODEL_FILE,
	SttUnavailableError,
	sttDir,
	type Transcriber,
} from "../src/server/stt.ts";

const post = (body: Uint8Array) => new Request("http://127.0.0.1/api/stt/transcribe", { method: "POST", body: body as BodyInit });

describe("local dictation route (ticket 12i)", () => {
	it("passes the raw PCM to the transcriber and returns its text", async () => {
		let seen: Buffer | undefined;
		const fake: Transcriber = async (pcm) => { seen = pcm; return "hola mundo"; };
		const res = await handleTranscribe(post(new Uint8Array([1, 0, 2, 0])), fake);
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { text: "hola mundo" });
		assert.deepEqual([...seen!], [1, 0, 2, 0]);
	});

	it("rejects empty, odd-length and oversized bodies without running the engine", async () => {
		let calls = 0;
		const fake: Transcriber = async () => { calls++; return ""; };
		for (const body of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(STT_MAX_PCM_BYTES + 2)]) {
			const res = await handleTranscribe(post(body), fake);
			assert.equal(res.status, 400);
		}
		assert.equal(calls, 0);
	});

	it("a missing engine is a 503 with the user-facing explanation", async () => {
		const res = await handleTranscribe(post(new Uint8Array(2)), async () => { throw new SttUnavailableError(); });
		assert.equal(res.status, 503);
		assert.deepEqual(await res.json(), { message: STT_MISSING_MESSAGE });
	});

	it("an engine failure is a 500 carrying its message", async () => {
		const res = await handleTranscribe(post(new Uint8Array(2)), async () => { throw new Error("El motor de voz terminó con código 1"); });
		assert.equal(res.status, 500);
		assert.match((await res.json() as { message: string }).message, /código 1/);
	});
});

describe("engine discovery", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "lh-stt-test-"));
	after(() => rmSync(dir, { recursive: true, force: true }));

	it("LH_STT_DIR wins; otherwise vendor/stt under the working directory", () => {
		assert.equal(sttDir({ LH_STT_DIR: "C:/x/stt" }), path.resolve("C:/x/stt"));
		assert.equal(sttDir({}), path.join(process.cwd(), "vendor", "stt"));
	});

	it("needs both the CLI and the model", () => {
		assert.equal(findSttEngine(dir), null);
		const cli = path.join(dir, "bin", process.platform === "win32" ? "parakeet-cli.exe" : "parakeet-cli");
		mkdirSync(path.dirname(cli), { recursive: true });
		writeFileSync(cli, "");
		assert.equal(findSttEngine(dir), null, "no model yet");
		mkdirSync(path.join(dir, "models"), { recursive: true });
		writeFileSync(path.join(dir, "models", STT_MODEL_FILE), "");
		assert.deepEqual(findSttEngine(dir), { cli, model: path.join(dir, "models", STT_MODEL_FILE) });
	});
});

describe("pcmToWav", () => {
	it("writes a 16 kHz mono 16-bit RIFF header in front of the samples", () => {
		const wav = pcmToWav(Buffer.from([1, 0, 2, 0]));
		assert.equal(wav.length, 48);
		assert.equal(wav.toString("ascii", 0, 4), "RIFF");
		assert.equal(wav.readUInt32LE(4), 40);
		assert.equal(wav.toString("ascii", 8, 12), "WAVE");
		assert.equal(wav.readUInt16LE(20), 1);
		assert.equal(wav.readUInt16LE(22), 1);
		assert.equal(wav.readUInt32LE(24), 16000);
		assert.equal(wav.readUInt32LE(28), 32000);
		assert.equal(wav.readUInt16LE(34), 16);
		assert.equal(wav.toString("ascii", 36, 40), "data");
		assert.equal(wav.readUInt32LE(40), 4);
		assert.deepEqual([...wav.subarray(44)], [1, 0, 2, 0]);
	});
});
