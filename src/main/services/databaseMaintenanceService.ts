import fs from 'node:fs'
import type Database from 'better-sqlite3'
import type { DatabaseResetResult } from '../../shared/types'
import { getStorageDirectory } from './fileStorageService'

const resetTables = [
  'command_center_audit_v9',
  'command_center_summaries_v9',
  'command_center_alerts_v9',
  'predictive_reports_v8',
  'predictive_simulations_v8',
  'inventory_reports_v7',
  'purchase_order_lines_v7',
  'purchase_orders_v7',
  'inventory_item_photos_v7',
  'inventory_item_project_links_v7',
  'inventory_stock_items_v7',
  'inventory_suppliers_v7',
  'inventory_locations_v7',
  'copilot_messages',
  'copilot_conversations',
  'planning_reports',
  'planning_alerts',
  'planning_cost_lines',
  'oem_decision_memory',
  'oem_comparison_suggestions',
  'oem_knowledge_items',
  'oem_profiles',
  'oem_vin_decodes',
  'digital_twin_snapshots',
  'digital_twin_component_checklist_links',
  'digital_twin_damage_markers',
  'digital_twin_components',
  'digital_twin_layers',
  'digital_twins',
  'photogrammetry_jobs',
  'project_photo_zip_imports',
  'inspection_findings',
  'inspection_assets',
  'ai_artifacts',
  'inspection_runs',
  'research_records',
  'history_events',
  'project_media',
  'cost_entries',
  'purchase_items',
  'purchases',
  'inventory_items',
  'suppliers',
  'checklist_items',
  'checklists',
  'components',
  'project_checklist_items',
  'project_stage_times',
  'reports',
  'vehicle_projects'
]

export class DatabaseMaintenanceService {
  constructor(private readonly database: Database.Database) {}

  clearDatabase(): DatabaseResetResult {
    let deletedRows = 0
    const existingTables = new Set(
      (
        this.database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name)
    )

    this.database.pragma('foreign_keys = OFF')

    const reset = this.database.transaction(() => {
      for (const table of resetTables) {
        if (!existingTables.has(table)) {
          continue
        }

        const row = this.database.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }
        deletedRows += row.count
        this.database.prepare(`DELETE FROM ${table}`).run()
      }
    })

    reset()
    this.database.pragma('foreign_keys = ON')
    this.database.pragma('wal_checkpoint(TRUNCATE)')

    const storageDirectory = getStorageDirectory()
    let storageCleared = false

    if (fs.existsSync(storageDirectory)) {
      fs.rmSync(storageDirectory, { recursive: true, force: true })
      storageCleared = true
    }

    fs.mkdirSync(storageDirectory, { recursive: true })

    return {
      deletedRows,
      storageCleared,
      resetAt: new Date().toISOString()
    }
  }
}
