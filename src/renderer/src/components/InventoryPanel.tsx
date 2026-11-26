import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, Camera, FileDown, MapPin, PackageCheck, Plus, RefreshCw, ShoppingCart, Trash2, Truck } from 'lucide-react'
import type {
  InventoryDashboard,
  InventoryItem,
  InventoryItemStatus,
  InventoryItemType,
  InventoryLocationType,
  InventoryReportType,
  InventorySupplier,
  ProjectDetail,
  PurchaseOrderStatus
} from '@shared/types'
import { garageApi } from '../api'

interface InventoryPanelProps {
  detail: ProjectDetail
  onRefreshProject: () => Promise<void>
}

type InventoryTab = 'inventory' | 'purchases' | 'suppliers' | 'reports'

const itemTypeLabels: Record<InventoryItemType, string> = {
  oem_part: 'Pieza OEM',
  aftermarket_part: 'Aftermarket',
  restored_part: 'Restaurada',
  used_part: 'Usada',
  material: 'Material',
  consumable: 'Consumible',
  tool: 'Herramienta'
}

const itemStatusLabels: Record<InventoryItemStatus, string> = {
  available: 'Disponible',
  reserved: 'Reservada',
  ordered: 'Pedida',
  in_transit: 'En transito',
  received: 'Recibida',
  installed: 'Instalada',
  repair: 'Reparacion',
  discarded: 'Descartada'
}

const orderStatusLabels: Record<PurchaseOrderStatus, string> = {
  pending: 'Pendiente',
  ordered: 'Ordenada',
  paid: 'Pagada',
  in_transit: 'En transito',
  received: 'Recibida',
  canceled: 'Cancelada'
}

const locationTypeLabels: Record<InventoryLocationType, string> = {
  shelf: 'Estante',
  warehouse: 'Bodega',
  workshop: 'Taller',
  paint_area: 'Area de pintura',
  assembly_area: 'Area de ensamblaje',
  custom: 'Personalizada'
}

const reportLabels: Record<InventoryReportType, string> = {
  inventory: 'Inventario',
  purchases: 'Compras',
  suppliers: 'Proveedores',
  project_parts: 'Piezas por proyecto'
}

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

