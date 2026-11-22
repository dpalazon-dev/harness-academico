import { Lector } from "@/components/estudio/lector";
import { RecorridoCampos } from "@/components/estudio/recorrido-campos";
import { readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

// Dinámica: si los modelos están configurados se lee en cada navegación, como en la página de unidad.
export const dynamic = "force-dynamic";

/** Armazón de estudio (ticket 05): el lector de un documento, desde Biblioteca o desde una fuente de la unidad (`?unidad=`). */
export default async function LectorPage({ params, searchParams }: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ unidad?: string | string[]; pagina?: string | string[] }>;
}) {
	const { id } = await params;
	const q = await searchParams;
	const unidad = typeof q.unidad === "string" && q.unidad ? q.unidad : null;
	const pagina = typeof q.pagina === "string" && /^[1-9]\d*$/.test(q.pagina) ? Number(q.pagina) : null;
	return (
		<RecorridoCampos>
			<Lector
				key={`${id}:${unidad ?? ""}`}
				documentId={id}
				unidadId={unidad}
				paginaPedida={pagina}
				initialConfigured={slotsConfigured(readSettingsRecord()?.models)}
			/>
		</RecorridoCampos>
	);
}
