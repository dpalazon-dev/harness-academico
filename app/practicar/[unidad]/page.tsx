import { PantallaPracticar } from "@/components/estudio/intento";
import { RecorridoCampos } from "@/components/estudio/recorrido-campos";

const texto = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

/** Armazón de estudio (ticket 06): «Practicar» desde la unidad, en pantalla dedicada y sin barra lateral. Con
 * `?cuaderno=&bloque=`, practica esa pregunta de recuperación (ticket 09). */
export default async function PracticarPage({ params, searchParams }: {
	params: Promise<{ unidad: string }>;
	searchParams: Promise<{ volver?: string | string[]; cuaderno?: string | string[]; bloque?: string | string[] }>;
}) {
	const { unidad } = await params;
	const q = await searchParams;
	const cuaderno = texto(q.cuaderno);
	const bloque = texto(q.bloque);
	return (
		<RecorridoCampos>
			<PantallaPracticar
				key={`${unidad}:${cuaderno ?? ""}:${bloque ?? ""}`}
				unitId={unidad}
				volver={texto(q.volver)}
				pregunta={cuaderno && bloque ? { cuaderno, bloque } : undefined}
			/>
		</RecorridoCampos>
	);
}
