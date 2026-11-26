import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { DigitalTwinModel, PhotogrammetryJob, PhotogrammetryJobStatus } from '../../shared/types'
import { DigitalTwinRepository } from '../repositories/digitalTwinRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { ensureProjectDirectories } from './fileStorageService'

type EngineAvailability =
  | { available: true; engine: 'colmap'; command: string; message: string }
  | { available: false; engine: 'none'; command: ''; message: string }

type StepStatus = {
  status?: PhotogrammetryJobStatus
  progress?: number
}

const minimumRecommendedPhotos = 50
const colmapImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const missingEngineMessage =
  'No hay motor de fotogrametría configurado. Las fotos ya fueron importadas y el proyecto está listo para reconstrucción 3D cuando configures COLMAP, Meshroom u otro motor compatible.'
const colmapFailureMessage =
  'COLMAP no pudo reconstruir el modelo. Intenta con más fotos, mejor luz y más ángulos.'

export class PhotogrammetryService {
  constructor(
    private readonly digitalTwinRepository: DigitalTwinRepository,
    private readonly projectRepository: ProjectRepository
  ) {}

  checkEngineAvailability(): EngineAvailability {
    const colmapPath = findColmapPath()

    if (colmapPath) {
      return {
        available: true,
        engine: 'colmap',
        command: colmapPath,
        message: `COLMAP detectado en ${colmapPath}.`
      }
    }

    return {
      available: false,
      engine: 'none',
      command: '',
      message: missingEngineMessage
    }
  }

  createAnalysisJob(projectId: string, imageCount: number, zipImportId: string | null, logs: string[]): PhotogrammetryJob {
    return this.digitalTwinRepository.createPhotogrammetryJob({
      projectId,
      type: 'analysis',
      status: 'completed',
      progress: 100,
      imageCount,
      zipImportId,
      logs
    })
  }

  createReconstructionJob(projectId: string): PhotogrammetryJob {
    const imageCount = this.digitalTwinRepository.listSourceImages(projectId).length

    return this.digitalTwinRepository.createPhotogrammetryJob({
      projectId,
      type: 'reconstruction',
      status: 'pending',
      progress: 0,
      imageCount,
      logs: ['Job de reconstrucción 3D creado.']
    })
  }

