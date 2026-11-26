import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app, dialog } from 'electron'
import ffmpegPath from 'ffmpeg-static'
import type { InspectionDashboard, InspectionRun } from '../../shared/types'
import { InspectionRepository } from '../repositories/inspectionRepository'
import { ProjectRepository } from '../repositories/projectRepository'
import { LocalVisionAnalyzer } from './localVisionAnalyzer'

const modelName = 'blackline-local-vision-v1'
const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.heic', '.mp4', '.mov'])
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.heic'])
const videoExtensions = new Set(['.mp4', '.mov'])

export class IntelligentInspectionService {
  private readonly analyzer = new LocalVisionAnalyzer()

  constructor(
    private readonly inspectionRepository: InspectionRepository,
    private readonly projectRepository: ProjectRepository
  ) {}

  getDashboard(projectId: string): InspectionDashboard {
    this.projectRepository.getProjectById(projectId)
    return this.inspectionRepository.getDashboard(projectId)
  }

  async importFiles(projectId: string): Promise<InspectionRun | null> {
    this.projectRepository.getProjectById(projectId)

    const result = await dialog.showOpenDialog({
      title: 'Seleccionar fotografias o videos para inspeccion IA',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imagenes y videos', extensions: ['jpg', 'jpeg', 'png', 'heic', 'mp4', 'mov'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return this.importFilePaths(projectId, result.filePaths)
  }

  async importFilePaths(projectId: string, filePaths: string[]): Promise<InspectionRun | null> {
    this.projectRepository.getProjectById(projectId)
    const validPaths = filePaths.filter((filePath) => supportedExtensions.has(path.extname(filePath).toLowerCase()))

    if (validPaths.length === 0) {
      return null
    }

    const run = this.inspectionRepository.createRun(projectId, modelName)

    const assetsToAnalyze = this.importAssets(projectId, run.id, validPaths)

    if (assetsToAnalyze.length === 0) {
      return this.inspectionRepository.failRun(run.id, 'No se pudieron preparar imagenes analizables.')
    }

    this.inspectionRepository.startRun(run.id, assetsToAnalyze.length)
    setTimeout(() => this.processRun(run.id, projectId, assetsToAnalyze), 10)

    return this.inspectionRepository.getRun(run.id)
  }

  private processRun(runId: string, projectId: string, assetsToAnalyze: Array<{ id: string; localPath: string }>): void {
    try {
      let processed = 0

      for (const asset of assetsToAnalyze) {
        const findings = this.analyzer.analyzeImage(asset.localPath)

        for (const finding of findings) {
          this.inspectionRepository.createFinding({
            runId,
            assetId: asset.id,
            projectId,
            findingType: finding.findingType,
            workCategory: finding.workCategory,
            name: finding.name,
            description: finding.description,
            confidence: finding.confidence,
            boundingBox: finding.boundingBox,
            suggestedAction: finding.suggestedAction,
            checklistTitle: finding.checklistTitle,
            metadataJson: JSON.stringify(finding.metadata)
          })
        }

        processed += 1
        this.inspectionRepository.updateRunProgress(runId, processed, assetsToAnalyze.length)
      }

      this.inspectionRepository.completeRun(runId)
    } catch (error) {
      this.inspectionRepository.failRun(runId, error instanceof Error ? error.message : 'Fallo el analisis.')
    }
  }

  updateFinding(input: Parameters<InspectionRepository['updateFinding']>[0]) {
    return this.inspectionRepository.updateFinding(input)
  }

  approveFinding(id: string) {
    const finding = this.inspectionRepository.getFinding(id)
    let checklistItemId: string | undefined

    if (finding.checklistTitle.trim()) {
      const item = this.projectRepository.createChecklistItem({
        projectId: finding.projectId,
        section: finding.workCategory,
        title: finding.checklistTitle,
        notes: `${finding.description}\nConfianza IA: ${Math.round(finding.confidence * 100)}%`,
        status: 'pending'
      })
      checklistItemId = item.id
    }

    return this.inspectionRepository.markFinding(id, 'approved', checklistItemId)
  }

  rejectFinding(id: string) {
    return this.inspectionRepository.markFinding(id, 'rejected')
  }

  private importAssets(
    projectId: string,
    runId: string,
    filePaths: string[]
  ): Array<{ id: string; localPath: string }> {
    const runDirectory = path.join(getInspectionStorageDirectory(), 'projects', projectId, runId)
    const originalsDirectory = path.join(runDirectory, 'originals')
    const framesDirectory = path.join(runDirectory, 'frames')
    fs.mkdirSync(originalsDirectory, { recursive: true })
    fs.mkdirSync(framesDirectory, { recursive: true })

    const analyzableAssets: Array<{ id: string; localPath: string }> = []

    for (const sourcePath of filePaths) {
      const extension = path.extname(sourcePath).toLowerCase()
      const copiedPath = copyIntoDirectory(sourcePath, originalsDirectory)
      const asset = this.inspectionRepository.createAsset({
        runId,
        projectId,
        kind: imageExtensions.has(extension) ? 'image' : 'video',
        localPath: copiedPath,
        filename: path.basename(sourcePath),
        mimeType: inferMimeType(extension),
        hash: hashFile(copiedPath)
      })

      if (imageExtensions.has(extension)) {
        analyzableAssets.push({ id: asset.id, localPath: copiedPath })
      }

      if (videoExtensions.has(extension)) {
        const framePaths = extractFrames(copiedPath, framesDirectory, asset.id)

        for (let index = 0; index < framePaths.length; index += 1) {
          const framePath = framePaths[index]
          const frame = this.inspectionRepository.createAsset({
            runId,
            projectId,
            kind: 'frame',
            localPath: framePath,
            filename: `${path.basename(sourcePath)} frame ${index + 1}`,
            mimeType: 'image/jpeg',
            hash: hashFile(framePath),
            frameTimestampSeconds: index * 2,
            sourceAssetId: asset.id
          })
          analyzableAssets.push({ id: frame.id, localPath: framePath })
        }
      }
    }

    return analyzableAssets
  }
}

export function getInspectionStorageDirectory(): string {
  return path.join(app.getPath('userData'), 'storage', 'inspection')
}

function copyIntoDirectory(sourcePath: string, directory: string): string {
  const extension = path.extname(sourcePath).toLowerCase()
  const destination = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}${extension}`)
  fs.copyFileSync(sourcePath, destination)
  return destination
}

function extractFrames(videoPath: string, framesDirectory: string, assetId: string): string[] {
  if (!ffmpegPath) {
    return []
  }

  const outputPattern = path.join(framesDirectory, `${assetId}-%03d.jpg`)
  const result = spawnSync(ffmpegPath, ['-y', '-i', videoPath, '-vf', 'fps=1/2,scale=960:-1', '-frames:v', '8', outputPattern], {
    stdio: 'ignore'
  })

  if (result.status !== 0) {
    return []
  }

  return fs
    .readdirSync(framesDirectory)
    .filter((filename) => filename.startsWith(assetId) && filename.endsWith('.jpg'))
    .sort()
    .map((filename) => path.join(framesDirectory, filename))
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function inferMimeType(extension: string): string {
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.heic':
      return 'image/heic'
    case '.mp4':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    default:
      return 'application/octet-stream'
  }
}
