// Smoke test of a packaged local dictation engine (ticket 12i): the files
// exist and parakeet-cli loads its libraries and the model and transcribes
// one second of silence with exit code 0.
// Usage: node scripts/smoke-stt.mjs <stt folder>   (e.g. dist/win-unpacked/resources/stt)
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = process.argv[2] && resolve(process.argv[2]);
if (!dir) throw new Error("Uso: node scripts/smoke-stt.mjs <carpeta stt>");
const cli = join(dir, "bin", process.platform === "win32" ? "parakeet-cli.exe" : "parakeet-cli");
const model = join(dir, "models", "ggml-parakeet-tdt-0.6b-v3-q8_0.bin");
for (const file of [cli, model]) if (!existsSync(file)) throw new Error(`Falta el archivo del motor de dictado: ${file}`);

const rate = 16000;
const pcm = Buffer.alloc(rate * 2);
const header = Buffer.alloc(44);
header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8, "ascii");
header.write("fmt ", 12, "ascii"); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36, "ascii"); header.writeUInt32LE(pcm.length, 40);

const tmp = mkdtempSync(join(tmpdir(), "lh-smoke-stt-"));
try {
	const wav = join(tmp, "silencio.wav");
	writeFileSync(wav, Buffer.concat([header, pcm]));
	const started = Date.now();
	execFileSync(cli, ["-m", model, "-f", wav, "-np"], { cwd: join(dir, "bin"), stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
	console.log(`[smoke-stt] parakeet-cli responde (${Date.now() - started} ms)`);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