  async runReconstruction(projectId: string, imagePaths: string[]): Promise<DigitalTwinModel> {
    const project = this.projectRepository.getProjectById(projectId)
    const sourceImages = this.digitalTwinRepository.listSourceImages(projectId)

    if (sourceImages.length === 0 || imagePaths.length === 0) {
      throw new Error('No hay fotos para reconstrucción. Sube un ZIP con fotos del vehículo antes de generar modelo 3D.')
    }

    const directories = ensureProjectDirectories(projectId)
    const jobTimestamp = timestamp()
    const jobDirectory = path.join(directories.models, `colmap-job-${jobTimestamp}`)
    const databasePath = path.join(jobDirectory, 'database.db')
    const sparseDirectory = path.join(jobDirectory, 'sparse')
    const logsDirectory = path.join(jobDirectory, 'logs')
    const imagesDirectory = path.join(jobDirectory, 'images')
    const logPath = path.join(logsDirectory, 'colmap.log')
    const imageListPath = path.join(logsDirectory, 'source-images.txt')

    fs.mkdirSync(imagesDirectory, { recursive: true })
    fs.mkdirSync(sparseDirectory, { recursive: true })
    fs.mkdirSync(logsDirectory, { recursive: true })
    fs.closeSync(fs.openSync(databasePath, 'a'))
    fs.writeFileSync(imageListPath, imagePaths.join('\n'))
    fs.writeFileSync(logPath, '')

    const job = this.createReconstructionJob(projectId)
    const twin = this.digitalTwinRepository.createProcessingTwin(
      projectId,
      `${project.projectName} - Reconstrucción 3D`,
      sourceImages
    )
    const logs: string[] = []
    const updateJob = (step: string, status: StepStatus = {}): void => {
      logs.push(step)
      fs.appendFileSync(logPath, `${step}\n`)
      this.digitalTwinRepository.updatePhotogrammetryJob(job.id, {
        status: status.status ?? 'processing',
        progress: status.progress ?? job.progress,
        imageCount: sourceImages.length,
        logPath,
        logs
      })
    }
    const warning =
      sourceImages.length < minimumRecommendedPhotos
        ? `Se recomienda usar al menos ${minimumRecommendedPhotos} fotos desde distintos ángulos para un mejor modelo 3D. Fotos disponibles: ${sourceImages.length}.`
        : `Fotos disponibles: ${sourceImages.length}.`

    try {
      updateJob('Detectando COLMAP', { status: 'processing', progress: 8 })
      const engine = this.checkEngineAvailability()

      updateJob(`Proyecto: ${project.projectName}`, { progress: 10 })
      updateJob(warning, { progress: 12 })
      updateJob(`Carpeta de trabajo COLMAP: ${jobDirectory}`, { progress: 14 })

      if (!engine.available) {
        updateJob(engine.message, { status: 'waiting_for_engine', progress: 20 })
        this.digitalTwinRepository.markTwinFailed(twin.id, `${engine.message} ${warning} Log: ${logPath}`)
        throw new Error(`${engine.message} ${warning}`)
      }

      updateJob(`Ruta de COLMAP detectada: ${engine.command}`, { progress: 16 })
      updateJob('Preparando imágenes', { progress: 18 })
      const preparedImages = copyImagesForColmap(imagePaths, imagesDirectory)

      if (preparedImages.length === 0) {
        throw new Error('COLMAP necesita imágenes JPG, JPEG, PNG o WEBP. Convierte archivos HEIC a JPG antes de reconstruir.')
      }

      updateJob(`Imágenes preparadas para COLMAP: ${preparedImages.length}`, { progress: 22 })
      updateJob('Extrayendo características', { progress: 25 })
      await runColmapCommand(
        engine.command,
        ['feature_extractor', '--database_path', databasePath, '--image_path', imagesDirectory],
        logsDirectory,
        'Extrayendo características',
        (line) => updateJob(line, { progress: 35 })
      )

      updateJob('Emparejando imágenes', { progress: 45 })
      await runColmapCommand(
        engine.command,
        ['exhaustive_matcher', '--database_path', databasePath],
        logsDirectory,
        'Emparejando imágenes',
        (line) => updateJob(line, { progress: 60 })
      )

      updateJob('Reconstruyendo modelo sparse', { progress: 70 })
      await runColmapCommand(
        engine.command,
        ['mapper', '--database_path', databasePath, '--image_path', imagesDirectory, '--output_path', sparseDirectory],
        logsDirectory,
        'Reconstruyendo modelo sparse',
        (line) => updateJob(line, { progress: 85 })
      )

      const sparseModelDirectory = findSparseModelDirectory(sparseDirectory)

      if (!sparseModelDirectory) {
        throw new Error(colmapFailureMessage)
      }

      updateJob(`Modelo sparse generado: ${sparseModelDirectory}`, { progress: 90 })
      const modelPath = await convertSparseModelToObj(engine.command, sparseModelDirectory, jobDirectory, logsDirectory, (line) =>
        updateJob(line, { progress: 95 })
      )
      const completedLogs = [...logs, `Completado. Modelo OBJ generado: ${modelPath}`]

      fs.appendFileSync(logPath, `Completado. Modelo OBJ generado: ${modelPath}\n`)
      this.digitalTwinRepository.updatePhotogrammetryJob(job.id, {
        status: 'completed',
        progress: 100,
        modelPath,
        logPath,
        logs: completedLogs
      })

      return this.digitalTwinRepository.markTwinReady(twin.id, modelPath, sourceImages, {
        engine: 'colmap',
        colmapPath: engine.command,
        jobDirectory,
        databasePath,
        sparseDirectory,
        sparseModelDirectory,
        logPath,
        sourceMediaCount: sourceImages.length,
        preparedImageCount: preparedImages.length,
        modelPath
      })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const isMissingEngine = rawMessage.includes(missingEngineMessage)
      const message = isMissingEngine ? rawMessage : normalizeColmapError(error)
      const failedLogs = [...logs, message]
      fs.appendFileSync(logPath, `${message}\n`)
      this.digitalTwinRepository.updatePhotogrammetryJob(job.id, {
        status: isMissingEngine ? 'waiting_for_engine' : 'error',
        progress: isMissingEngine ? 20 : 100,
        modelPath: '',
        logPath,
        logs: failedLogs,
        errorMessage: message
      })
      this.digitalTwinRepository.markTwinFailed(twin.id, `${message} Log: ${logPath}`)
      throw new Error(message)
    }
  }

  getJobLogs(jobId: string): string[] {
    return this.digitalTwinRepository.getPhotogrammetryJobLogs(jobId)
  }

  getJobStatus(jobId: string): PhotogrammetryJobStatus {
    return this.digitalTwinRepository.getPhotogrammetryJobStatus(jobId)
  }
}

