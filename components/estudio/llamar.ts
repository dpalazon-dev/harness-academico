/** Llama a una operación del plugin Estudio por la misma ruta que usan sus vistas. */
export async function llamarEstudio<T = unknown>(operation: string, input?: unknown): Promise<T> {
	const res = await fetch("/api/plugins/estudio/call", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ operation, input }),
		cache: "no-store",
	});
	const body = await res.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
	if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Estudio no respondió (${res.status})`);
	return body?.result as T;
}

/** Un cambio de David en los elementos de su plan; se aplica al momento (spec de planes, decisión 9). */
export type CambioDelPlan =
	| { op: "add"; tipo: "tema" | "tarea" | "hito"; titulo: string; fecha?: string; index?: number }
	| { op: "remove"; elementoId: string }
	| { op: "move"; elementoId: string; index: number }
	| { op: "edit"; elementoId: string; titulo?: string; hecho?: boolean; fecha?: string | null };

export async function cambiarPlan(plan: { id: string; revision: number }, ...ops: CambioDelPlan[]): Promise<void> {
	await llamarEstudio("cambiar-plan", { id: plan.id, expectedRevision: plan.revision, ops });
}
