#!/usr/bin/env node
// Lanza la suite raíz igual en Windows, Linux y macOS.
//
// `NODE_ENV=test tsx --test tests/*.test.ts tests/*.test.tsx` no sirve en
// Windows: la sintaxis de variables es de Unix y, aunque se arregle, pasar
// cada archivo en la línea de comandos supera su límite de longitud. Este
// script fija NODE_ENV, expande los patrones él mismo y reparte los archivos
// en tandas dentro del límite. Los argumentos extra se pasan a `tsx --test`.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");

const files = readdirSync(join(root, "tests"))
	.filter((name) => /\.test\.tsx?$/.test(name))
	.sort()
	.map((name) => `tests/${name}`);

const extra = process.argv.slice(2);
const selected = extra.filter((arg) => !arg.startsWith("-"));
const flags = extra.filter((arg) => arg.startsWith("-"));

// Con archivos explícitos se ejecutan solo esos; sin ellos, toda la suite.
const targets = selected.length > 0 ? selected : files;

// 8.000 caracteres dejan margen bajo el límite de 32.767 de CreateProcess.
const BUDGET = 8000;
const batches = [];
let current = [];
let size = 0;
for (const file of targets) {
	if (current.length > 0 && size + file.length + 1 > BUDGET) {
		batches.push(current);
		current = [];
		size = 0;
	}
	current.push(file);
	size += file.length + 1;
}
if (current.length > 0) batches.push(current);

let status = 0;
for (const batch of batches) {
	const result = spawnSync(
		process.execPath,
		[tsx, "--test", ...flags, ...batch],
		{
			cwd: root,
			stdio: "inherit",
			env: { ...process.env, NODE_ENV: "test" },
		},
	);
	if (result.status !== 0) status = result.status ?? 1;
}
process.exit(status);