export function InventoryPanel({ detail, onRefreshProject }: InventoryPanelProps) {
  const [dashboard, setDashboard] = useState<InventoryDashboard>(emptyDashboard)
  const [tab, setTab] = useState<InventoryTab>('inventory')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [itemDraft, setItemDraft] = useState({
    itemType: 'oem_part' as InventoryItemType,
    name: '',
    category: '',
    description: '',
    brand: '',
    partNumber: '',
    manufacturer: '',
    quantity: '1',
    lowStockThreshold: '0',
    locationId: '',
    status: 'available' as InventoryItemStatus,
    unitCost: '',
    supplierId: '',
    reserveForProject: true
  })
  const [supplierDraft, setSupplierDraft] = useState({
    name: '',
    country: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    rating: ''
  })
  const [locationDraft, setLocationDraft] = useState({
    name: '',
    locationType: 'shelf' as InventoryLocationType
  })
  const [orderDraft, setOrderDraft] = useState({
    supplierId: '',
    orderNumber: '',
    orderedOn: new Date().toISOString().slice(0, 10),
    expectedOn: '',
    status: 'pending' as PurchaseOrderStatus,
    description: '',
    partNumber: '',
    quantity: '1',
    unitCost: '',
    tax: '',
    shipping: '',
    importCost: '',
    notes: ''
  })

  const loadDashboard = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      setDashboard(await garageApi.inventory.getDashboard(detail.project.id))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [detail.project.id])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    if (!normalized) {
      return dashboard.items
    }

    return dashboard.items.filter((item) =>
      [item.name, item.partNumber, item.supplierName, item.locationName, item.projectLinks.map((link) => link.projectLabel).join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    )
  }, [dashboard.items, query])

  async function runAction(action: () => Promise<void>): Promise<void> {
    setError(null)

    try {
      await action()
      await loadDashboard()
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    }
  }

  async function handleCreateItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!itemDraft.name.trim()) {
      return
    }

    await runAction(async () => {
      await garageApi.inventory.createItem({
        itemType: itemDraft.itemType,
        name: itemDraft.name,
        category: itemDraft.category,
        description: itemDraft.description,
        brand: itemDraft.brand,
        partNumber: itemDraft.partNumber,
        manufacturer: itemDraft.manufacturer,
        quantity: Number(itemDraft.quantity || 0),
        lowStockThreshold: Number(itemDraft.lowStockThreshold || 0),
        locationId: itemDraft.locationId || null,
        status: itemDraft.reserveForProject ? 'reserved' : itemDraft.status,
        unitCostCents: Math.round(Number(itemDraft.unitCost || 0) * 100),
        supplierId: itemDraft.supplierId || null,
        projectId: itemDraft.reserveForProject ? detail.project.id : null,
        reservedQuantity: itemDraft.reserveForProject ? Number(itemDraft.quantity || 1) : undefined
      })
      setItemDraft({ ...itemDraft, name: '', category: '', description: '', brand: '', partNumber: '', manufacturer: '', unitCost: '' })
      await onRefreshProject()
    })
  }

  async function handleCreateSupplier(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!supplierDraft.name.trim()) {
      return
    }

    await runAction(async () => {
      await garageApi.inventory.createSupplier({
        ...supplierDraft,
        rating: Number(supplierDraft.rating || 0)
      })
      setSupplierDraft({ name: '', country: '', contactName: '', email: '', phone: '', website: '', rating: '' })
    })
  }

  async function handleCreateLocation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!locationDraft.name.trim()) {
      return
    }

    await runAction(async () => {
      await garageApi.inventory.createLocation(locationDraft)
      setLocationDraft({ name: '', locationType: locationDraft.locationType })
    })
  }

  async function handleCreateOrder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!orderDraft.description.trim()) {
      return
    }

    await runAction(async () => {
      await garageApi.inventory.createPurchaseOrder({
        supplierId: orderDraft.supplierId || null,
        projectId: detail.project.id,
        orderNumber: orderDraft.orderNumber,
        orderedOn: orderDraft.orderedOn,
        expectedOn: orderDraft.expectedOn || null,
        status: orderDraft.status,
        taxCents: Math.round(Number(orderDraft.tax || 0) * 100),
        shippingCents: Math.round(Number(orderDraft.shipping || 0) * 100),
        importCents: Math.round(Number(orderDraft.importCost || 0) * 100),
        notes: orderDraft.notes,
        lines: [
          {
            projectId: detail.project.id,
            description: orderDraft.description,
            partNumber: orderDraft.partNumber,
            quantity: Number(orderDraft.quantity || 1),
            unitCostCents: Math.round(Number(orderDraft.unitCost || 0) * 100)
          }
        ]
      })
      setOrderDraft({
        ...orderDraft,
        orderNumber: '',
        expectedOn: '',
        description: '',
        partNumber: '',
        quantity: '1',
        unitCost: '',
        tax: '',
        shipping: '',
        importCost: '',
        notes: ''
      })
      await onRefreshProject()
    })
  }

  async function handleGenerateReport(reportType: InventoryReportType): Promise<void> {
    await runAction(async () => {
      await garageApi.inventory.generateReport({ reportType, projectId: detail.project.id })
    })
  }

  return (
    <div className="inventory-panel">
      <div className="twin-commandbar">
        <div>
          <p className="eyebrow">Inventario Profesional</p>
          <h4>{detail.project.make} {detail.project.model}</h4>
        </div>
        <button className="primary-icon-button" type="button" disabled={isLoading} onClick={() => void loadDashboard()}>
          <RefreshCw size={16} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {error ? <div className="system-alert">{error}</div> : null}

      <div className="twin-stat-strip">
        <InfoStat label="Valor total" value={formatMoney(dashboard.stats.totalValueCents)} />
        <InfoStat label="Reservado" value={formatMoney(dashboard.stats.reservedValueCents)} />
        <InfoStat label="Utilizado" value={formatMoney(dashboard.stats.usedValueCents)} />
        <InfoStat label="Pendiente" value={formatMoney(dashboard.stats.pendingValueCents)} />
        <InfoStat label="Pedidos activos" value={String(dashboard.stats.activeOrderCount)} />
      </div>

      <div className="segmented-control inventory-tabs" role="tablist" aria-label="Modulo de inventario">
        <button className={tab === 'inventory' ? 'active' : ''} type="button" onClick={() => setTab('inventory')}>
          Inventario
        </button>
        <button className={tab === 'purchases' ? 'active' : ''} type="button" onClick={() => setTab('purchases')}>
          Compras
        </button>
        <button className={tab === 'suppliers' ? 'active' : ''} type="button" onClick={() => setTab('suppliers')}>
          Proveedores
        </button>
        <button className={tab === 'reports' ? 'active' : ''} type="button" onClick={() => setTab('reports')}>
          Reportes
        </button>
      </div>

      {tab === 'inventory' ? (
        <div className="inventory-grid">
          <section className="inventory-card">
            <div className="section-title">
              <span>
                <Boxes size={15} aria-hidden="true" />
                Ficha de inventario
              </span>
              <small>{filteredItems.length}</small>
            </div>

            <form className="inventory-form" onSubmit={handleCreateItem}>
              <select value={itemDraft.itemType} onChange={(event) => setItemDraft({ ...itemDraft, itemType: event.target.value as InventoryItemType })}>
                {Object.entries(itemTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} placeholder="Nombre" />
              <input value={itemDraft.partNumber} onChange={(event) => setItemDraft({ ...itemDraft, partNumber: event.target.value })} placeholder="Numero de parte" />
              <input value={itemDraft.brand} onChange={(event) => setItemDraft({ ...itemDraft, brand: event.target.value })} placeholder="Marca" />
              <input value={itemDraft.manufacturer} onChange={(event) => setItemDraft({ ...itemDraft, manufacturer: event.target.value })} placeholder="Fabricante" />
              <input value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} placeholder="Categoria" />
              <select value={itemDraft.locationId} onChange={(event) => setItemDraft({ ...itemDraft, locationId: event.target.value })}>
                <option value="">Sin ubicacion</option>
                {dashboard.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <select value={itemDraft.supplierId} onChange={(event) => setItemDraft({ ...itemDraft, supplierId: event.target.value })}>
                <option value="">Sin proveedor</option>
                {dashboard.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
              <input value={itemDraft.quantity} onChange={(event) => setItemDraft({ ...itemDraft, quantity: event.target.value })} placeholder="Cantidad" inputMode="decimal" />
              <input value={itemDraft.lowStockThreshold} onChange={(event) => setItemDraft({ ...itemDraft, lowStockThreshold: event.target.value })} placeholder="Stock bajo" inputMode="decimal" />
              <input value={itemDraft.unitCost} onChange={(event) => setItemDraft({ ...itemDraft, unitCost: event.target.value })} placeholder="Costo unitario" inputMode="decimal" />
              <label className="inventory-check">
                <input
                  checked={itemDraft.reserveForProject}
                  type="checkbox"
                  onChange={(event) => setItemDraft({ ...itemDraft, reserveForProject: event.target.checked })}
                />
                Reservar
              </label>
              <input className="wide" value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} placeholder="Descripcion" />
              <button className="primary-icon-button" type="submit">
                <Plus size={15} aria-hidden="true" />
                Agregar
              </button>
            </form>

            <input className="inventory-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pieza, parte, proveedor o proyecto" />

            <div className="inventory-item-list">
              {filteredItems.map((item) => (
                <InventoryItemRow
                  key={item.id}
                  item={item}
                  projectId={detail.project.id}
                  onUpdate={(input) => runAction(async () => { await garageApi.inventory.updateItem(input) })}
                  onReserve={(itemId) => runAction(async () => { await garageApi.inventory.reserveItem({ itemId, projectId: detail.project.id, quantityReserved: 1 }) })}
                  onImportPhotos={(itemId) => runAction(async () => { await garageApi.inventory.importItemPhotos(itemId) })}
                  onDelete={(itemId) => runAction(async () => { await garageApi.inventory.deleteItem(itemId) })}
                />
              ))}
              {filteredItems.length === 0 ? <div className="empty-slot">Sin articulos vinculados al proyecto</div> : null}
            </div>
          </section>

          <section className="inventory-card">
            <div className="section-title">
              <span>
                <ShoppingCart size={15} aria-hidden="true" />
                Compras sugeridas
              </span>
              <small>{dashboard.suggestedPurchases.length}</small>
            </div>
            <div className="inventory-suggestion-list">
              {dashboard.suggestedPurchases.map((suggestion) => (
                <div className="inventory-suggestion" key={suggestion.id}>
                  <strong>{suggestion.title}</strong>
                  <span>{suggestion.evidence}</span>
                  <small>{Math.round(suggestion.confidence * 100)}% confianza</small>
                </div>
              ))}
              {dashboard.suggestedPurchases.length === 0 ? <span className="empty-slot">Sin faltantes detectados</span> : null}
            </div>

            <div className="section-title">
              <span>
                <AlertIcon />
                Alertas
              </span>
              <small>{dashboard.alerts.length}</small>
            </div>
            <div className="inventory-suggestion-list">
              {dashboard.alerts.map((alert) => (
                <div className={`inventory-alert ${alert.severity}`} key={alert.id}>
                  <strong>{alert.title}</strong>
                  <span>{alert.body}</span>
                  <small>{alert.evidence}</small>
                </div>
              ))}
              {dashboard.alerts.length === 0 ? <span className="empty-slot">Sin alertas</span> : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'purchases' ? (
        <section className="inventory-card">
          <div className="section-title">
            <span>
              <Truck size={15} aria-hidden="true" />
              Ordenes de compra
            </span>
            <small>{dashboard.purchaseOrders.length}</small>
          </div>
          <form className="inventory-form purchase" onSubmit={handleCreateOrder}>
            <select value={orderDraft.supplierId} onChange={(event) => setOrderDraft({ ...orderDraft, supplierId: event.target.value })}>
              <option value="">Proveedor</option>
              {dashboard.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            <select value={orderDraft.status} onChange={(event) => setOrderDraft({ ...orderDraft, status: event.target.value as PurchaseOrderStatus })}>
              {Object.entries(orderStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input value={orderDraft.orderNumber} onChange={(event) => setOrderDraft({ ...orderDraft, orderNumber: event.target.value })} placeholder="Orden / factura" />
            <input type="date" value={orderDraft.orderedOn} onChange={(event) => setOrderDraft({ ...orderDraft, orderedOn: event.target.value })} />
            <input type="date" value={orderDraft.expectedOn} onChange={(event) => setOrderDraft({ ...orderDraft, expectedOn: event.target.value })} />
            <input value={orderDraft.description} onChange={(event) => setOrderDraft({ ...orderDraft, description: event.target.value })} placeholder="Pieza / material" />
            <input value={orderDraft.partNumber} onChange={(event) => setOrderDraft({ ...orderDraft, partNumber: event.target.value })} placeholder="Numero de parte" />
            <input value={orderDraft.quantity} onChange={(event) => setOrderDraft({ ...orderDraft, quantity: event.target.value })} placeholder="Cantidad" inputMode="decimal" />
            <input value={orderDraft.unitCost} onChange={(event) => setOrderDraft({ ...orderDraft, unitCost: event.target.value })} placeholder="Costo unitario" inputMode="decimal" />
            <input value={orderDraft.tax} onChange={(event) => setOrderDraft({ ...orderDraft, tax: event.target.value })} placeholder="Impuestos" inputMode="decimal" />
            <input value={orderDraft.shipping} onChange={(event) => setOrderDraft({ ...orderDraft, shipping: event.target.value })} placeholder="Envio" inputMode="decimal" />
            <input value={orderDraft.importCost} onChange={(event) => setOrderDraft({ ...orderDraft, importCost: event.target.value })} placeholder="Importacion" inputMode="decimal" />
            <input className="wide" value={orderDraft.notes} onChange={(event) => setOrderDraft({ ...orderDraft, notes: event.target.value })} placeholder="Notas" />
            <button className="primary-icon-button" type="submit">
              <Plus size={15} aria-hidden="true" />
              Crear orden
            </button>
          </form>

          <div className="inventory-order-list">
            {dashboard.purchaseOrders.map((order) => (
              <div className="inventory-order" key={order.id}>
                <div>
                  <strong>{order.orderNumber || order.lines[0]?.description || 'Orden sin numero'}</strong>
                  <span>{order.supplierName || 'Sin proveedor'} / {formatMoney(order.totalCents)}</span>
                  <small>{order.lines.map((line) => line.description).join(', ')}</small>
                </div>
                <select
                  value={order.status}
                  onChange={(event) => runAction(async () => {
                    await garageApi.inventory.updatePurchaseOrder({ id: order.id, status: event.target.value as PurchaseOrderStatus })
                  })}
                >
                  {Object.entries(orderStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button className="icon-button approve" type="button" title="Completar" onClick={() => runAction(async () => { await garageApi.inventory.completePurchaseOrder(order.id); await onRefreshProject() })}>
                  <PackageCheck size={15} aria-hidden="true" />
                </button>
                <button className="icon-button danger" type="button" title="Cancelar" onClick={() => runAction(async () => { await garageApi.inventory.cancelPurchaseOrder(order.id) })}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
            {dashboard.purchaseOrders.length === 0 ? <div className="empty-slot">Sin ordenes vinculadas</div> : null}
          </div>
        </section>
      ) : null}

      {tab === 'suppliers' ? (
        <div className="inventory-grid">
          <section className="inventory-card">
            <div className="section-title">
              <span>Proveedor</span>
              <small>{dashboard.suppliers.length}</small>
            </div>
            <form className="inventory-form supplier" onSubmit={handleCreateSupplier}>
              <input value={supplierDraft.name} onChange={(event) => setSupplierDraft({ ...supplierDraft, name: event.target.value })} placeholder="Nombre" />
              <input value={supplierDraft.country} onChange={(event) => setSupplierDraft({ ...supplierDraft, country: event.target.value })} placeholder="Pais" />
              <input value={supplierDraft.contactName} onChange={(event) => setSupplierDraft({ ...supplierDraft, contactName: event.target.value })} placeholder="Contacto" />
              <input value={supplierDraft.email} onChange={(event) => setSupplierDraft({ ...supplierDraft, email: event.target.value })} placeholder="Correo" />
              <input value={supplierDraft.phone} onChange={(event) => setSupplierDraft({ ...supplierDraft, phone: event.target.value })} placeholder="Telefono" />
              <input value={supplierDraft.website} onChange={(event) => setSupplierDraft({ ...supplierDraft, website: event.target.value })} placeholder="Sitio web" />
              <input value={supplierDraft.rating} onChange={(event) => setSupplierDraft({ ...supplierDraft, rating: event.target.value })} placeholder="Calificacion 0-5" inputMode="decimal" />
              <button className="primary-icon-button" type="submit">
                <Plus size={15} aria-hidden="true" />
                Crear
              </button>
            </form>
            <div className="inventory-supplier-list">
              {dashboard.suppliers.map((supplier) => (
                <SupplierRow key={supplier.id} supplier={supplier} onUpdate={(rating) => runAction(async () => { await garageApi.inventory.updateSupplier({ id: supplier.id, rating }) })} />
              ))}
              {dashboard.suppliers.length === 0 ? <div className="empty-slot">Sin proveedores</div> : null}
            </div>
          </section>

          <section className="inventory-card">
            <div className="section-title">
              <span>
                <MapPin size={15} aria-hidden="true" />
                Ubicaciones
              </span>
              <small>{dashboard.locations.length}</small>
            </div>
            <form className="inventory-form location" onSubmit={handleCreateLocation}>
              <input value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} placeholder="Nueva ubicacion" />
              <select value={locationDraft.locationType} onChange={(event) => setLocationDraft({ ...locationDraft, locationType: event.target.value as InventoryLocationType })}>
                {Object.entries(locationTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button className="primary-icon-button" type="submit">
                <Plus size={15} aria-hidden="true" />
                Agregar
              </button>
            </form>
            <div className="inventory-suggestion-list">
              {dashboard.locations.map((location) => (
                <div className="inventory-suggestion" key={location.id}>
                  <strong>{location.name}</strong>
                  <span>{locationTypeLabels[location.locationType]}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'reports' ? (
        <section className="inventory-card">
          <div className="section-title">
            <span>
              <FileDown size={15} aria-hidden="true" />
              Reportes
            </span>
            <small>{dashboard.reports.length}</small>
          </div>
          <div className="inventory-report-actions">
            {(Object.keys(reportLabels) as InventoryReportType[]).map((reportType) => (
              <button className="primary-icon-button" key={reportType} type="button" onClick={() => void handleGenerateReport(reportType)}>
                <FileDown size={15} aria-hidden="true" />
                {reportLabels[reportType]}
              </button>
            ))}
          </div>
          <div className="planning-line-list">
            {dashboard.reports.map((report) => (
              <div className="planning-line" key={report.id}>
                <div>
                  <strong>{reportLabels[report.reportType]}</strong>
                  <span>{formatDateTime(report.createdAt)}</span>
                </div>
                <strong>{report.status}</strong>
                {report.localFileUrl ? <a href={report.localFileUrl}>Abrir</a> : <span>Sin archivo</span>}
              </div>
            ))}
            {dashboard.reports.length === 0 ? <div className="empty-slot">Sin reportes generados</div> : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function InventoryItemRow({
  item,
  projectId,
  onUpdate,
  onReserve,
  onImportPhotos,
  onDelete
}: {
  item: InventoryItem
  projectId: string
  onUpdate: (input: { id: string; status?: InventoryItemStatus; quantity?: number }) => Promise<void>
  onReserve: (itemId: string) => Promise<void>
  onImportPhotos: (itemId: string) => Promise<void>
  onDelete: (itemId: string) => Promise<void>
}) {
  const linkedToProject = item.projectLinks.some((link) => link.projectId === projectId && link.status !== 'released')

  return (
    <article className="inventory-item-row">
      <div className="inventory-photo-strip">
        {item.photos[0] ? <img src={item.photos[0].photoUrl} alt={item.name} /> : <div className="media-placeholder" />}
      </div>
      <div>
        <strong>{item.name}</strong>
        <span>{itemTypeLabels[item.itemType]} / {item.partNumber || 'Sin parte'}</span>
        <small>{item.supplierName || 'Sin proveedor'} / {item.locationName || 'Sin ubicacion'} / {formatMoney(item.unitCostCents)}</small>
        {item.projectLinks.length > 0 ? <small>{item.projectLinks.map((link) => `${link.projectLabel}: ${link.status}`).join(' | ')}</small> : null}
      </div>
      <input value={item.quantity} onChange={(event) => void onUpdate({ id: item.id, quantity: Number(event.target.value || 0) })} inputMode="decimal" />
      <select value={item.status} onChange={(event) => void onUpdate({ id: item.id, status: event.target.value as InventoryItemStatus })}>
        {Object.entries(itemStatusLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button className="icon-button" type="button" title="Fotografias" onClick={() => void onImportPhotos(item.id)}>
        <Camera size={14} aria-hidden="true" />
      </button>
      <button className="icon-button" type="button" title="Reservar" disabled={linkedToProject} onClick={() => void onReserve(item.id)}>
        <PackageCheck size={14} aria-hidden="true" />
      </button>
      <button className="icon-button danger" type="button" title="Eliminar" onClick={() => void onDelete(item.id)}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </article>
  )
}

function SupplierRow({ supplier, onUpdate }: { supplier: InventorySupplier; onUpdate: (rating: number) => Promise<void> }) {
  return (
    <article className="inventory-supplier-row">
      <div>
        <strong>{supplier.name}</strong>
        <span>{supplier.country || 'Sin pais'} / {supplier.email || 'Sin correo'}</span>
        <small>{supplier.purchaseCount} compra(s), {formatMoney(supplier.totalSpendCents)} / entrega {formatDuration(supplier.averageDeliverySeconds)}</small>
      </div>
      <input
        value={supplier.rating || ''}
        onChange={(event) => void onUpdate(Number(event.target.value || 0))}
        inputMode="decimal"
        title="Calificacion"
      />
    </article>
  )
}

function AlertIcon() {
  return <ShoppingCart size={15} aria-hidden="true" />
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

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return 'sin historial'
  }

  const days = Math.round(seconds / 86400)
  return `${days}d`
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ocurrio un error inesperado.'
}
