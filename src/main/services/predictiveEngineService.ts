import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  CreatePredictiveReportInput,
  OperationalSimulationResult,
  PredictiveDashboard,
  PredictiveReport,
  RunOperationalSimulationInput
} from '../../shared/types'
import { PredictiveRepository } from '../repositories/predictiveRepository'

export class PredictiveEngineService {
  constructor(private readonly repository: PredictiveRepository) {}

  getDashboard(projectId?: string | null): PredictiveDashboard {
    return this.repository.getDashboard(projectId ?? undefined)
  }

  runSimulation(input: RunOperationalSimulationInput): OperationalSimulationResult {
    return this.repository.runSimulation(input)
  }

  generateReport(input: CreatePredictiveReportInput): PredictiveReport {
    const dashboard = this.repository.getDashboard(input.projectId ?? undefined)
    const directory = path.join(getPredictiveStorageDirectory(), 'reports')
    fs.mkdirSync(directory, { recursive: true })
    const localPath = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${input.reportType}.csv`)

    try {
      fs.writeFileSync(localPath, buildReport(input.reportType, dashboard))
      return this.repository.createReport(input.reportType, input.projectId ?? null, 'generated', localPath)
    } catch {
      return this.repository.createReport(input.reportType, input.projectId ?? null, 'failed', '')
    }
  }
}

export function getPredictiveStorageDirectory(): string {
  return path.join(app.getPath('userData'), 'storage', 'predictive')
}

function buildReport(reportType: CreatePredictiveReportInput['reportType'], dashboard: PredictiveDashboard): string {
  switch (reportType) {
    case 'risk':
      return toCsv([
        ['Tipo', 'Severidad', 'Titulo', 'Evidencia', 'Confianza'],
        ...dashboard.risks.map((risk) => [risk.type, risk.severity, risk.title, risk.evidence, String(Math.round(risk.confidence * 100))])
      ])
    case 'productivity':
      return toCsv([
        ['Metrica', 'Valor'],
        ['Vehiculos terminados', String(dashboard.performance.completedVehicles)],
        ['Promedio terminacion dias', dashboard.performance.averageCompletionSeconds === null ? '' : String(Math.round(dashboard.performance.averageCompletionSeconds / 86400))],
        ['Costo promedio', dashboard.performance.averageCostCents === null ? '' : String(dashboard.performance.averageCostCents / 100)],
        ['Workshop Score', String(dashboard.workshopScore)]
      ])
    case 'capacity':
      return toCsv([
        ['Capacidad actual', String(dashboard.capacity.currentCapacity)],
        ['Capacidad usada', String(dashboard.capacity.usedCapacity)],
        ['Disponible', String(dashboard.capacity.availableCapacity)],
        ['Utilizacion', `${dashboard.capacity.utilizationPercent}%`],
        ['Saturados', dashboard.capacity.overloadedStages.join(' | ')],
        ['Vacios', dashboard.capacity.emptyStages.join(' | ')]
      ])
    default:
      return toCsv([
        ['Proyecto', 'Score', 'Etapa', 'Termino probable', 'Costo predicho', 'Confianza', 'Explicacion'],
        ...dashboard.projectPredictions.map((prediction) => [
          prediction.projectLabel,
          String(prediction.healthScore),
          prediction.stageName,
          prediction.probableFinishDate ?? '',
          prediction.predictedCostCents === null ? '' : String(prediction.predictedCostCents / 100),
          String(Math.round(prediction.confidence * 100)),
          prediction.explanation
        ])
      ])
  }
}

function toCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}\n`
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}
