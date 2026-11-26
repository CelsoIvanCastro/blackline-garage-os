# BLACKLINE GARAGE OS - Arquitectura

## 1. Vision tecnica

BLACKLINE GARAGE OS es una aplicacion local de escritorio para macOS. El producto debe operar sin sistema de usuarios obligatorio, conservar toda la informacion despues de cerrar la app y escalar a miles de proyectos con decadas de historial, grandes galerias, documentos, videos y gemelos digitales.

La arquitectura se divide en cuatro capas:

1. Renderer: React + TypeScript para la experiencia visual, Kanban, formularios, galeria, inventario, reportes y visor 3D.
2. Preload: puente seguro IPC con una API tipada expuesta a `window.blackline`.
3. Main process: backend Node.js local, servicios de dominio, repositorios, orquestacion de IA, trabajos pesados y acceso a disco.
4. Persistencia: SQLite local, archivos binarios en carpetas gestionadas y metadatos indexados en base de datos.

## 2. Principios de arquitectura

- Local first: todos los datos viven en el equipo del usuario.
- Persistencia durable: SQLite con WAL, claves foraneas, migraciones y rutas de archivos estables.
- Separacion por dominio: proyectos, pipeline, costos, inventario, media, checklist, IA, gemelo digital y reportes.
- IPC explicito: el renderer no accede directamente a Node, filesystem ni SQLite.
- Escalabilidad operativa: archivos grandes fuera de SQLite, metadatos en tablas indexadas.
- IA desacoplada: cada analisis se registra como job, artifact y resultado persistible.
- Evolucion por fases: el producto puede iniciar simple y crecer sin reescribir la base.

## 3. Estructura de carpetas

```text
blackline-garage-os/
  docs/
    ARCHITECTURE.md
  src/
    main/
      database/
        connection.ts
        schema.ts
      repositories/
        projectRepository.ts
      services/
        pipelineService.ts
      index.ts
      ipc.ts
    preload/
      index.ts
    renderer/
      src/
        components/
          DigitalTwinViewport.tsx
          PipelineBoard.tsx
          ProjectCard.tsx
          ProjectEditor.tsx
          ProjectForm.tsx
          Sidebar.tsx
          SummaryBar.tsx
        styles/
          app.css
        App.tsx
        main.tsx
        vite-env.d.ts
    shared/
      types.ts
  electron.vite.config.ts
  package.json
  tsconfig.json
```

Estructura futura recomendada:

```text
src/main/
  ai/
    research/
    inspection/
    photogrammetry/
  media/
    mediaLibrary.ts
    thumbnailService.ts
  reports/
    pdfService.ts
  inventory/
  costs/
  components/
  jobs/
  filesystem/
src/renderer/src/
  features/
    projects/
    pipeline/
    costs/
    inventory/
    gallery/
    reports/
    digital-twin/
```

## 4. Modulos

### Proyectos de vehiculos

Gestiona marca, modelo, año, submodelo, VIN, colores, notas, estado, archivado y completado.

### Pipeline del taller

Etapas configurables:

1. Inspeccion Total General
2. Mecanica / Electrico
3. Sonido
4. Exterior
5. Pintura
6. Ensamblaje Exterior e Interior
7. Detallado Total
8. Completado

Cada etapa tiene `capacity`. Por defecto es `1`. El servicio de pipeline valida capacidad antes de crear o mover proyectos.

### Media y documentacion

Fotos, videos y documentos se guardan como archivos locales. SQLite conserva metadatos, categoria, hash, rutas, fechas y relacion con proyecto o componente.

Categorias de galeria:

- Recepcion
- Desarme
- Reparacion
- Pintura
- Ensamble
- Final

### Componentes y checklist

Cada componente puede almacenar estado, costos, fotos, historial, notas, fecha de compra y fecha de instalacion.

Estados minimos:

- Pendiente
- Comprado/Reparado
- Ensamblado

### Costos

Categorias:

- Compra
- Reparacion
- Pintura
- Mano de obra
- Transporte

Se calcula total invertido, presupuesto y diferencia por proyecto.

### Inventario

Preparado para refacciones, materiales, herramientas, consumibles, proveedores y compras.

### IA de investigacion automotriz

Modulo futuro para VIN, fichas tecnicas, referencias OEM, documentacion y comparacion historica. Los resultados se persisten como `research_records` y `ai_artifacts`.

### IA de inspeccion

Modulo futuro para analisis de fotos y videos, deteccion de daños, componentes y piezas faltantes, y generacion de checklist.

### Gemelo digital

Modulo futuro para fotogrametria, reconstruccion 3D, modelos por version, capas, visibilidad, transparencia, modo rayos X y navegacion interior/exterior.

### Reportes

Modulo futuro para PDF, historial, costos, avance y timeline completo.

## 5. Base de datos

SQLite se almacena en:

```text
~/Library/Application Support/BLACKLINE GARAGE OS/data/blackline-garage-os.sqlite
```

