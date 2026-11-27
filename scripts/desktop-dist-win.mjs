import { execFileSync } from "node:child_process";
import { cpSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, sep } from "node:path";
import { listPackage } from "@electron/asar";

if (process.platform !== "win32" || process.arch !== "x64") {
	throw new Error("desktop:dist:win requiere Node x64 en Windows");
}

// Any clean clone works; David's machine builds from the dedicated worktree work/compilado.
const root = realpathSync(join(import.meta.dirname, ".."));
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Ejecuta npm run desktop:dist:win");

function run(step, binary, args) {
	console.log(`[desktop:dist:win] ${step}`);
	try {
		execFileSync(binary, args, { cwd: root, stdio: "inherit" });
	} catch (error) {
		throw new Error(`Falló el paso: ${step}`, { cause: error });
	}
}

const git = (...args) => execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
	cwd: root, encoding: "utf8",
}).trim();
const commit = git("rev-parse", "HEAD");
if (git("status", "--porcelain")) throw new Error("Compila desde un commit con el worktree limpio");

function checkName(file, source = false) {
	const name = basename(file);
	if (source && /^\.env(?:\..+)?\.example$/i.test(name)) return;
	if (/^\.env(?:\.|$)|^auth\.json(?:\.|$)|-credentials\.json(?:\.|$)|^rutas\.json$|^harnessacademico\.lock(?:\.|$)|^\.npmrc$/i.test(name)) {
		throw new Error(`Contenido local en la compilación: ${file}`);
	}
}
function rejectLocalFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const file = join(directory, entry.name);
		checkName(file);
		if (entry.isDirectory()) rejectLocalFiles(file);
	}
}
function shikiAliases(payload) {
	const externals = join(payload, ".next", "node_modules");
	if (!lstatSync(externals, { throwIfNoEntry: false })) return [];
	return readdirSync(externals).filter((name) => /^shiki-[a-f0-9]+$/.test(name)).map((name) => join(externals, name));
}
for (const name of readdirSync(root)) checkName(join(root, name), true);

// Check both the generated directories and their parent for redirects before deleting.
for (const relative of [".next", ".next/standalone", "dist"]) {
	const target = join(root, relative);
	const info = lstatSync(target, { throwIfNoEntry: false });
	if (info && (!info.isDirectory() || realpathSync(target) !== target)) {
		throw new Error(`Ruta de compilación inesperada: ${target}`);
	}
}
for (const relative of [".next/standalone", "dist"]) {
	rmSync(join(root, relative), { recursive: true, force: true });
}

const node = process.execPath;
const nextTypes = join(root, "next-env.d.ts");
const devTypes = readFileSync(nextTypes, "utf8");
const prodTypes = devTypes.replaceAll('import "./.next/dev/types/', 'import "./.next/types/');
try {
	run("Compilar Next y plugins", node, [npm, "run", "build"]);
} finally {
	// Next rewrites this tracked development declaration with production paths.
	if (prodTypes !== devTypes && readFileSync(nextTypes, "utf8") === prodTypes) {
		writeFileSync(nextTypes, devTypes);
	}
}
run("Descargar y verificar el motor de dictado", node, ["scripts/stt-fetch.mjs"]);
run("Comprobar proveedores en el trazado de Next", node, ["scripts/smoke-provider-runtime.mjs"]);
run("Preparar servidor standalone", node, ["scripts/build-server.mjs"]);
const standalone = join(root, ".next", "standalone");
// Turbopack moves the nested Shiki package to a hashed path. Its sibling
// @shikijs packages are no longer reachable by Node from that path.
const codeDependencies = join(root, "node_modules", "@streamdown", "code", "node_modules");
for (const directory of shikiAliases(standalone)) {
	const traced = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
	const source = JSON.parse(readFileSync(join(codeDependencies, "shiki", "package.json"), "utf8"));
	if (traced.version !== source.version) throw new Error(`Versión inesperada de Shiki: ${directory}`);
	cpSync(join(codeDependencies, "@shikijs"), join(directory, "node_modules", "@shikijs"), { recursive: true });
}
if (readdirSync(standalone).some((name) => name.toLowerCase() === "data")) {
	throw new Error("La carpeta de datos entró en el servidor standalone");
}
rejectLocalFiles(standalone);
run("Iniciar servidor standalone con Electron", node, ["scripts/smoke-server.mjs", "--electron"]);
if (git("rev-parse", "HEAD") !== commit || git("status", "--porcelain")) {
	throw new Error("El código del worktree cambió durante la compilación");
}
writeFileSync(join(root, ".next", "standalone", "build-commit.txt"), `${commit}\n`);
run("Empaquetar NSIS", node, [npm, "exec", "--offline", "--", "electron-builder", "--win", "--x64", "--publish", "never"]);

const resources = join(root, "dist", "win-unpacked", "resources");
const payload = join(resources, "server", "standalone");
const runtime = join(root, "dist", "win-unpacked", "HarnessAcademico.exe");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const installer = join(root, "dist", `HarnessAcademico-${version}-x64-setup.exe`);
for (const file of [installer, runtime, join(resources, "app.asar"), join(payload, "server.js")]) {
	if (!lstatSync(file, { throwIfNoEntry: false })?.size) throw new Error(`Falta el archivo del paquete: ${file}`);
}
if (readFileSync(join(payload, "build-commit.txt"), "utf8").trim() !== commit) {
	throw new Error("El paquete no contiene el commit compilado");
}
rejectLocalFiles(resources);
for (const file of listPackage(join(resources, "app.asar"))) checkName(file);
for (const directory of shikiAliases(payload)) {
	const manifest = join(directory, "package.json");
	const resolve = createRequire(manifest).resolve;
	const dependencies = JSON.parse(readFileSync(manifest, "utf8")).dependencies;
	for (const name of Object.keys(dependencies).filter((name) => name.startsWith("@shikijs/"))) {
		const resolved = realpathSync(resolve(name));
		if (!resolved.startsWith(payload + sep)) throw new Error(`Shiki carga ${name} fuera del paquete: ${resolved}`);
	}
	run("Importar Shiki desde el paquete final", node, [join(directory, "dist", "bundle-full.mjs")]);
}
run("Comprobar proveedores del paquete con Node", node, ["scripts/smoke-provider-runtime.mjs", "--standalone", payload]);
run("Comprobar proveedores del paquete con Electron", node, ["scripts/smoke-provider-runtime.mjs", "--standalone", payload, "--runtime", runtime]);
run("Comprobar el motor de dictado del paquete", node, ["scripts/smoke-stt.mjs", join(resources, "stt")]);
run("Comprobar navegador auxiliar del paquete", node, ["scripts/smoke-demo-runtime.mjs", "--standalone", payload, "--runtime", runtime, "--browser"]);
console.log(`[desktop:dist:win] Instalador verificado: ${installer} (${commit})`);
