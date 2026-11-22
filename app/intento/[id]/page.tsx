import { PantallaIntento } from "@/components/estudio/intento";
import { RecorridoCampos } from "@/components/estudio/recorrido-campos";
import { readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

// Dinámica: «Discutir» comprueba si los modelos están configurados, como la página de unidad.
export const dynamic = "force-dynamic";

/** Armazón de estudio (ticket 06): un intento ocupa la ventana, sin barra lateral ni fuentes. */
export default async function IntentoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ volver?: string | string[] }> }) {
	const { id } = await params;
	const { volver } = await searchParams;
	return <RecorridoCampos><PantallaIntento key={id} id={id} volver={typeof volver === "string" ? volver : undefined} initialConfigured={slotsConfigured(readSettingsRecord()?.models)} /></RecorridoCampos>;
}
