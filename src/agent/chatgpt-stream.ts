import type { Api, AssistantMessage, Model, SimpleStreamOptions, StreamFunction, TranscriptContext } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-responses";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { chatGPTAbortController, chatGPTScope, chatGPTScopeCurrent, chatGPTLease, chatGPTDenial } from "./chatgpt-bridge.ts";
import type { AdmissionScope, ChatGPTDispatchLifecycle } from "./chatgpt-request-cycle.ts";
import { capturePreparedBackgroundPayload } from "./background-capture.ts";
import { motivoDeError } from "./error-de-conexion.ts";

const USAGE = "https://chatgpt.com/settings/usage";
/** El mensaje del chat para un fallo de ChatGPT. `message` es el código de la conexión de escritorio (`motivoDeError`) o el
 * texto crudo, en inglés, del proveedor o de un error interno: las expresiones de abajo buscan esas palabras, no el español. */
export function chatGPTStreamError(message: string): string {
	if (/subscription_sharing_usage_limit_exceeded|quota|429/.test(message)) return `Has llegado al límite de uso de tu plan de ChatGPT. Puedes gestionarlo en ${USAGE}. No se ha usado ninguna clave de API en su lugar.`;
	if (/scope|authorization_context|permission/.test(message)) return "Falta el permiso para usar tu plan de ChatGPT. Vuelve a conectar en Ajustes › Proveedores y autoriza el uso del plan. No se ha usado ninguna clave de API en su lugar.";
	if (/expired|invalid_grant|401|invalid_user/.test(message)) return "Tu sesión de ChatGPT ha caducado. Vuelve a conectar en Ajustes › Proveedores. No se ha usado ninguna clave de API en su lugar.";
	if (/background|Background/.test(message)) return "El uso en segundo plano de ChatGPT está desactivado en esta app. Activa «Permitir el uso en segundo plano en todas las cuentas de ChatGPT» en Ajustes › Proveedores para hacer este trabajo. No se ha usado ninguna clave de API en su lugar.";
	if (/eligible|403/.test(message)) return "Esta cuenta o espacio de trabajo de ChatGPT no permite esta petición. Revisa los ajustes de ChatGPT; volver a conectar puede no cambiarlo.";
	if (/cancel|abort|closed|disconnect/i.test(message)) return "La petición a ChatGPT se canceló o se cerró la conexión. No se ha usado ninguna clave de API en su lugar.";
	if (/catalog|model/.test(message)) return "El modelo elegido no está disponible para esta cuenta de ChatGPT. Vuelve a cargar Ajustes › Proveedores y elige un modelo disponible. No se ha usado ninguna clave de API en su lugar.";
	if (/incomplete|terminal|interrupted|stop reason/.test(message)) return "ChatGPT devolvió una respuesta incompleta. Reinténtalo cuando quieras; no se ha usado ninguna clave de API en su lugar.";
	return "Falló la petición a ChatGPT. Comprueba tu conexión y el uso de ChatGPT, y reinténtalo. No se ha usado ninguna clave de API en su lugar.";
}

/** Restrict the body at the final payload seam, even if caller samplingParams add fields. */
export function chatGPTPayload(raw: unknown, selectedModelId: string): Record<string, unknown> {
	const payload = raw as Record<string, unknown>;
	const out: Record<string, unknown> = { model: selectedModelId, store: false, stream: true };
	for (const key of ["instructions", "reasoning", "include", "text", "tool_choice", "parallel_tool_calls", "prompt_cache_key"]) {
		if (payload[key] !== undefined) out[key] = payload[key];
	}
	if (!Array.isArray(payload.input)) throw new Error("ChatGPT requires stateless input history");
	out.input = payload.input.map((item) => item?.role === "system" ? { ...item, role: "developer" } : item);
	if (Array.isArray(payload.tools) && payload.tools.length) {
		if (payload.tools.some((tool) => tool.type !== "function" && tool.type !== "custom")) throw new Error("Unsupported ChatGPT tool capability");
		out.tools = [{ type: "namespace", name: "learnharness", description: "HarnessAcademico local learning tools", tools: payload.tools }];
	}
	return out;
}

