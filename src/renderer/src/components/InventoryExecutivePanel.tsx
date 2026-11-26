import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Boxes, RefreshCw, ShoppingCart } from 'lucide-react'
import type { InventoryDashboard } from '@shared/types'
import { garageApi } from '../api'

const emptyDashboard: InventoryDashboard = {
  stats: {
    itemCount: 0,
    totalQuantity: 0,
    totalValueCents: 0,
    reservedValueCents: 0,
    usedValueCents: 0,
    pendingValueCents: 0,
    activeOrderCount: 0,
    delayedOrderCount: 0,
    supplierCount: 0
  },
  items: [],
  suppliers: [],
  purchaseOrders: [],
  locations: [],
  alerts: [],
  suggestedPurchases: [],
  reports: []
}

export function InventoryExecutivePanel() {
  const [dashboard, setDashboard] = useState<InventoryDashboard>(emptyDashboard)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadDashboard = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      setDashboard(await garageApi.inventory.getDashboard(null))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  return (
    <section className="inventory-executive-panel" aria-label="Inventario">
      <div className="section-title">
        <span>
          <Boxes size={15} aria-hidden="true" />
          Inventario
        </span>
        <button className="icon-button" type="button" title="Actualizar inventario" disabled={isLoading} onClick={() => void loadDashboard()}>
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>

      {error ? <div className="system-alert">{error}</div> : null}

      <div className="inventory-mini-stats">
        <InfoStat label="Articulos" value={String(dashboard.stats.itemCount)} />
        <InfoStat label="Valor total" value={formatMoney(dashboard.stats.totalValueCents)} />
        <InfoStat label="Reservado" value={formatMoney(dashboard.stats.reservedValueCents)} />
        <InfoStat label="Pedidos" value={String(dashboard.stats.activeOrderCount)} />
      </div>

      <div className="inventory-executive-grid">
        <div className="inventory-executive-list">
          <strong>
            <AlertTriangle size={14} aria-hidden="true" />
            Alertas
          </strong>
          {dashboard.alerts.slice(0, 4).map((alert) => (
            <div className={`inventory-alert ${alert.severity}`} key={alert.id}>
              <span>{alert.title}</span>
              <small>{alert.body}</small>
            </div>
          ))}
          {dashboard.alerts.length === 0 ? <span className="empty-slot">Sin alertas de inventario</span> : null}
        </div>

        <div className="inventory-executive-list">
          <strong>
            <ShoppingCart size={14} aria-hidden="true" />
            Compras sugeridas
          </strong>
          {dashboard.suggestedPurchases.slice(0, 4).map((purchase) => (
            <div className="inventory-suggestion-mini" key={purchase.id}>
              <span>{purchase.title}</span>
              <small>{purchase.projectLabel}</small>
            </div>
          ))}
          {dashboard.suggestedPurchases.length === 0 ? <span className="empty-slot">Sin faltantes detectados</span> : null}
        </div>
      </div>
    </section>
  )
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-tile">
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error inesperado.'
}
