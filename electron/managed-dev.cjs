"use strict";
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");

// Next binds port zero itself. Its local URL comes from the child's stdout
// after listen(), so a listener on port 3000 cannot be selected by mistake.
async function startManagedDev(root, node, log, supervise) {
	const cli = require.resolve("next/dist/bin/next", { paths: [root] });
	const child = spawn(node, [cli, "dev", "-H", "127.0.0.1", "-p", "0"], {
		cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, FORCE_COLOR: "0" },
	});
	supervise(child);
	const lines = readline.createInterface({ input: child.stdout });
	lines.on("line", log);
	child.stderr.on("data", chunk => log(chunk.toString().trimEnd()));
	try {
		return await new Promise((resolve, reject) => {
			const finish = (error, url) => {
				clearTimeout(timer);
				lines.off("line", announced);
				child.off("exit", exited);
				child.off("error", failed);
				if (error) reject(error);
				else resolve({ url, child });
			};
			const announced = line => {
				const match = /\bLocal:\s+(http:\/\/127\.0\.0\.1:\d+)\s*$/.exec(line);
				if (match) finish(null, match[1]);
			};
			const exited = (code, signal) => finish(new Error(`Next dev terminó antes de escuchar (${code ?? signal}).`));
			const failed = error => finish(error);
			const timer = setTimeout(() => finish(new Error("Next dev no anunció un puerto en 30 segundos.")), 30000);
			lines.on("line", announced);
			child.once("exit", exited);
			child.once("error", failed);
		});
	} catch (error) {
		stopManagedDev(child);
		throw error;
	}
}

function stopManagedDev(child) {
	if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
	if (process.platform === "win32") {
		const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
		const result = spawnSync(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
		if (result.status === 0) return;
	}
	child.kill();
}

module.exports = { startManagedDev, stopManagedDev };