/** Only ChatGPT history is translated. Mixed API-key history keeps its actual identity. */
export function chatGPTHistory(context: TranscriptContext, logicalModel: Model<Api>): TranscriptContext {
	// Apply Pi's normal foreign-model signature treatment BEFORE the alias
	// becomes openai, or real API-key turns could look like subscription turns.
	const messages = transformMessages(context.messages, logicalModel);
	return { ...context, messages: messages.map((m) => m.role === "assistant" && m.provider === "chatgpt" ? { ...m, provider: "openai" } : m) };
}
function empty(model: Model<Api>): AssistantMessage {
	return { role: "assistant", api: model.api, provider: "chatgpt", model: model.id, content: [], stopReason: "error", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
export function chatGPTStream(background: () => boolean, lifecycle?: ChatGPTDispatchLifecycle): StreamFunction<Api, SimpleStreamOptions> {
	return (logicalModel, context, options) => {
		const output = new AssistantMessageEventStream();
		const purpose = background();
		const { controller, release } = chatGPTAbortController(purpose);
		const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
		void (async () => {
			let partial = empty(logicalModel);
			let completed = false;
			let failure = "";
			let scope: AdmissionScope | undefined;
			let committed = false;
			let terminal = false;
			const check = () => { if (signal.aborted || !scope || !chatGPTScopeCurrent(scope)) throw new Error("cancelled or catalog authority changed"); };
			try {
				if (logicalModel.provider !== "chatgpt") throw new Error("ChatGPT account catalog has no selected model");
				if (Object.keys(options?.headers ?? {}).some((key) => key.toLowerCase() === "authorization")) throw new Error("Authorization override is forbidden");
				scope = chatGPTScope(logicalModel.id);
				lifecycle?.captured(scope);
				const credentials = await chatGPTLease(scope, purpose);
				check();
				// NEVER dispatch through Models under openai: that would expose ambient API-key fallback.
				const transport: Model<"openai-responses"> = { ...logicalModel, api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1", headers: undefined, samplingParams: undefined, compat: { ...logicalModel.compat, supportsDeveloperRole: true } };
				const delegate = options?.fetch ?? globalThis.fetch;
				const source = streamSimple(transport, chatGPTHistory(context, logicalModel), {
					...options,
					apiKey: credentials.accessToken,
					signal,
					maxRetries: 0,
					headers: { "OpenAI-Beta": null, ...options?.headers },
					fetch: (input, init) => {
						check();
						if (committed) throw new Error("ChatGPT does not retry admitted requests");
						lifecycle?.beforeDispatch(scope!);
						committed = true;
						return delegate(input, init);
					},
					onPayload: async (raw, model) => {
						const replacement = await options?.onPayload?.(raw, model);
						const payload = chatGPTPayload(replacement === undefined ? raw : replacement, logicalModel.id);
						check();
						capturePreparedBackgroundPayload(payload, logicalModel);
						return payload;
					},
					onProviderStreamEvent: async (raw, model) => {
						const event = raw as { type?: string; code?: string; error?: { code?: string }; response?: { error?: { code?: string }; status?: string } };
						if (event.type === "response.completed" && event.response?.status === "completed" && !event.response?.error) completed = true;
						if (["response.incomplete", "response.failed", "error"].includes(event.type ?? "") || event.response?.error) failure = event.code || event.error?.code || event.response?.error?.code || "incomplete terminal response";
						await options?.onProviderStreamEvent?.(raw, model);
					},
				});
				for await (const event of source) {
					const message = "partial" in event ? event.partial : event.type === "done" ? event.message : event.error;
					// Copy the message, not its tool/reasoning blocks: IDs/signatures remain byte-for-byte intact.
					partial = { ...message, provider: "chatgpt" };
					if (event.type === "done") {
						if (!completed || failure) throw new Error(failure || "missing terminal response.completed");
						terminal = true;
						output.push({ ...event, message: partial });
					} else if (event.type === "error") {
						throw new Error(failure || event.error.errorMessage || "ChatGPT stream error");
					} else output.push({ ...event, partial });
				}
			} catch (err) {
				if (terminal) return;
				if (!committed) lifecycle?.noDispatch(await chatGPTDenial(scope, controller, options?.signal?.aborted === true, purpose));
				partial = { ...partial, stopReason: signal.aborted ? "aborted" : "error", errorMessage: chatGPTStreamError(motivoDeError(err)) };
				output.push({ type: "error", reason: partial.stopReason as "error" | "aborted", error: partial });
			} finally { release(); output.end(); }
		})();
		return output;
	};
}
