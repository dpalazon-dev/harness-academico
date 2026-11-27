// Downloads and verifies the local dictation engine (ticket 12i) into
// vendor/stt, the folder that development reads directly and that the
// Windows installer copies to resources/stt:
//
//   vendor/stt/bin/     parakeet-cli.exe + parakeet/ggml libraries
//   vendor/stt/models/  ggml-parakeet-tdt-0.6b-v3-q8_0.bin
//
// Every download is pinned by SHA-256; a mismatch aborts. Downloads are
// cached in vendor/stt-cache, so a second run is offline and instant.
// Usage: node scripts/stt-fetch.mjs [--check]   (--check: verify only, no network)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = join(import.meta.dirname, "..");
const vendor = join(root, "vendor", "stt");
const cache = join(root, "vendor", "stt-cache");

/** The engine: whisper.cpp b5907 built by .github/workflows/stt-binaries.yml
 *  (run 46048933459): parakeet-cli, the ggml backends loaded at run time
 *  (every CPU variant plus Vulkan, used when a GPU driver exists) and the
 *  Visual C++ runtime next to them, so a clean Windows needs nothing else. */
export const ENGINE = {
	name: "parakeet-win-x64-b5907-vulkan.zip",
	url: "https://github.com/dpalazon-dev/harness-academico/releases/download/stt-b5907/parakeet-win-x64-b5907-vulkan.zip",
	sha256: "0a4de211a6d0498840bb974da5306d0ee155b9ba083c9e2eb28bac9966123dd2",
	/** The zip holds only what parakeet-cli needs. */
	keep: /\.(exe|dll)$/i,
};

/** Parakeet TDT 0.6B v3, 8-bit (NVIDIA, CC-BY-4.0; GGUF conversion by ggml-org, MIT). */
export const MODEL = {
	name: "ggml-parakeet-tdt-0.6b-v3-q8_0.bin",
	url: "https://huggingface.co/ggml-org/parakeet-GGUF/resolve/main/ggml-parakeet-tdt-0.6b-v3-q8_0.bin",
	sha256: "4d64e9e96c2792186d072fde0034df0ad670cf680a2f53069052ead827fd600e",
	size: 668757119,
};

async function sha256(file) {
	const hash = createHash("sha256");
	await pipeline(createReadStream(file), hash);
	return hash.digest("hex");
}

/** A cached, verified copy of `item`, downloading it if needed. */
async function obtain(item, offline) {
	mkdirSync(cache, { recursive: true });
	const file = join(cache, item.name);
	if (existsSync(file) && (await sha256(file)) === item.sha256) return file;
	if (offline) throw new Error(`Falta o no coincide ${item.name} (ejecuta node scripts/stt-fetch.mjs)`);
	console.log(`[stt-fetch] Descargando ${item.name}…`);
	const res = await fetch(item.url, { redirect: "follow" });
	if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${item.url} (${res.status})`);
	const partial = `${file}.part`;
	await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
	const actual = await sha256(partial);
	if (actual !== item.sha256) {
		rmSync(partial, { force: true });
		throw new Error(`SHA-256 de ${item.name} no coincide: ${actual}`);
	}
	renameSync(partial, file);
	return file;
}

function listFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]);
}

export async function fetchStt({ offline = false } = {}) {
	const zip = await obtain(ENGINE, offline);
	const model = await obtain(MODEL, offline);

	const bin = join(vendor, "bin");
	const models = join(vendor, "models");
	rmSync(bin, { recursive: true, force: true });
	mkdirSync(bin, { recursive: true });
	mkdirSync(models, { recursive: true });

	const unpack = mkdtempSync(join(cache, "unpack-"));
	try {
		// bsdtar (Windows 10+, macOS) reads zip archives. On Windows call the
		// system copy explicitly: Git's GNU tar may come first in PATH and
		// neither reads zip nor accepts drive-letter paths.
		const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe") : "tar";
		execFileSync(tar, ["-xf", zip, "-C", unpack], { stdio: "inherit" });
		const files = listFiles(unpack).filter((f) => ENGINE.keep.test(f.split(/[\\/]/).pop()));
		if (!files.some((f) => /parakeet-cli\.exe$/i.test(f))) throw new Error("El paquete del motor no trae parakeet-cli.exe");
		for (const f of files) copyFileSync(f, join(bin, f.split(/[\\/]/).pop()));
	} finally {
		rmSync(unpack, { recursive: true, force: true });
	}

	const target = join(models, MODEL.name);
	if (!existsSync(target) || statSync(target).size !== MODEL.size) copyFileSync(model, target);
	console.log(`[stt-fetch] Motor de dictado listo en ${vendor}`);
}

if (import.meta.main ?? process.argv[1]?.endsWith("stt-fetch.mjs")) {
	await fetchStt({ offline: process.argv.includes("--check") });
}