El main process activa:

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`

### Tablas principales

#### `pipeline_stages`

- `id`
- `code`
- `name`
- `position`
- `capacity`
- `is_terminal`
- `created_at`
- `updated_at`

#### `vehicle_projects`

- `id`
- `stage_id`
- `status`
- `make`
- `model`
- `year`
- `submodel`
- `vin`
- `current_color`
- `oem_color`
- `notes`
- `budget_cents`
- `created_at`
- `updated_at`
- `archived_at`
- `completed_at`

#### `project_media`

- `id`
- `project_id`
- `component_id`
- `kind`
- `category`
- `local_path`
- `filename`
- `mime_type`
- `hash`
- `captured_at`
- `metadata_json`
- `created_at`

#### `components`

- `id`
- `project_id`
- `layer`
- `name`
- `status`
- `notes`
- `purchase_date`
- `installation_date`
- `created_at`
- `updated_at`

#### `checklists` y `checklist_items`

Listas manuales o generadas por IA, con items por componente, estado, prioridad y evidencia.

#### `cost_entries`

Registros de compra, reparacion, pintura, mano de obra y transporte vinculados a proyecto, componente, proveedor o compra.

#### `inventory_items`, `suppliers`, `purchases`, `purchase_items`

Base para refacciones, materiales, herramientas, consumibles, proveedores y compras.

#### `history_events`

Timeline completo del proyecto con eventos manuales, automaticos y derivados de IA.

#### `research_records`, `inspection_runs`, `ai_artifacts`

Resultados persistidos de investigacion, inspeccion y futuros asistentes.

#### `digital_twins` y `digital_twin_layers`

Versiones del gemelo digital, rutas a modelos, estado de reconstruccion y capas configurables.

## 6. Indices recomendados

- `vehicle_projects(status, stage_id)`
- `vehicle_projects(vin)`
- `vehicle_projects(make, model, year)`
- `project_media(project_id, category)`
- `components(project_id, layer, status)`
- `cost_entries(project_id, category)`
- `inventory_items(type, name)`
- `history_events(project_id, occurred_at)`
- `ai_artifacts(project_id, artifact_type)`
- `digital_twins(project_id, status)`

## 7. Dependencias

### Runtime

- `electron`: aplicacion macOS.
- `react` y `react-dom`: UI.
- `better-sqlite3`: SQLite local rapido y sincronico dentro del main process.
- `three`: visor 3D y gemelo digital.
- `lucide-react`: iconografia de interfaz.

### Desarrollo

- `electron-vite`: build y dev server para Electron + Vite.
- `vite`: bundling del renderer.
- `typescript`: tipado.
- `@vitejs/plugin-react`: React con Vite.
- `electron-builder`: empaquetado macOS.

### Dependencias futuras

- PDF: `pdf-lib` o `puppeteer` local para reportes.
- Imagen: OpenCV o modelos ONNX ejecutados localmente.
- IA local: ONNX Runtime, Core ML o integraciones configurables.
- Fotogrametria: pipeline externo invocable por jobs, por ejemplo Meshroom, COLMAP u otra herramienta compatible.
- Modelos 3D: `three-stdlib`, `GLTFLoader`, `DRACOLoader`, `KTX2Loader`.

## 8. Roadmap tecnico

### Fase 0 - Cimiento

- Scaffold Electron + React + TypeScript.
- SQLite con migraciones.
- API IPC tipada.
- Pipeline Kanban con control de capacidad.
- CRUD inicial de vehiculos.
- Visor 3D base.

### Fase 1 - Operacion real de taller

- Edicion completa de proyectos.
- Ajuste de capacidad por etapa.
- Historial automatico.
- Busqueda avanzada.
- Archivado, completado y filtros.

### Fase 2 - Media y documentos

- Importacion de fotos, videos y documentos.
- Copia controlada al storage local de la app.
- Miniaturas, categorias y metadata.
- Galeria por etapa.

### Fase 3 - Componentes, checklist y costos

- Catalogo de componentes por capas.
- Checklist manual y generada.
- Costos por componente y proyecto.
- Presupuesto, total invertido y diferencia.

### Fase 4 - Inventario y proveedores

- Refacciones, materiales, herramientas y consumibles.
- Compras y proveedores.
- Enlace entre inventario y proyectos.

### Fase 5 - Reportes

- PDFs de avance, costos, historial y timeline.
- Exportacion de documentacion del proyecto.

### Fase 6 - IA de investigacion e inspeccion

- Jobs locales para VIN, fichas tecnicas, referencias OEM y checklist sugerido.
- Analisis de imagen/video para daños, componentes y piezas faltantes.

### Fase 7 - Gemelo digital avanzado

- Importacion de modelos GLB/GLTF.
- Capas, transparencia y rayos X.
- Vista interior/exterior.
- Fotogrametria y reconstruccion por versiones.

### Fase 8 - Optimizacion del taller

- Prediccion de tiempos y costos.
- Recomendaciones automaticas.
- Optimizacion de capacidad y flujo.

## 9. Riesgos tecnicos

- Tamaño de media: fotos y videos no deben guardarse como BLOB en SQLite.
- Native modules: `better-sqlite3` requiere compatibilidad con Electron y reconstruccion al empaquetar.
- Fotogrametria: es intensiva en CPU/GPU y puede requerir jobs externos.
- IA local: modelos grandes pueden impactar disco, memoria y privacidad operacional.
- Busqueda en miles de proyectos: se debe incorporar FTS5 y paginacion en fases tempranas.
- Backups: una app local necesita exportacion, backup y restauracion.
- Integridad de archivos: mover o borrar media fuera de la app puede romper referencias si no hay control.
- Versionado de esquema: migraciones deben ser monotonicamente versionadas.
- Performance 3D: modelos pesados requieren compresion, LOD y carga progresiva.
- Seguridad IPC: nunca exponer filesystem crudo al renderer.
