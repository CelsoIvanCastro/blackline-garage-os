import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { BrowserWindow, app, net, protocol, shell } from 'electron'
import { closeDatabase, getDatabase } from './database/connection'
import { registerIpcHandlers } from './ipc'
import { DigitalTwinRepository } from './repositories/digitalTwinRepository'
import { InspectionRepository } from './repositories/inspectionRepository'
import { InventoryRepository } from './repositories/inventoryRepository'
import { OemRepository } from './repositories/oemRepository'
import { PlanningRepository } from './repositories/planningRepository'
import { PredictiveRepository } from './repositories/predictiveRepository'
import { ProjectRepository } from './repositories/projectRepository'

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL)

app.setName('BLACKLINE GARAGE OS')
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'blackline-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  },
  {
    scheme: 'blackline-model',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  },
  {
    scheme: 'blackline-oem',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  },
  {
    scheme: 'blackline-report',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  },
  {
    scheme: 'blackline-inventory',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  },
  {
    scheme: 'blackline-predictive',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

function createWindow(): void {
  const preloadPath = resolvePreloadPath()
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: 'BLACKLINE GARAGE OS',
    backgroundColor: '#f6f6f2',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  console.info(`Electron API preload: ${preloadPath}`)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (
      message.includes('Electron API detectada') ||
      message.includes('Abriendo Finder') ||
      message.includes('No se encontró la API de Electron')
    ) {
      console.info(`[renderer:${level}] ${message}`)
    }
  })

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function resolvePreloadPath(): string {
  const esmPreload = join(__dirname, '../preload/index.mjs')
  const cjsPreload = join(__dirname, '../preload/index.js')

  return existsSync(esmPreload) ? esmPreload : cjsPreload
}

app.whenReady().then(() => {
  getDatabase()
  registerMediaProtocol()
  registerModelProtocol()
  registerOemProtocol()
  registerReportProtocol()
  registerInventoryProtocol()
  registerPredictiveProtocol()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDatabase()
})

function registerMediaProtocol(): void {
  protocol.handle('blackline-media', (request) => {
    const mediaId = new URL(request.url).hostname
    const database = getDatabase()
    const projectRepository = new ProjectRepository(database)
    const inspectionRepository = new InspectionRepository(database)
    let localPath: string

    try {
      localPath = projectRepository.getMediaPath(mediaId)
    } catch {
      localPath = inspectionRepository.getAssetPath(mediaId)
    }

    const fileUrl = pathToFileURL(localPath).toString()
    return net.fetch(fileUrl)
  })
}

function registerModelProtocol(): void {
  protocol.handle('blackline-model', (request) => {
    const url = new URL(request.url)
    const digitalTwinId = url.hostname
    const requestedPath = decodeURIComponent(url.pathname.replace(/^\/+/, '') || 'model.gltf')
    const repository = new DigitalTwinRepository(getDatabase())
    const modelRoot = repository.getModelRoot(digitalTwinId)
    const localPath = resolve(modelRoot, requestedPath)

    if (!localPath.startsWith(modelRoot)) {
      throw new Error('Ruta de modelo invalida.')
    }

    return net.fetch(pathToFileURL(localPath).toString())
  })
}

function registerOemProtocol(): void {
  protocol.handle('blackline-oem', (request) => {
    const knowledgeId = new URL(request.url).hostname
    const repository = new OemRepository(getDatabase())
    const localPath = repository.getKnowledgeLocalPath(knowledgeId)

    return net.fetch(pathToFileURL(localPath).toString())
  })
}

function registerReportProtocol(): void {
  protocol.handle('blackline-report', (request) => {
    const reportId = new URL(request.url).hostname
    const repository = new PlanningRepository(getDatabase())
    const localPath = repository.getReportPath(reportId)

    return net.fetch(pathToFileURL(localPath).toString())
  })
}

function registerInventoryProtocol(): void {
  protocol.handle('blackline-inventory', (request) => {
    const url = new URL(request.url)
    const kind = url.hostname
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const repository = new InventoryRepository(getDatabase())
    const localPath = kind === 'report' ? repository.getReportPath(id) : repository.getPhotoPath(id)

    return net.fetch(pathToFileURL(localPath).toString())
  })
}

function registerPredictiveProtocol(): void {
  protocol.handle('blackline-predictive', (request) => {
    const reportId = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''))
    const repository = new PredictiveRepository(getDatabase())
    const localPath = repository.getReportPath(reportId)

    return net.fetch(pathToFileURL(localPath).toString())
  })
}
