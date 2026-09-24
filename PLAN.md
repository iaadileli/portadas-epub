# PLAN — Portadas EPUB

Idea de Adil (24-sep-2026): «no me gusta cuando un EPUB tiene una portada feísima en el lector; quiero una app en el móvil, le echo un EPUB y una imagen y le cambia la portada».

## Cómo está hecho

| Pieza | Qué hace |
|---|---|
| `portada.js` | Núcleo. Abre el EPUB (JSZip), localiza la portada y la sustituye. |
| `app.js` | Pantalla: elegir libro, elegir imagen, redimensionar/recortar con canvas, compartir/descargar. |
| `sw.js` + `pwa.js` | Funciona sin conexión y avisa de versión nueva. **Subir `CACHE` en cada versión.** |
| `test/probar.mjs` | 5 EPUB de laboratorio por la app real en Chrome + epubcheck. |
| `test/reales.mjs` | Pasa EPUB reales y compara errores de epubcheck antes/después. |

### Cómo busca la portada
1. `item` con `properties="cover-image"` (EPUB 3).
2. `<meta name="cover" content="id">` (EPUB 2).
3. Imagen usada en la página de portada (`<guide type="cover">` o una de las 3 primeras del spine).
4. Imagen con «cover/portada/cubierta» en el nombre.

### Cómo la cambia
- **Portada JPG/PNG**: sobrescribe el fichero en su sitio, en el mismo formato. Así todo lo que apuntaba a ella sigue valiendo. Ajusta el `viewBox` o el `<img>` de la página de portada a la forma nueva.
- **Sin portada o en formato raro (GIF…)**: añade una imagen nueva, la declara como portada y reescribe o crea la página de portada (la primera del libro).
- Siempre deja `meta cover` y `cover-image` (en EPUB 3) apuntando a la misma imagen.
- Reempaqueta con `mimetype` el primero y sin comprimir (lo exige el estándar).
- Imagen: lado mayor ≤ 2400 px, JPEG al 90 %. Opción de recortar a 2:3.

## Estado

- [x] v1.0: núcleo, pantalla, PWA, pruebas de laboratorio y con los EPUB reales del Mac.
- [ ] Adil la prueba en el iPhone con un libro de verdad.

## Ideas (solo si Adil las pide)
- Buscar la portada buena por internet (Open Library) a partir del título.
- Varios libros a la vez.
- Encuadre manual del recorte (ahora recorta centrado).
