# Portadas EPUB

Web (PWA) para cambiar la portada de un EPUB desde el móvil: eliges el libro, eliges una imagen y te devuelve el EPUB con la portada nueva.

**https://iaadileli.github.io/portadas-epub/**

- Todo ocurre en el navegador: el libro no se sube a ningún servidor.
- Sirve para EPUB 2 y EPUB 3, con o sin portada previa.
- Declara la portada de las dos maneras (`meta name="cover"` y `properties="cover-image"`) para que la vea cualquier lector.
- Ajusta la página de portada a la forma de la imagen nueva para que no salga deformada.

## Desarrollo

```sh
npm install
npm run servir     # http://localhost:8766
npm run probar     # batería de pruebas en Chrome + epubcheck
```

`npm run probar` necesita epubcheck 4.2.6 en `test/herramientas/` (no va al repo):
descárgalo de https://github.com/w3c/epubcheck/releases/tag/v4.2.6 y descomprímelo ahí.
