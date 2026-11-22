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

export type CambioDelPlan = { op: "add"; unitId: string } | { op: "remove"; unitId: string } | { op: "move"; unitId: string; index: number };

/** Un cambio del plan decidido por David: se propone y se aplica en un paso, con las mismas reglas que los del tutor. */
export async function cambiarPlan(planId: string, op: CambioDelPlan): Promise<void> {
	const propuesta = await llamarEstudio<{ id: string }>("proponer-cambio", { planId, ops: [op] });
	await llamarEstudio("aplicar-propuesta", { id: propuesta.id });
}

/** Confirmar una unidad propuesta es decidir que entra en el plan de su espacio: con plan, se propone y aplica su
 * añadido, que ya la confirma; sin plan, solo cambia su estado. */
export async function confirmarUnidad(u: { id: string; revision: number; planId: string | null }): Promise<void> {
	if (u.planId) {
		await cambiarPlan(u.planId, { op: "add", unitId: u.id });
	} else {
		await llamarEstudio("confirmar-unidad", { id: u.id, expectedRevision: u.revision });
	}
}
