# Temas HTML de ProPlayer

Cada tema es un documento HTML independiente. El catálogo `manifest.json` registra su `id`, nombre, meses sugeridos y ruta del archivo HTML.

## Añadir un tema

1. Crea un archivo `mi-tema.html` dentro de esta carpeta.
2. Incluye al menos un bloque `<style>` con los estilos del tema.
3. Coloca dentro de `<body>` los elementos decorativos opcionales. No incluyas scripts: ProPlayer no ejecuta JavaScript procedente de temas.
4. Añade una entrada en `manifest.json` dentro de `themes`, con `id`, `name`, `months`, `html` y `theme` (variables de color).
5. Publica `themes/manifest.json` y el nuevo HTML en la rama `main` del repositorio. El botón «Actualizar temas» descargará el catálogo y los HTML.

Los temas se pueden activar manualmente en cualquier momento. «Automático por temporada» usa `months`; «Tema predeterminado» desactiva la capa estacional. La selección manual se conserva al reiniciar.

## Convenciones CSS

La raíz recibe `data-seasonal-theme="<id>"` y la clase `pp-seasonal-active`. Para estilos específicos, usa selectores como `html[data-seasonal-theme="mi-tema"]`. Los estilos del tema se eliminan al cambiar a otro tema.
