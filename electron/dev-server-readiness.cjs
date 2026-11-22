// The dev server is externally launched and may still be building core packages
// or compiling its first route. Do not navigate Electron to a refused connection.
const http = require("node:http");
const https = require("node:https");

/**
 * Any HTTP response is ready: a Next development error page must remain visible.
 * A single total deadline also bounds connected servers that never send headers.
 * @param {string} url
 * @param {{signal?: AbortSignal, timeoutMs?: number, retryMs?: number}} [options]
 * @returns {Promise<void>}
 */
async function waitForResponse(url, { signal, timeoutMs = 30000, retryMs = 200 } = {}, expectedInstance) {
	const target = new URL(url);
	const transport = target.protocol === "http:" ? http : target.protocol === "https:" ? https : null;
	if (!transport) throw new Error("Development server URL must use HTTP or HTTPS");
	return new Promise((resolve, reject) => {
		let settled = false;
		let activeRequest;
		let retryTimer;
		let lastError;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			clearTimeout(retryTimer);
			signal?.removeEventListener("abort", abort);
			activeRequest?.destroy();
			if (error) reject(error);
			else resolve();
		};
		const abort = () => finish(signal.reason instanceof Error ? signal.reason : new Error("Development server startup cancelled"));
		const deadline = setTimeout(() => finish(new Error(
			`${expectedInstance ? "Packaged" : "Development"} server ${url} did not respond within ${timeoutMs}ms${lastError ? " (" + lastError.message + ")" : ""}`, { cause: lastError },
		)), timeoutMs);
		const attempt = () => {
			if (settled) return;
			const request = transport.get(target, { agent: false }, response => {
				response.on("error", () => {}); // Closing an unneeded response is intentional.
				response.resume();
				if (expectedInstance && (response.statusCode !== 200 || response.headers["x-harness-instance"] !== expectedInstance)) {
					lastError = new Error(response.statusCode !== 200 ? `HTTP ${response.statusCode}` : "unexpected server identity");
					activeRequest = undefined;
					request.destroy();
					retryTimer = setTimeout(attempt, retryMs);
					return;
				}
				finish();
			});
			activeRequest = request;
			request.once("error", error => {
				if (settled || request !== activeRequest) return;
				lastError = error;
				activeRequest = undefined;
				request.destroy();
				retryTimer = setTimeout(attempt, retryMs);
			});
		};
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		else attempt();
	});
}
// A cold first launch after installing measured 27-40 s (Windows checks every
// new file the first time Next opens it); 30 s failed it. Generous on purpose:
// the child exiting or the user quitting still end the wait immediately.
const PACKAGED_STARTUP_MS = 120000;
async function waitForPackagedServer(url, child, expectedInstance, options) {
	const controller = new AbortController();
	const exited = (code, signal) => controller.abort(new Error(`Server exited before startup (code=${code}, signal=${signal})`));
	const failed = error => controller.abort(error);
	child.once("exit", exited);
	child.once("error", failed);
	try {
		if (child.exitCode != null || child.signalCode != null) exited(child.exitCode, child.signalCode);
		await waitForResponse(url, { timeoutMs: PACKAGED_STARTUP_MS, ...options, signal: controller.signal }, expectedInstance);
	} finally {
		child.removeListener("exit", exited);
		child.removeListener("error", failed);
	}
}
module.exports = { waitForDevServer: waitForResponse, waitForPackagedServer, PACKAGED_STARTUP_MS };
