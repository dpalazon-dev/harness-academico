/**
 * Local speech-to-text: Parakeet TDT 0.6B v3 through whisper.cpp's
 * `parakeet-cli`, run as a child process per dictation (ticket 12i,
 * 2026-11-27). Nothing leaves the machine.
 *
 * Layout of the engine folder (LH_STT_DIR; packaged: resources/stt, set by
 * electron/main.cjs; dev: <repo>/vendor/stt, filled by scripts/stt-fetch.mjs):
 *   bin/parakeet-cli(.exe) + its ggml/parakeet libraries
 *   models/ggml-parakeet-tdt-0.6b-v3-q8_0.bin
 *
 * GPU: the binaries are built with GGML_BACKEND_DL, so ggml loads the
 * Vulkan backend by itself when a driver and device exist and falls back to
 * the best CPU variant otherwise. No choice happens here.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const STT_MODEL_FILE = "ggml-parakeet-tdt-0.6b-v3-q8_0.bin";
export const STT_SAMPLE_RATE = 16_000;
/** Ten minutes of 16-bit mono audio: a runaway recording, not a dictation. */
export const STT_MAX_PCM_BYTES = STT_SAMPLE_RATE * 2 * 600;
const STT_TIMEOUT_MS = 120_000;

export const STT_MISSING_MESSAGE = "El dictado local no está instalado: faltan el motor o el modelo de voz";

export type SttEngine = { cli: string; model: string };

export function sttDir(env: Record<string, string | undefined> = process.env): string {
	// Absolute: the CLI runs with its own folder as the working directory.
	return path.resolve(env.LH_STT_DIR || path.join(process.cwd(), "vendor", "stt"));
}

/** The engine's files, or null when any is missing. */
export function findSttEngine(dir: string = sttDir()): SttEngine | null {
	dir = path.resolve(dir);
	const cli = path.join(dir, "bin", process.platform === "win32" ? "parakeet-cli.exe" : "parakeet-cli");
	const model = path.join(dir, "models", STT_MODEL_FILE);
	return existsSync(cli) && existsSync(model) ? { cli, model } : null;
}

/** Transcribes 16 kHz mono 16-bit little-endian PCM into text. */
export type Transcriber = (pcm: Buffer, signal?: AbortSignal) => Promise<string>;

export class SttUnavailableError extends Error {
	constructor() {
		super(STT_MISSING_MESSAGE);
		this.name = "SttUnavailableError";
	}
}

/** A canonical 44-byte RIFF header in front of the PCM. */
export function pcmToWav(pcm: Buffer, sampleRate = STT_SAMPLE_RATE): Buffer {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16); // fmt chunk size
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28); // byte rate
	header.writeUInt16LE(2, 32); // block align
	header.writeUInt16LE(16, 34); // bits per sample
	header.write("data", 36, "ascii");
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

/** Half the logical cores, 1..8 (measured: 8 threads on a 20-thread i7-13700H). */
function threadCount(): number {
	const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
	return Math.max(1, Math.min(8, Math.floor(cores / 2)));
}

/** The real transcriber: WAV in a private temp folder, parakeet-cli, stdout. */
export function parakeetTranscriber(engine: SttEngine): Transcriber {
	return async (pcm, signal) => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "lh-stt-"));
		const wav = path.join(dir, "dictado.wav");
		try {
			await writeFile(wav, pcmToWav(pcm));
			return await new Promise<string>((resolve, reject) => {
				const child = spawn(engine.cli, ["-m", engine.model, "-f", wav, "-t", String(threadCount()), "-np"], {
					cwd: path.dirname(engine.cli),
					windowsHide: true,
					stdio: ["ignore", "pipe", "pipe"],
				});
				const out: Buffer[] = [];
				const err: Buffer[] = [];
				child.stdout.on("data", (b: Buffer) => out.push(b));
				child.stderr.on("data", (b: Buffer) => err.push(b));
				const kill = () => child.kill();
				const timer = setTimeout(kill, STT_TIMEOUT_MS);
				signal?.addEventListener("abort", kill, { once: true });
				child.on("error", (e) => {
					clearTimeout(timer);
					reject(e);
				});
				child.on("close", (code) => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", kill);
					if (signal?.aborted) return reject(new DOMException("Dictado cancelado", "AbortError"));
					if (code !== 0) {
						const tail = Buffer.concat(err).toString("utf8").trim().split(/\r?\n/).slice(-3).join(" ");
						return reject(new Error(`El motor de voz terminó con código ${code}${tail ? `: ${tail}` : ""}`));
					}
					resolve(Buffer.concat(out).toString("utf8").replace(/\s+/g, " ").trim());
				});
			});
		} finally {
			await rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	};
}

/** The default transcriber, resolved per call so a fetch after launch is seen. */
export const localTranscriber: Transcriber = (pcm, signal) => {
	const engine = findSttEngine();
	if (!engine) return Promise.reject(new SttUnavailableError());
	return parakeetTranscriber(engine)(pcm, signal);
};

/** POST /api/stt/transcribe: raw PCM body → { text }. 503 when the engine is
 *  missing, 400 for an empty/odd/oversized body, 500 when the engine fails. */
export async function handleTranscribe(request: Request, transcribe: Transcriber = localTranscriber): Promise<Response> {
	const body = Buffer.from(await request.arrayBuffer());
	if (body.length === 0 || body.length % 2 !== 0 || body.length > STT_MAX_PCM_BYTES) {
		return Response.json({ message: "Audio no válido" }, { status: 400 });
	}
	try {
		const text = await transcribe(body, request.signal);
		return Response.json({ text });
	} catch (e) {
		if (e instanceof SttUnavailableError) return Response.json({ message: e.message }, { status: 503 });
		return Response.json({ message: e instanceof Error ? e.message : "Falló el motor de voz" }, { status: 500 });
	}
}