function findColmapPath(): string | null {
  const envPath = process.env.COLMAP_PATH?.trim()
  const candidates = [
    envPath,
    findOnPath('colmap'),
    '/opt/homebrew/bin/colmap',
    '/usr/local/bin/colmap'
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }

  return null
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findOnPath(binaryName: string): string | null {
  try {
    const output = execFileSync('/usr/bin/which', [binaryName], { encoding: 'utf8' }).trim()
    return output || null
  } catch {
    return null
  }
}

function copyImagesForColmap(imagePaths: string[], destinationDirectory: string): string[] {
  const copied: string[] = []

  for (const [index, imagePath] of imagePaths.entries()) {
    const extension = path.extname(imagePath).toLowerCase()

    if (!fs.existsSync(imagePath) || !colmapImageExtensions.has(extension)) {
      continue
    }

    const destination = path.join(destinationDirectory, `image-${String(index + 1).padStart(4, '0')}${extension}`)
    fs.copyFileSync(imagePath, destination)
    copied.push(destination)
  }

  return copied
}

function runColmapCommand(
  executable: string,
  args: string[],
  cwd: string,
  stageName: string,
  onLog: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    onLog(`Etapa: ${stageName}`)
    onLog(`$ ${[executable, ...args].map(shellQuote).join(' ')}`)
    const child = spawn(executable, args, { cwd })
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      for (const line of splitLines(chunk.toString())) {
        onLog(`stdout: ${line}`)
      }
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      for (const line of splitLines(text)) {
        onLog(`stderr: ${line}`)
      }
    })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Etapa donde falló: ${stageName}. ${stderr.trim() || `COLMAP terminó con código ${code ?? 'desconocido'}.`}`))
      }
    })
  })
}

async function convertSparseModelToObj(
  executable: string,
  sparseModelDirectory: string,
  jobDirectory: string,
  logsDirectory: string,
  onLog: (line: string) => void
): Promise<string> {
      const textDirectory = path.join(jobDirectory, 'sparse-txt')
  const objPath = path.join(jobDirectory, 'model.obj')
  fs.mkdirSync(textDirectory, { recursive: true })

  onLog('Convirtiendo modelo sparse a TXT')
  await runColmapCommand(
    executable,
    ['model_converter', '--input_path', sparseModelDirectory, '--output_path', textDirectory, '--output_type', 'TXT'],
    logsDirectory,
    'Convirtiendo modelo sparse',
    onLog
  )
  writeSparsePointCloudObj(path.join(textDirectory, 'points3D.txt'), objPath)
  return objPath
}

function writeSparsePointCloudObj(pointsPath: string, objPath: string): void {
  if (!fs.existsSync(pointsPath)) {
    throw new Error(colmapFailureMessage)
  }

  const vertices: string[] = []
  const pointIndexes: string[] = []
  const lines = fs.readFileSync(pointsPath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) {
      continue
    }

    const parts = line.trim().split(/\s+/)

    if (parts.length < 8) {
      continue
    }

    const x = Number(parts[1])
    const y = Number(parts[2])
    const z = Number(parts[3])
    const r = clampColor(Number(parts[4])) / 255
    const g = clampColor(Number(parts[5])) / 255
    const b = clampColor(Number(parts[6])) / 255

    if (![x, y, z].every(Number.isFinite)) {
      continue
    }

    vertices.push(`v ${x} ${y} ${z} ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`)
    pointIndexes.push(String(vertices.length))
  }

  if (vertices.length === 0) {
    throw new Error(colmapFailureMessage)
  }

  const pointLines: string[] = []

  for (let index = 0; index < pointIndexes.length; index += 500) {
    pointLines.push(`p ${pointIndexes.slice(index, index + 500).join(' ')}`)
  }

  fs.writeFileSync(
    objPath,
    ['# BLACKLINE GARAGE OS - COLMAP sparse point cloud', ...vertices, ...pointLines].join('\n')
  )
}

function findSparseModelDirectory(sparseDirectory: string): string | null {
  if (!fs.existsSync(sparseDirectory)) {
    return null
  }

  const entries = fs.readdirSync(sparseDirectory, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sparseDirectory, entry.name))
    .sort()

  return (
    directories.find(
      (directory) =>
        fs.existsSync(path.join(directory, 'points3D.bin')) ||
        fs.existsSync(path.join(directory, 'points3D.txt'))
    ) ?? null
  )
}

function normalizeColmapError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const normalized = text.toLowerCase()

  if (
    normalized.includes('no good initial image pair') ||
    normalized.includes('failed to reconstruct') ||
    normalized.includes('points3d') ||
    normalized.includes('mapper') ||
    normalized.includes('database')
  ) {
    return colmapFailureMessage
  }

  return text || colmapFailureMessage
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Number.isFinite(value) ? value : 255))
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
