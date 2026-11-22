import { PaginaUnidad } from "@/components/estudio/unidad";
import { RecorridoCampos } from "@/components/estudio/recorrido-campos";
import { readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

// Dinámica: si los modelos están configurados se lee en cada navegación, como en el inicio.
export const dynamic = "force-dynamic";

/** Armazón de estudio (ADR 0002): cada unidad del plan tiene su página. */
export default async function UnidadPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	// Tab y Mayús+Tab recorren sus campos, empezando por el volcado (ticket 12).
	return <RecorridoCampos><PaginaUnidad key={id} id={id} initialConfigured={slotsConfigured(readSettingsRecord()?.models)} /></RecorridoCampos>;
}
