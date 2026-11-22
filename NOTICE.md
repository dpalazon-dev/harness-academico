# Aviso de obra modificada

HarnessAcademico es una versión modificada de [LearnHarness](https://github.com/amosblomqvist/learnharness), de Amos Blomqvist.

- **Obra original:** LearnHarness 0.6.0, etiqueta `v0.6.0`, commit `a63664767ebdd7e5af08f7f501b720e02b2ddc32`.
- **Licencia:** GNU Affero General Public License, versión 3 únicamente (AGPL-3.0-only). El texto está en `LICENSE` y no se ha alterado respecto del original.
- **Modificaciones:** de David Palazón, desde el 11 de noviembre de 2026. Este repositorio parte de una instantánea única de ese trabajo, sin su historial de desarrollo; las divergencias respecto del original se describen en `docs/sistema-comun/divergencias.md` y `docs/adr/`.
- **Nombre:** esta versión se llama HarnessAcademico. «LearnHarness» designa la obra original y no se usa para identificar esta.

La obra modificada completa se rige por la AGPL-3.0-only. Quien reciba una copia, o la use a través de una red, tiene derecho a obtener su código fuente correspondiente en los términos de esa licencia.

## Créditos e inspiración

HarnessAcademico reúne en una sola aplicación ideas de varios proyectos. Esta sección los reconoce, haya o no código suyo en el repositorio; las obligaciones de licencia, cuando las hay, están en la sección siguiente.

- **[LearnHarness](https://github.com/amosblomqvist/learnharness)**, de Amos Blomqvist (AGPL-3.0-only). Es la base: el tutor conversacional, la práctica, el grafo de conocimiento, la plataforma de plugins y la aplicación de escritorio vienen de ahí.
- **[StudyHarness](https://github.com/Ihjas-tk/study-harness)**, de Ihjas-tk (MIT). Inspira el ciclo de evaluación: respuesta congelada antes de ver la referencia, autoevaluación, calibración de la confianza y repaso espaciado. Tres archivos adaptan además su código; véase `plugins/estudio/THIRD-PARTY.md`.
- **[DeepTutor](https://github.com/HKUDS/DeepTutor)**, de HKUDS (Apache-2.0). Inspira la organización de la experiencia (centro de conocimiento, lectura con la fuente al lado, aprendizaje guiado, cuadernos y espacios por materia) y varias reglas de evaluación, como que declarar no es demostrar y que la ayuda resta independencia. No contiene código suyo.
- **[riddled.ai](https://riddled.ai)**. Inspira la forma de los cuadernos: anotaciones en tinta al margen de la frase, un modo que decide si el tutor interviene por su cuenta, un propósito escrito por quien estudia y varios lectores con criterio distinto sobre el mismo texto. Se toma la idea de interacción, no su marca, sus textos ni su diseño gráfico. No contiene código suyo.
- **[Pi](https://github.com/earendil-works/pi)**, de Mario Zechner (MIT). Motor de agente sobre el que funciona la conversación, heredado de LearnHarness.

## Material de terceros

- **Dentro del original:** los avisos que LearnHarness ya incluía se conservan en su sitio (`plugins/*/THIRD-PARTY.md`, `plugins/flashcards/FSRS-LICENSE.txt`, `docs/compaction-accounting.md`, `public/fonts/OFL.txt` y las cabeceras de `src/agent/image-processing/`).
- **Añadido por esta versión:** `plugins/estudio/THIRD-PARTY.md` (StudyHarness, MIT; DeepTutor como referencia sin código).
- **Herramientas de desarrollo:** `.agents/matt-pocock-LICENSE` (MIT); no forman parte de la aplicación distribuida.
