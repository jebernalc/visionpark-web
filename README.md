# VISIONPARK · Forensic AI

Plataforma web de evidencia visual vehicular: un Pasaporte Visual 360° al ingreso y otro a la salida, comparación asistida por IA con confianza calibrada y decisión siempre humana.

- **Frontend:** aplicación estática (HTML, CSS y JavaScript con módulos), publicada en GitHub Pages. Compatible con Chrome, Edge, Firefox y Safari mediante mejora progresiva.
- **Datos:** Supabase (PostgreSQL con RLS, Auth, Storage privado, Realtime y pgvector).
- **IA pesada:** trabajadores en un servidor GPU privado que consultan la cola `inference_jobs` con conexión saliente (repositorio privado aparte, `visionpark-ai`).

## Estructura

| Ruta | Contenido |
| --- | --- |
| `index.html`, `src/` | Aplicación web |
| `supabase/migrations/` | Esquema versionado de la base de datos |
| `.github/workflows/pages.yml` | Verificación y despliegue a GitHub Pages |
| `docs/` | Arquitectura y guía de operación |

## Versiones

Se sigue versionado semántico. Cada versión estable lleva una etiqueta (`v0.1.0`) y el historial vive en `CHANGELOG.md`. La rama `main` es la que se publica.

## Seguridad

- En el repositorio solo se guarda la URL del proyecto y la clave **publishable**; el acceso a los datos lo controla RLS.
- La clave de servicio (`service_role`) nunca se sube: el flujo de despliegue falla si la encuentra.
- Los originales de evidencia son inmutables; toda edición es una copia derivada.
- Los cambios de esquema se hacen solo con migraciones revisadas.

## Puesta en marcha

1. En **Settings → Pages**, elegir **GitHub Actions** como fuente.
2. Empujar a `main`; el flujo publica el sitio.
3. En Supabase, **Authentication → URL Configuration**, añadir la dirección de Pages como *Site URL* y URL de redirección.
