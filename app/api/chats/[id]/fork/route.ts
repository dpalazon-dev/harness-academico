// POST /api/chats/[id]/fork — bifurcar desde una respuesta del tutor
// (HarnessAcademico, diseño 4A aprobado por David el 23-nov-2026). Crea una
// conversación nueva con el historial hasta el final de esa respuesta, los
// mismos ajustes de modelo y la marca `forkedFrom`; Estudio la registra en el
// mismo espacio y unidad que el original. Cuerpo: { messageId }.
import { corteParaBifurcar } from "@/src/core";
import { getChat, getPluginHost, isTurnRunning, stores } from "@/src/server";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const original = getChat(id);
	if (!original) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await request.json().catch(() => null)) as { messageId?: unknown } | null;
	if (typeof body?.messageId !== "string" || body.messageId === "") {
		return Response.json({ error: "messageId must be a non-empty string" }, { status: 400 });
	}
	const corte = corteParaBifurcar(original.messages, body.messageId);
	if (!corte) return Response.json({ code: "not_a_reply", error: "Solo se puede bifurcar desde una respuesta del tutor." }, { status: 400 });
	// La última respuesta de un turno en marcha aún no está entera.
	if (corte.hastaElFinal && isTurnRunning(id)) {
		return Response.json({ code: "turn_in_flight", error: "Espera a que el tutor termine para bifurcar desde esta respuesta." }, { status: 409 });
	}
	const rama = stores.chatStore.forkChat(id, corte.mensajes, body.messageId);
	try {
		const host = await getPluginHost();
		await host.call("estudio", "rama-conversacion", { chatId: rama.id, origenId: id });
	} catch {
		// Sin Estudio la rama sigue siendo una conversación válida, fuera de cualquier espacio.
	}
	return Response.json({ id: rama.id, title: rama.title });
}
