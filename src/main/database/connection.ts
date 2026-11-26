import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { migrate } from './schema'

let database: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (database) {
    return database
  }

  const dataDirectory = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dataDirectory, { recursive: true })

  database = new Database(path.join(dataDirectory, 'blackline-garage-os.sqlite'))
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  migrate(database)

  return database
}

export function closeDatabase(): void {
  if (!database) {
    return
  }

  database.close()
  database = null
}

