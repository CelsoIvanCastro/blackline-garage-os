import { Archive, CarFront, CheckCircle2, CircleDollarSign, CirclePause, Gauge, Warehouse } from 'lucide-react'
import type { ReactNode } from 'react'
import type { DashboardStats } from '@shared/types'

interface SummaryBarProps {
  stats: DashboardStats
  isLoading: boolean
}

export function SummaryBar({ stats, isLoading }: SummaryBarProps) {
  return (
    <header className="summary-bar">
      <div>
        <p className="eyebrow">Dashboard operativo</p>
        <h2>{isLoading ? 'Sincronizando taller' : `${stats.activeVehicles} vehiculo(s) activo(s)`}</h2>
      </div>

      <div className="metric-strip">
        <Metric icon={<CarFront size={18} />} label="Activos" value={stats.activeVehicles.toString()} />
        <Metric icon={<CheckCircle2 size={18} />} label="Completados" value={stats.completedVehicles.toString()} />
        <Metric icon={<CirclePause size={18} />} label="Pausados" value={stats.pausedVehicles.toString()} />
        <Metric icon={<Archive size={18} />} label="Archivados" value={stats.archivedVehicles.toString()} />
        <Metric icon={<Gauge size={18} />} label="Ocupados" value={stats.occupiedProcesses.toString()} />
        <Metric icon={<Warehouse size={18} />} label="Libres" value={stats.freeProcesses.toString()} />
        <Metric icon={<CircleDollarSign size={18} />} label="Invertido" value={formatMoney(stats.totalInvestedCents)} />
      </div>
    </header>
  )
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(cents / 100)
}
