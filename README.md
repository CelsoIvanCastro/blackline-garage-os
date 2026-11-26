# BLACKLINE GARAGE OS

Aplicacion de escritorio local para macOS orientada a restauracion automotriz, gestion de taller, documentacion historica, costos, inventario, IA y gemelo digital 3D.

## Estado actual

La fase 0 deja listo el cimiento tecnico:

- Electron + React + TypeScript.
- Backend local en el main process de Electron.
- SQLite persistente en el directorio `userData` de macOS.
- IPC tipado mediante preload.
- Kanban inicial del pipeline del taller con control de capacidad por etapa.
- CRUD inicial de proyectos de vehiculos.
- Visor 3D base en Three.js para el gemelo digital.
- Esquema de base de datos preparado para media, componentes, costos, inventario, IA, reportes e historial.

## Comandos

```bash
npm install
npm run dev
npm run build
```

## Documentacion

La arquitectura completa, estructura de carpetas, diseno de base de datos, roadmap, dependencias, modulos y riesgos estan en:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

