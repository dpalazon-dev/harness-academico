---
status: accepted
---

# Armazón propio de estudio; se deja de fusionar LearnHarness

Estudio vivía como una página de plugin dentro del armazón de LearnHarness, y la API de plugins no permite tocar el inicio, agrupar la barra lateral, crear conversaciones ni escribir en el cuadro de mensaje. David quiere que la experiencia de estudio sea la aplicación, como en DeepTutor («Es que está todo dentro de Estudio pero no es como DeepTutor, que el UI/UX me resulta mucho mucho mejor»), y ante la pregunta de si dejar de seguir el original respondió «Sí, rediseñar» (12 de noviembre de 2026). Se rediseñan inicio, barra lateral, navegación y pantallas de estudio en el núcleo del fork; el motor de Estudio (regulador, base de conocimiento, documentos, cuadernos, conversaciones y herramientas del tutor) se conserva y puede seguir en el plugin.

## Consecuencias

- El objetivo O1 del diseño queda relajado: ya no se fusionan versiones del original; lo útil se trae a mano con cherry-pick.
- Las restricciones de la API de plugins dejan de limitar la interfaz: el armazón puede, por ejemplo, abrir una conversación nueva con contexto, como ya hace el inicio del núcleo con el contexto del grafo.

## Opciones consideradas

- **Sin tocar el núcleo** (una vista por sección con su entrada en la barra lateral): barato, pero sigue siendo el armazón de LearnHarness.
- **Mezcla**: parte en el núcleo y parte como vistas de plugin; descartada al decidir rediseñar el armazón entero.
