import type { CicloUnidad, LecturaPlanes } from "./tipos";

export interface UnidadEnOrden { id: string; titulo: string; propuesta: boolean; enPlan: boolean; ciclo: CicloUnidad }

/** Las unidades del espacio en el orden de la barra: las de los temas de cada plan, sin archivadas ni repetidas, y
 * detrás las que no están en ningún plan. */
export function unidadesEnOrden(l: LecturaPlanes | null): UnidadEnOrden[] {
	if (!l) return [];
	const vistas = new Set<string>();
	const enPlanes: UnidadEnOrden[] = [];
	for (const p of l.planes) for (const e of p.elementos) {
		const u = e.unidad;
		if (!u || u.estado === "archivada" || vistas.has(u.id)) continue;
		vistas.add(u.id);
		enPlanes.push({ id: u.id, titulo: u.titulo, propuesta: u.estado === "propuesta", enPlan: true, ciclo: u.ciclo });
	}
	return [...enPlanes, ...l.sinPlan.filter(u => !vistas.has(u.id)).map(u => ({ ...u, enPlan: false }))];
}
