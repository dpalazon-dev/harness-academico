import { EditorCuaderno } from "@/components/estudio/editor-cuadernos";

/** Armazón de estudio (ticket 09): el editor de un cuaderno; `?nuevo=1` al crearlo, para nombrarlo. */
export default async function CuadernoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nuevo?: string | string[] }> }) {
	const { id } = await params;
	const { nuevo } = await searchParams;
	return <EditorCuaderno key={id} id={id} nuevo={nuevo === "1"} />;
}
