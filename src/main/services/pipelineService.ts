import type { PipelineSnapshot, PipelineStageCode, VehicleProject } from '../../shared/types'
import { getDatabase } from '../database/connection'
import { ProjectRepository } from '../repositories/projectRepository'

export class PipelineService {
  private readonly repository = new ProjectRepository(getDatabase())

  getSnapshot(): PipelineSnapshot {
    return {
      stages: this.repository.listStages(),
      projects: this.repository.listPipelineProjects(),
      stats: this.repository.getDashboardStats()
    }
  }

  moveProject(projectId: string, stageCode: PipelineStageCode): VehicleProject {
    return this.repository.moveProject(projectId, stageCode)
  }
}
