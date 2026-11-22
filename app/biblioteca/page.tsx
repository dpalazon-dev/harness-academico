import { Biblioteca } from "@/components/estudio/biblioteca";
import { RecorridoCampos } from "@/components/estudio/recorrido-campos";

/** Armazón de estudio (ticket 05, historia 9): los documentos del espacio activo. */
export default function BibliotecaPage() {
	return <RecorridoCampos><Biblioteca /></RecorridoCampos>;
}
