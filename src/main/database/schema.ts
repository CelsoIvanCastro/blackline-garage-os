import type Database from 'better-sqlite3'

interface Migration {
  version: number
  name: string
  sql: string
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pipeline_stages (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL UNIQUE,
        capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
        is_terminal INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vehicle_projects (
        id TEXT PRIMARY KEY,
        stage_id TEXT NOT NULL REFERENCES pipeline_stages(id),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'completed')),
        make TEXT NOT NULL,
        model TEXT NOT NULL,
        year INTEGER,
        submodel TEXT NOT NULL DEFAULT '',
        vin TEXT NOT NULL DEFAULT '',
        current_color TEXT NOT NULL DEFAULT '',
        oem_color TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        budget_cents INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS components (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        layer TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'purchased_or_repaired', 'assembled')),
        notes TEXT NOT NULL DEFAULT '',
        purchase_date TEXT,
        installation_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checklists (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_inspection', 'ai_research')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checklist_items (
        id TEXT PRIMARY KEY,
        checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
        component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'blocked')),
        priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 5),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        contact_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('part', 'material', 'tool', 'consumable')),
        name TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
        quantity REAL NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT 'unit',
        unit_cost_cents INTEGER NOT NULL DEFAULT 0,
        location TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchases (
        id TEXT PRIMARY KEY,
        supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        invoice_number TEXT NOT NULL DEFAULT '',
        purchased_at TEXT NOT NULL,
        total_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_items (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
        inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit_cost_cents INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cost_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
        supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
        purchase_id TEXT REFERENCES purchases(id) ON DELETE SET NULL,
        category TEXT NOT NULL CHECK (category IN ('purchase', 'repair', 'paint', 'labor', 'transport')),
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL DEFAULT 0,
        occurred_on TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_media (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN ('photo', 'video', 'document', 'model')),
        category TEXT NOT NULL DEFAULT 'reception' CHECK (category IN ('reception', 'disassembly', 'repair', 'paint', 'assembly', 'final', 'technical', 'other')),
        local_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL DEFAULT '',
        captured_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS history_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS research_records (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        vin TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        summary TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inspection_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        source_media_id TEXT REFERENCES project_media(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        model_name TEXT NOT NULL DEFAULT '',
        findings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        inspection_run_id TEXT REFERENCES inspection_runs(id) ON DELETE CASCADE,
        research_record_id TEXT REFERENCES research_records(id) ON DELETE CASCADE,
        artifact_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS digital_twins (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'placeholder' CHECK (status IN ('placeholder', 'processing', 'ready', 'failed', 'archived')),
        model_path TEXT NOT NULL DEFAULT '',
        source_media_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS digital_twin_layers (
        id TEXT PRIMARY KEY,
        digital_twin_id TEXT NOT NULL REFERENCES digital_twins(id) ON DELETE CASCADE,
        layer TEXT NOT NULL CHECK (layer IN ('exterior', 'interior', 'engine', 'chassis', 'suspension', 'electrical', 'glass', 'upholstery')),
        visible INTEGER NOT NULL DEFAULT 1,
        opacity REAL NOT NULL DEFAULT 1 CHECK (opacity >= 0 AND opacity <= 1),
        xray_enabled INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        report_type TEXT NOT NULL CHECK (report_type IN ('history', 'costs', 'progress', 'timeline', 'complete')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'failed')),
        local_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_status_stage ON vehicle_projects(status, stage_id);
      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_vin ON vehicle_projects(vin);
      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_make_model_year ON vehicle_projects(make, model, year);
      CREATE INDEX IF NOT EXISTS idx_project_media_project_category ON project_media(project_id, category);
      CREATE INDEX IF NOT EXISTS idx_components_project_layer_status ON components(project_id, layer, status);
      CREATE INDEX IF NOT EXISTS idx_cost_entries_project_category ON cost_entries(project_id, category);
      CREATE INDEX IF NOT EXISTS idx_inventory_items_type_name ON inventory_items(type, name);
      CREATE INDEX IF NOT EXISTS idx_history_events_project_occurred ON history_events(project_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_ai_artifacts_project_type ON ai_artifacts(project_id, artifact_type);
      CREATE INDEX IF NOT EXISTS idx_digital_twins_project_status ON digital_twins(project_id, status);
    `
  },
  {
    version: 2,
    name: 'phase_one_operations',
    sql: `
      PRAGMA foreign_keys = OFF;

      CREATE TABLE IF NOT EXISTS vehicle_projects_v2 (
        id TEXT PRIMARY KEY,
        stage_id TEXT NOT NULL REFERENCES pipeline_stages(id),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived', 'completed')),
        make TEXT NOT NULL,
        model TEXT NOT NULL,
        year INTEGER,
        submodel TEXT NOT NULL DEFAULT '',
        vin TEXT NOT NULL DEFAULT '',
        current_color TEXT NOT NULL DEFAULT '',
        oem_color TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        budget_cents INTEGER NOT NULL DEFAULT 0,
        current_stage_entered_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        completed_at TEXT
      );

      INSERT INTO vehicle_projects_v2 (
        id, stage_id, status, make, model, year, submodel, vin, current_color,
        oem_color, notes, budget_cents, current_stage_entered_at, created_at,
        updated_at, archived_at, completed_at
      )
      SELECT
        id, stage_id, status, make, model, year, submodel, vin, current_color,
        oem_color, notes, budget_cents, created_at, created_at,
        updated_at, archived_at, completed_at
      FROM vehicle_projects
      WHERE EXISTS (
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vehicle_projects'
      );

      DROP TABLE IF EXISTS vehicle_projects;
      ALTER TABLE vehicle_projects_v2 RENAME TO vehicle_projects;

      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS project_stage_times (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL REFERENCES pipeline_stages(id),
        entered_at TEXT NOT NULL,
        exited_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_checklist_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK (section IN ('interior', 'exterior')),
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'purchased_or_repaired', 'assembled')),
        notes TEXT NOT NULL DEFAULT '',
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO project_stage_times (
        id, project_id, stage_id, entered_at, exited_at, created_at, updated_at
      )
      SELECT
        'stage_time_' || id,
        id,
        stage_id,
        created_at,
        completed_at,
        created_at,
        updated_at
      FROM vehicle_projects
      WHERE NOT EXISTS (
        SELECT 1 FROM project_stage_times WHERE project_stage_times.project_id = vehicle_projects.id
      );

      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_status_stage ON vehicle_projects(status, stage_id);
      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_vin ON vehicle_projects(vin);
      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_make_model_year ON vehicle_projects(make, model, year);
      CREATE INDEX IF NOT EXISTS idx_project_stage_times_project_stage ON project_stage_times(project_id, stage_id);
      CREATE INDEX IF NOT EXISTS idx_project_stage_times_open ON project_stage_times(project_id, exited_at);
      CREATE INDEX IF NOT EXISTS idx_project_checklist_items_project_section ON project_checklist_items(project_id, section);
    `
  },
  {
    version: 3,
    name: 'phase_two_intelligent_inspection',
    sql: `
      PRAGMA foreign_keys = OFF;

      CREATE TABLE IF NOT EXISTS project_checklist_items_v3 (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK (section IN ('interior', 'exterior', 'mechanical', 'electrical', 'sound', 'paint', 'detailing')),
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'purchased_or_repaired', 'assembled')),
        notes TEXT NOT NULL DEFAULT '',
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO project_checklist_items_v3 (
        id, project_id, section, title, status, notes, completed_at, created_at, updated_at
      )
      SELECT
        id, project_id, section, title, status, notes, completed_at, created_at, updated_at
      FROM project_checklist_items
      WHERE EXISTS (
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_checklist_items'
      );

      DROP TABLE IF EXISTS project_checklist_items;
      ALTER TABLE project_checklist_items_v3 RENAME TO project_checklist_items;

      PRAGMA foreign_keys = ON;

      ALTER TABLE inspection_runs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inspection_runs ADD COLUMN summary TEXT NOT NULL DEFAULT '';
      ALTER TABLE inspection_runs ADD COLUMN restoration_estimate REAL NOT NULL DEFAULT 0;
      ALTER TABLE inspection_runs ADD COLUMN assets_total INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inspection_runs ADD COLUMN processed_assets INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inspection_runs ADD COLUMN component_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inspection_runs ADD COLUMN damage_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inspection_runs ADD COLUMN missing_part_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inspection_runs ADD COLUMN possible_modification_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inspection_runs ADD COLUMN completed_at TEXT;
      ALTER TABLE inspection_runs ADD COLUMN error_message TEXT NOT NULL DEFAULT '';

      CREATE TABLE IF NOT EXISTS inspection_assets (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES inspection_runs(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'frame')),
        local_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL DEFAULT '',
        frame_timestamp_seconds REAL,
        source_asset_id TEXT REFERENCES inspection_assets(id) ON DELETE CASCADE,
        captured_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inspection_findings (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES inspection_runs(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES inspection_assets(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        finding_type TEXT NOT NULL CHECK (finding_type IN ('component', 'damage', 'missing_part', 'possible_modification')),
        work_category TEXT NOT NULL CHECK (work_category IN ('interior', 'exterior', 'mechanical', 'electrical', 'sound', 'paint', 'detailing')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        bounding_box_json TEXT NOT NULL DEFAULT '',
        review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
        suggested_action TEXT NOT NULL DEFAULT '',
        checklist_title TEXT NOT NULL DEFAULT '',
        created_checklist_item_id TEXT REFERENCES project_checklist_items(id) ON DELETE SET NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_project_checklist_items_project_section ON project_checklist_items(project_id, section);
      CREATE INDEX IF NOT EXISTS idx_inspection_runs_project_status ON inspection_runs(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_inspection_assets_run_project ON inspection_assets(run_id, project_id);
      CREATE INDEX IF NOT EXISTS idx_inspection_findings_project_status ON inspection_findings(project_id, review_status);
      CREATE INDEX IF NOT EXISTS idx_inspection_findings_run_type ON inspection_findings(run_id, finding_type);
      CREATE INDEX IF NOT EXISTS idx_inspection_findings_asset ON inspection_findings(asset_id);
    `
  },
  {
    version: 4,
    name: 'phase_three_digital_twin',
    sql: `
      CREATE TABLE IF NOT EXISTS digital_twin_components (
        id TEXT PRIMARY KEY,
        digital_twin_id TEXT NOT NULL REFERENCES digital_twins(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        source_finding_id TEXT REFERENCES inspection_findings(id) ON DELETE SET NULL,
        source_asset_id TEXT REFERENCES inspection_assets(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        layer TEXT NOT NULL CHECK (layer IN ('exterior', 'interior', 'engine', 'chassis', 'suspension', 'electrical', 'glass', 'upholstery')),
        state TEXT NOT NULL DEFAULT 'uninspected' CHECK (state IN ('uninspected', 'pending', 'damaged', 'purchased_or_repaired', 'in_process', 'completed')),
        confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
        position_json TEXT NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
        bounding_box_json TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS digital_twin_damage_markers (
        id TEXT PRIMARY KEY,
        digital_twin_id TEXT NOT NULL REFERENCES digital_twins(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        source_finding_id TEXT REFERENCES inspection_findings(id) ON DELETE SET NULL,
        source_asset_id TEXT REFERENCES inspection_assets(id) ON DELETE SET NULL,
        damage_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'damaged' CHECK (severity IN ('uninspected', 'pending', 'damaged', 'purchased_or_repaired', 'in_process', 'completed')),
        confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
        position_json TEXT NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
        bounding_box_json TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS digital_twin_component_checklist_links (
        id TEXT PRIMARY KEY,
        digital_twin_component_id TEXT NOT NULL REFERENCES digital_twin_components(id) ON DELETE CASCADE,
        checklist_item_id TEXT NOT NULL REFERENCES project_checklist_items(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(digital_twin_component_id, checklist_item_id)
      );

      CREATE TABLE IF NOT EXISTS digital_twin_snapshots (
        id TEXT PRIMARY KEY,
        digital_twin_id TEXT NOT NULL REFERENCES digital_twins(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        snapshot_type TEXT NOT NULL DEFAULT 'milestone' CHECK (snapshot_type IN ('initial', 'current', 'milestone')),
        model_path TEXT NOT NULL DEFAULT '',
        component_state_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_digital_twin_layers_twin_layer ON digital_twin_layers(digital_twin_id, layer);
      CREATE INDEX IF NOT EXISTS idx_digital_twin_components_twin_layer ON digital_twin_components(digital_twin_id, layer);
      CREATE INDEX IF NOT EXISTS idx_digital_twin_components_project ON digital_twin_components(project_id);
      CREATE INDEX IF NOT EXISTS idx_digital_twin_damage_twin ON digital_twin_damage_markers(digital_twin_id);
      CREATE INDEX IF NOT EXISTS idx_digital_twin_links_component ON digital_twin_component_checklist_links(digital_twin_component_id);
      CREATE INDEX IF NOT EXISTS idx_digital_twin_links_checklist ON digital_twin_component_checklist_links(checklist_item_id);
      CREATE INDEX IF NOT EXISTS idx_digital_twin_snapshots_project ON digital_twin_snapshots(project_id, created_at);
    `
  },
  {
    version: 5,
    name: 'phase_four_oem_knowledge',
    sql: `
      CREATE TABLE IF NOT EXISTS oem_vin_decodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        vin TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        source_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        make TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        model_year TEXT NOT NULL DEFAULT '',
        trim TEXT NOT NULL DEFAULT '',
        body_class TEXT NOT NULL DEFAULT '',
        engine TEXT NOT NULL DEFAULT '',
        transmission TEXT NOT NULL DEFAULT '',
        drive_type TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        plant TEXT NOT NULL DEFAULT '',
        equipment_json TEXT NOT NULL DEFAULT '[]',
        raw_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, vin, source_name)
      );

      CREATE TABLE IF NOT EXISTS oem_profiles (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
        original_color TEXT NOT NULL DEFAULT '',
        original_interior TEXT NOT NULL DEFAULT '',
        original_engine TEXT NOT NULL DEFAULT '',
        original_transmission TEXT NOT NULL DEFAULT '',
        original_equipment_json TEXT NOT NULL DEFAULT '[]',
        source_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oem_knowledge_items (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        make TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        year INTEGER,
        category TEXT NOT NULL CHECK (category IN (
          'vin_decode',
          'technical_specification',
          'oem_color',
          'oem_interior',
          'oem_engine',
          'oem_photo',
          'manual',
          'catalog',
          'diagram',
          'documentation',
          'equipment'
        )),
        title TEXT NOT NULL,
        source_name TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        local_path TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oem_comparison_suggestions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        difference_type TEXT NOT NULL CHECK (difference_type IN (
          'missing_component',
          'possible_modification',
          'incorrect_component',
          'color_difference',
          'specification_mismatch'
        )),
        area TEXT NOT NULL CHECK (area IN ('interior', 'exterior', 'mechanical', 'electrical', 'sound', 'paint', 'detailing')),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        current_evidence TEXT NOT NULL DEFAULT '',
        oem_reference TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'ignored')),
        source_finding_id TEXT REFERENCES inspection_findings(id) ON DELETE SET NULL,
        source_asset_id TEXT REFERENCES inspection_assets(id) ON DELETE SET NULL,
        reference_knowledge_id TEXT REFERENCES oem_knowledge_items(id) ON DELETE SET NULL,
        created_checklist_item_id TEXT REFERENCES project_checklist_items(id) ON DELETE SET NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS oem_decision_memory (
        id TEXT PRIMARY KEY,
        make TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        year INTEGER,
        normalized_key TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'ignored', 'corrected')),
        correction_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_oem_knowledge_hash ON oem_knowledge_items(hash) WHERE hash != '';
      CREATE INDEX IF NOT EXISTS idx_oem_knowledge_vehicle_category ON oem_knowledge_items(make, model, year, category);
      CREATE INDEX IF NOT EXISTS idx_oem_knowledge_project ON oem_knowledge_items(project_id, category);
      CREATE INDEX IF NOT EXISTS idx_oem_suggestions_project_status ON oem_comparison_suggestions(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_oem_suggestions_finding ON oem_comparison_suggestions(source_finding_id);
      CREATE INDEX IF NOT EXISTS idx_oem_decision_memory_key ON oem_decision_memory(normalized_key);
    `
  },
  {
    version: 6,
    name: 'phase_five_planning_intelligence',
    sql: `
      CREATE TABLE IF NOT EXISTS planning_cost_lines (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        scenario TEXT NOT NULL CHECK (scenario IN ('conservative', 'intermediate', 'complete_oem')),
        stage_code TEXT NOT NULL CHECK (stage_code IN (
          'inspection_total_general',
          'mechanical_electrical',
          'sound',
          'exterior',
          'paint',
          'exterior_interior_assembly',
          'total_detailing',
          'completed'
        )),
        component_name TEXT NOT NULL DEFAULT '',
        bucket TEXT NOT NULL CHECK (bucket IN ('purchase', 'repair', 'paint', 'installation', 'shipping', 'import')),
        description TEXT NOT NULL,
        estimated_cents INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cents >= 0),
        confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
        evidence TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS planning_alerts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        alert_type TEXT NOT NULL CHECK (alert_type IN ('critical_part', 'delay', 'budget', 'blocked_process', 'dependency')),
        severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        evidence TEXT NOT NULL DEFAULT '',
        resolved_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS planning_reports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        report_type TEXT NOT NULL CHECK (report_type IN ('executive', 'financial', 'technical', 'progress', 'client')),
        format TEXT NOT NULL CHECK (format IN ('pdf', 'excel')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'failed')),
        local_path TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_planning_cost_lines_project_scenario ON planning_cost_lines(project_id, scenario);
      CREATE INDEX IF NOT EXISTS idx_planning_cost_lines_stage ON planning_cost_lines(project_id, stage_code);
      CREATE INDEX IF NOT EXISTS idx_planning_alerts_project_severity ON planning_alerts(project_id, severity, resolved_at);
      CREATE INDEX IF NOT EXISTS idx_planning_reports_project_type ON planning_reports(project_id, report_type, format);
    `
  },
  {
    version: 7,
    name: 'phase_six_blackline_ai_copilot',
    sql: `
      CREATE TABLE IF NOT EXISTS copilot_conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'restorer' CHECK (mode IN ('restorer', 'client')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS copilot_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        mode TEXT NOT NULL DEFAULT 'restorer' CHECK (mode IN ('restorer', 'client')),
        content TEXT NOT NULL,
        intent TEXT NOT NULL DEFAULT 'unknown' CHECK (intent IN (
          'project_status',
          'shop_status',
          'next_actions',
          'purchase_recommendation',
          'oem_recommendation',
          'time_estimate',
          'cost_estimate',
          'digital_twin',
          'client_summary',
          'technical_summary',
          'universal_search',
          'unknown'
        )),
        confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
        sources_json TEXT NOT NULL DEFAULT '[]',
        digital_twin_focus_json TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_copilot_conversations_project ON copilot_conversations(project_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_copilot_messages_conversation ON copilot_messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_copilot_messages_project_intent ON copilot_messages(project_id, intent);
    `
  },
  {
    version: 8,
    name: 'phase_seven_professional_inventory',
    sql: `
      CREATE TABLE IF NOT EXISTS inventory_locations_v7 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        location_type TEXT NOT NULL CHECK (location_type IN ('shelf', 'warehouse', 'workshop', 'paint_area', 'assembly_area', 'custom')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_suppliers_v7 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT '',
        contact_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        rating REAL NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
        delivery_score REAL NOT NULL DEFAULT 0 CHECK (delivery_score >= 0 AND delivery_score <= 5),
        quality_score REAL NOT NULL DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 5),
        cost_score REAL NOT NULL DEFAULT 0 CHECK (cost_score >= 0 AND cost_score <= 5),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_stock_items_v7 (
        id TEXT PRIMARY KEY,
        item_type TEXT NOT NULL CHECK (item_type IN (
          'oem_part',
          'aftermarket_part',
          'restored_part',
          'used_part',
          'material',
          'consumable',
          'tool'
        )),
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        brand TEXT NOT NULL DEFAULT '',
        part_number TEXT NOT NULL DEFAULT '',
        manufacturer TEXT NOT NULL DEFAULT '',
        quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        low_stock_threshold REAL NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
        location_id TEXT REFERENCES inventory_locations_v7(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
          'available',
          'reserved',
          'ordered',
          'in_transit',
          'received',
          'installed',
          'repair',
          'discarded'
        )),
        unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
        supplier_id TEXT REFERENCES inventory_suppliers_v7(id) ON DELETE SET NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_item_project_links_v7 (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES inventory_stock_items_v7(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        quantity_reserved REAL NOT NULL DEFAULT 1 CHECK (quantity_reserved > 0),
        status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'installed', 'released')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_item_photos_v7 (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES inventory_stock_items_v7(id) ON DELETE CASCADE,
        local_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_orders_v7 (
        id TEXT PRIMARY KEY,
        supplier_id TEXT REFERENCES inventory_suppliers_v7(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        order_number TEXT NOT NULL DEFAULT '',
        ordered_on TEXT NOT NULL,
        expected_on TEXT,
        received_on TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ordered', 'paid', 'in_transit', 'received', 'canceled')),
        subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
        tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
        shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
        import_cents INTEGER NOT NULL DEFAULT 0 CHECK (import_cents >= 0),
        total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_order_lines_v7 (
        id TEXT PRIMARY KEY,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders_v7(id) ON DELETE CASCADE,
        inventory_item_id TEXT REFERENCES inventory_stock_items_v7(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        part_number TEXT NOT NULL DEFAULT '',
        quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
        unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
        line_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_reports_v7 (
        id TEXT PRIMARY KEY,
        report_type TEXT NOT NULL CHECK (report_type IN ('inventory', 'purchases', 'suppliers', 'project_parts')),
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'failed')),
        local_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_locations_type ON inventory_locations_v7(location_type, name);
      CREATE INDEX IF NOT EXISTS idx_inventory_items_name_part ON inventory_stock_items_v7(name, part_number);
      CREATE INDEX IF NOT EXISTS idx_inventory_items_status_type ON inventory_stock_items_v7(status, item_type);
      CREATE INDEX IF NOT EXISTS idx_inventory_items_supplier ON inventory_stock_items_v7(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_links_project ON inventory_item_project_links_v7(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_inventory_links_item ON inventory_item_project_links_v7(item_id, status);
      CREATE INDEX IF NOT EXISTS idx_inventory_photos_item ON inventory_item_photos_v7(item_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_expected ON purchase_orders_v7(status, expected_on);
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders_v7(supplier_id, ordered_on);
      CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_project ON purchase_order_lines_v7(project_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_reports_type_project ON inventory_reports_v7(report_type, project_id);

      INSERT OR IGNORE INTO inventory_locations_v7 (id, name, location_type, notes, created_at, updated_at)
      VALUES
        ('inventory_location_shelf', 'Estante', 'shelf', '', datetime('now'), datetime('now')),
        ('inventory_location_warehouse', 'Bodega', 'warehouse', '', datetime('now'), datetime('now')),
        ('inventory_location_workshop', 'Taller', 'workshop', '', datetime('now'), datetime('now')),
        ('inventory_location_paint', 'Area de pintura', 'paint_area', '', datetime('now'), datetime('now')),
        ('inventory_location_assembly', 'Area de ensamblaje', 'assembly_area', '', datetime('now'), datetime('now'));
    `
  },
  {
    version: 9,
    name: 'phase_eight_predictive_operations',
    sql: `
      CREATE TABLE IF NOT EXISTS predictive_simulations_v8 (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        scenario_name TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS predictive_reports_v8 (
        id TEXT PRIMARY KEY,
        report_type TEXT NOT NULL CHECK (report_type IN ('risk', 'productivity', 'capacity', 'predictions')),
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'failed')),
        local_path TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_predictive_simulations_project ON predictive_simulations_v8(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_predictive_reports_type_project ON predictive_reports_v8(report_type, project_id, created_at);
    `
  },
  {
    version: 10,
    name: 'phase_nine_blackline_command_center',
    sql: `
      CREATE TABLE IF NOT EXISTS command_center_alerts_v9 (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'important', 'critical')),
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        evidence TEXT NOT NULL DEFAULT '',
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        project_label TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
        first_detected_at TEXT NOT NULL,
        last_detected_at TEXT NOT NULL,
        acknowledged_at TEXT
      );

      CREATE TABLE IF NOT EXISTS command_center_summaries_v9 (
        id TEXT PRIMARY KEY,
        summary_type TEXT NOT NULL CHECK (summary_type IN ('daily', 'weekly')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        metrics_json TEXT NOT NULL DEFAULT '[]',
        generated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_center_audit_v9 (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'command_center',
        project_id TEXT REFERENCES vehicle_projects(id) ON DELETE SET NULL,
        project_label TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_command_alerts_status_level ON command_center_alerts_v9(status, level, last_detected_at);
      CREATE INDEX IF NOT EXISTS idx_command_alerts_project ON command_center_alerts_v9(project_id, last_detected_at);
      CREATE INDEX IF NOT EXISTS idx_command_summaries_type ON command_center_summaries_v9(summary_type, generated_at);
      CREATE INDEX IF NOT EXISTS idx_command_audit_project ON command_center_audit_v9(project_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_command_audit_type ON command_center_audit_v9(event_type, occurred_at);
    `
  },
  {
    version: 11,
    name: 'phase_one_real_use_hardening',
    sql: `
      ALTER TABLE vehicle_projects ADD COLUMN project_name TEXT NOT NULL DEFAULT '';

      UPDATE vehicle_projects
      SET project_name = trim(COALESCE(year || ' ', '') || make || ' ' || model || ' ' || submodel)
      WHERE project_name = '';

      PRAGMA foreign_keys = OFF;

      CREATE TABLE IF NOT EXISTS project_checklist_items_v11 (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK (section IN ('interior', 'exterior', 'mechanical', 'electrical', 'sound', 'paint', 'detailing')),
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'purchased_or_repaired', 'assembled', 'completed')),
        notes TEXT NOT NULL DEFAULT '',
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO project_checklist_items_v11 (
        id, project_id, section, title, status, notes, completed_at, created_at, updated_at
      )
      SELECT
        id,
        project_id,
        section,
        title,
        CASE WHEN status IN ('pending', 'purchased_or_repaired', 'assembled', 'completed') THEN status ELSE 'pending' END,
        notes,
        completed_at,
        created_at,
        updated_at
      FROM project_checklist_items;

      DROP TABLE IF EXISTS project_checklist_items;
      ALTER TABLE project_checklist_items_v11 RENAME TO project_checklist_items;

      CREATE TABLE IF NOT EXISTS project_media_v11 (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN ('photo', 'video', 'document', 'model')),
        category TEXT NOT NULL DEFAULT 'reception' CHECK (category IN (
          'reception',
          'exterior',
          'interior',
          'engine',
          'trunk',
          'chassis',
          'damage',
          'process',
          'final',
          'disassembly',
          'repair',
          'paint',
          'assembly',
          'technical',
          'other'
        )),
        local_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL DEFAULT '',
        captured_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      INSERT INTO project_media_v11 (
        id, project_id, component_id, kind, category, local_path, filename, mime_type,
        hash, captured_at, metadata_json, created_at
      )
      SELECT
        id,
        project_id,
        component_id,
        kind,
        CASE
          WHEN category IN (
            'reception',
            'exterior',
            'interior',
            'engine',
            'trunk',
            'chassis',
            'damage',
            'process',
            'final',
            'disassembly',
            'repair',
            'paint',
            'assembly',
            'technical',
            'other'
          ) THEN category
          ELSE 'other'
        END,
        local_path,
        filename,
        mime_type,
        hash,
        captured_at,
        metadata_json,
        created_at
      FROM project_media;

      DROP TABLE IF EXISTS project_media;
      ALTER TABLE project_media_v11 RENAME TO project_media;

      CREATE TABLE IF NOT EXISTS digital_twins_v11 (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'placeholder' CHECK (status IN ('placeholder', 'pending', 'processing', 'ready', 'failed', 'archived')),
        model_path TEXT NOT NULL DEFAULT '',
        source_media_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO digital_twins_v11 (
        id, project_id, name, status, model_path, source_media_json, metadata_json, created_at, updated_at
      )
      SELECT
        id,
        project_id,
        name,
        CASE WHEN status IN ('placeholder', 'pending', 'processing', 'ready', 'failed', 'archived') THEN status ELSE 'placeholder' END,
        model_path,
        source_media_json,
        metadata_json,
        created_at,
        updated_at
      FROM digital_twins;

      DROP TABLE IF EXISTS digital_twins;
      ALTER TABLE digital_twins_v11 RENAME TO digital_twins;

      PRAGMA foreign_keys = ON;

      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_status_stage ON vehicle_projects(status, stage_id);
      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_vin ON vehicle_projects(vin);
      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_make_model_year ON vehicle_projects(make, model, year);
      CREATE INDEX IF NOT EXISTS idx_vehicle_projects_project_name ON vehicle_projects(project_name);
      CREATE INDEX IF NOT EXISTS idx_project_media_project_category ON project_media(project_id, category);
      CREATE INDEX IF NOT EXISTS idx_project_checklist_items_project_section ON project_checklist_items(project_id, section);
      CREATE INDEX IF NOT EXISTS idx_digital_twins_project_status ON digital_twins(project_id, status);
    `
  },
  {
    version: 12,
    name: 'zip_photogrammetry_pipeline',
    sql: `
      ALTER TABLE project_media ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE project_media ADD COLUMN imported_at TEXT;
      ALTER TABLE project_media ADD COLUMN width INTEGER;
      ALTER TABLE project_media ADD COLUMN height INTEGER;
      ALTER TABLE project_media ADD COLUMN status TEXT NOT NULL DEFAULT 'imported';

      UPDATE project_media
      SET imported_at = created_at
      WHERE imported_at IS NULL;

      CREATE TABLE IF NOT EXISTS project_photo_zip_imports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_path TEXT NOT NULL,
        local_path TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        ignored_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported', 'error')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS photogrammetry_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES vehicle_projects(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL CHECK (job_type IN ('analysis', 'reconstruction')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error', 'waiting_for_engine')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
        image_count INTEGER NOT NULL DEFAULT 0,
        zip_import_id TEXT REFERENCES project_photo_zip_imports(id) ON DELETE SET NULL,
        model_path TEXT NOT NULL DEFAULT '',
        log_path TEXT NOT NULL DEFAULT '',
        logs_json TEXT NOT NULL DEFAULT '[]',
        error_message TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_project_photo_zip_imports_project ON project_photo_zip_imports(project_id, imported_at);
      CREATE INDEX IF NOT EXISTS idx_photogrammetry_jobs_project ON photogrammetry_jobs(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_photogrammetry_jobs_status ON photogrammetry_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_project_media_project_source ON project_media(project_id, source);
    `
  }
]

const defaultStages = [
  ['stage_inspection_total_general', 'inspection_total_general', 'Inspeccion Total General', 1, 1, 0],
  ['stage_mechanical_electrical', 'mechanical_electrical', 'Mecanica / Electrico', 2, 1, 0],
  ['stage_sound', 'sound', 'Sonido', 3, 1, 0],
  ['stage_exterior', 'exterior', 'Exterior', 4, 1, 0],
  ['stage_paint', 'paint', 'Pintura', 5, 1, 0],
  ['stage_exterior_interior_assembly', 'exterior_interior_assembly', 'Ensamblaje Exterior e Interior', 6, 1, 0],
  ['stage_total_detailing', 'total_detailing', 'Detallado Total', 7, 1, 0],
  ['stage_completed', 'completed', 'Completado', 8, 1, 1]
] as const

export function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const getVersion = database.prepare('SELECT MAX(version) as version FROM schema_migrations')
  const currentVersion = Number((getVersion.get() as { version: number | null }).version ?? 0)

  const runMigration = (migration: Migration) => {
    database.exec(migration.sql)
    database
      .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.version, migration.name, new Date().toISOString())
  }

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      runMigration(migration)
    }
  }

  ensurePipelineStages(database)
}

function ensurePipelineStages(database: Database.Database): void {
  const now = new Date().toISOString()
  const insert = database.prepare(`
    INSERT INTO pipeline_stages (id, code, name, position, capacity, is_terminal, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO NOTHING
  `)

  const writeStages = database.transaction(() => {
    for (const stage of defaultStages) {
      insert.run(stage[0], stage[1], stage[2], stage[3], stage[4], stage[5], now, now)
    }
  })

  writeStages()
}
