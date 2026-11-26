import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  CreateInventoryItemInput,
  CreateInventoryLocationInput,
  CreateInventorySupplierInput,
  CreatePurchaseOrderInput,
  InventoryAlert,
  InventoryDashboard,
  InventoryItem,
  InventoryItemPhoto,
  InventoryItemStatus,
  InventoryItemType,
  InventoryLocation,
  InventoryLocationType,
  InventoryProjectLink,
  InventoryReport,
  InventoryReportType,
  InventorySupplier,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  ReserveInventoryItemInput,
  RiskLevel,
  SuggestedPurchase,
  UpdateInventoryItemInput,
  UpdateInventorySupplierInput,
  UpdatePurchaseOrderInput
} from '../../shared/types'

type LocationRow = {
  id: string
  name: string
  location_type: InventoryLocationType
  notes: string
  created_at: string
  updated_at: string
}

type SupplierRow = {
  id: string
  name: string
  country: string
  contact_name: string
  email: string
  phone: string
  website: string
  notes: string
  rating: number
  delivery_score: number
  quality_score: number
  cost_score: number
  purchase_count: number
  total_spend_cents: number
  average_delivery_seconds: number | null
  created_at: string
  updated_at: string
}

type ItemRow = {
  id: string
  item_type: InventoryItemType
  name: string
  category: string
  description: string
  brand: string
  part_number: string
  manufacturer: string
  quantity: number
  low_stock_threshold: number
  location_id: string | null
  location_name: string | null
  status: InventoryItemStatus
  unit_cost_cents: number
  supplier_id: string | null
  supplier_name: string | null
  created_at: string
  updated_at: string
}

type LinkRow = {
  id: string
  item_id: string
  project_id: string
  project_label: string
  quantity_reserved: number
  status: 'reserved' | 'installed' | 'released'
  notes: string
  created_at: string
  updated_at: string
}

type PhotoRow = {
  id: string
  item_id: string
  filename: string
  mime_type: string
  created_at: string
}

type OrderRow = {
  id: string
  supplier_id: string | null
  supplier_name: string | null
  project_id: string | null
  project_label: string | null
  order_number: string
  ordered_on: string
  expected_on: string | null
  received_on: string | null
  status: PurchaseOrderStatus
  subtotal_cents: number
  tax_cents: number
  shipping_cents: number
  import_cents: number
  total_cents: number
  notes: string
  created_at: string
  updated_at: string
}

type OrderLineRow = {
  id: string
  purchase_order_id: string
  inventory_item_id: string | null
  project_id: string | null
  project_label: string | null
  description: string
  part_number: string
  quantity: number
  unit_cost_cents: number
  line_total_cents: number
  created_at: string
}

type ReportRow = {
  id: string
  report_type: InventoryReportType
  status: 'generated' | 'failed'
  local_path: string
  created_at: string
}

export class InventoryRepository {
  constructor(private readonly database: Database.Database) {}

  getDashboard(projectId?: string | null): InventoryDashboard {
    const items = this.listItems(projectId)
    const suppliers = this.listSuppliers()
    const purchaseOrders = this.listPurchaseOrders(projectId)
    const locations = this.listLocations()
    const suggestedPurchases = this.listSuggestedPurchases(projectId)
    const alerts = this.buildAlerts(items, purchaseOrders, suggestedPurchases)

    return {
      stats: this.buildStats(items, suppliers, purchaseOrders),
      items,
      suppliers,
      purchaseOrders,
      locations,
      alerts,
      suggestedPurchases,
      reports: this.listReports(projectId)
    }
  }

  listLocations(): InventoryLocation[] {
    const rows = this.database
      .prepare('SELECT * FROM inventory_locations_v7 ORDER BY location_type, name')
      .all() as LocationRow[]

    return rows.map(mapLocation)
  }

  createLocation(input: CreateInventoryLocationInput): InventoryLocation {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    this.database
      .prepare(
        `
        INSERT INTO inventory_locations_v7 (id, name, location_type, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(id, normalizeRequired(input.name, 'Ubicacion'), input.locationType, normalizeOptional(input.notes), now, now)

    return this.getLocation(id)
  }

  listSuppliers(): InventorySupplier[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          supplier.*,
          COUNT(po.id) as purchase_count,
          COALESCE(SUM(CASE WHEN po.status != 'canceled' THEN po.total_cents ELSE 0 END), 0) as total_spend_cents,
          AVG(
            CASE
              WHEN po.received_on IS NOT NULL THEN strftime('%s', po.received_on) - strftime('%s', po.ordered_on)
              ELSE NULL
            END
          ) as average_delivery_seconds
        FROM inventory_suppliers_v7 supplier
        LEFT JOIN purchase_orders_v7 po ON po.supplier_id = supplier.id
        GROUP BY supplier.id
        ORDER BY supplier.name ASC
      `
      )
      .all() as SupplierRow[]

    return rows.map(mapSupplier)
  }

  createSupplier(input: CreateInventorySupplierInput): InventorySupplier {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    this.database
      .prepare(
        `
        INSERT INTO inventory_suppliers_v7 (
          id, name, country, contact_name, email, phone, website, notes, rating,
          delivery_score, quality_score, cost_score, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        normalizeRequired(input.name, 'Proveedor'),
        normalizeOptional(input.country),
        normalizeOptional(input.contactName),
        normalizeOptional(input.email),
        normalizeOptional(input.phone),
        normalizeOptional(input.website),
        normalizeOptional(input.notes),
        clampRating(input.rating ?? 0),
        0,
        0,
        0,
        now,
        now
      )

    return this.getSupplier(id)
  }

  updateSupplier(input: UpdateInventorySupplierInput): InventorySupplier {
    const existing = this.getSupplier(input.id)
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
        UPDATE inventory_suppliers_v7
        SET
          name = ?,
          country = ?,
          contact_name = ?,
          email = ?,
          phone = ?,
          website = ?,
          notes = ?,
          rating = ?,
          updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.name === undefined ? existing.name : normalizeRequired(input.name, 'Proveedor'),
        input.country === undefined ? existing.country : normalizeOptional(input.country),
        input.contactName === undefined ? existing.contactName : normalizeOptional(input.contactName),
        input.email === undefined ? existing.email : normalizeOptional(input.email),
        input.phone === undefined ? existing.phone : normalizeOptional(input.phone),
        input.website === undefined ? existing.website : normalizeOptional(input.website),
        input.notes === undefined ? existing.notes : normalizeOptional(input.notes),
        input.rating === undefined ? existing.rating : clampRating(input.rating),
        now,
        input.id
      )

    return this.getSupplier(input.id)
  }

  listItems(projectId?: string | null): InventoryItem[] {
    const where = projectId
      ? `
        WHERE EXISTS (
          SELECT 1
          FROM inventory_item_project_links_v7 link
          WHERE link.item_id = item.id AND link.project_id = @projectId AND link.status != 'released'
        )
        OR EXISTS (
          SELECT 1
          FROM purchase_order_lines_v7 line
          WHERE line.inventory_item_id = item.id AND line.project_id = @projectId
        )
      `
      : ''
    const statement = this.database.prepare(
      `
        SELECT
          item.*,
          location.name as location_name,
          supplier.name as supplier_name
        FROM inventory_stock_items_v7 item
        LEFT JOIN inventory_locations_v7 location ON location.id = item.location_id
        LEFT JOIN inventory_suppliers_v7 supplier ON supplier.id = item.supplier_id
        ${where}
        ORDER BY
          CASE item.status
            WHEN 'available' THEN 1
            WHEN 'reserved' THEN 2
            WHEN 'ordered' THEN 3
            WHEN 'in_transit' THEN 4
            WHEN 'received' THEN 5
            WHEN 'repair' THEN 6
            WHEN 'installed' THEN 7
            ELSE 8
          END,
          item.name ASC
      `
    )
    const rows = (projectId ? statement.all({ projectId }) : statement.all()) as ItemRow[]

    return rows.map((row) => this.mapItem(row))
  }

  createItem(input: CreateInventoryItemInput): InventoryItem {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const status = input.status ?? (input.projectId ? 'reserved' : 'available')

    this.database
      .prepare(
        `
        INSERT INTO inventory_stock_items_v7 (
          id, item_type, name, category, description, brand, part_number, manufacturer,
          quantity, low_stock_threshold, location_id, status, unit_cost_cents, supplier_id,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.itemType,
        normalizeRequired(input.name, 'Articulo'),
        normalizeOptional(input.category),
        normalizeOptional(input.description),
        normalizeOptional(input.brand),
        normalizeOptional(input.partNumber),
        normalizeOptional(input.manufacturer),
        Math.max(0, Number(input.quantity ?? 1)),
        Math.max(0, Number(input.lowStockThreshold ?? 0)),
        input.locationId ?? null,
        status,
        Math.max(0, Math.round(input.unitCostCents ?? 0)),
        input.supplierId ?? null,
        now,
        now
      )

    if (input.projectId) {
      this.reserveItem({
        itemId: id,
        projectId: input.projectId,
        quantityReserved: input.reservedQuantity ?? 1,
        notes: 'Reserva creada desde ficha de inventario'
      })
    }

    return this.getItem(id)
  }

  updateItem(input: UpdateInventoryItemInput): InventoryItem {
    const existing = this.getItem(input.id)
    const now = new Date().toISOString()
    this.database
      .prepare(
        `
        UPDATE inventory_stock_items_v7
        SET
          item_type = ?,
          name = ?,
          category = ?,
          description = ?,
          brand = ?,
          part_number = ?,
          manufacturer = ?,
          quantity = ?,
          low_stock_threshold = ?,
          location_id = ?,
          status = ?,
          unit_cost_cents = ?,
          supplier_id = ?,
          updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.itemType ?? existing.itemType,
        input.name === undefined ? existing.name : normalizeRequired(input.name, 'Articulo'),
        input.category === undefined ? existing.category : normalizeOptional(input.category),
        input.description === undefined ? existing.description : normalizeOptional(input.description),
        input.brand === undefined ? existing.brand : normalizeOptional(input.brand),
        input.partNumber === undefined ? existing.partNumber : normalizeOptional(input.partNumber),
        input.manufacturer === undefined ? existing.manufacturer : normalizeOptional(input.manufacturer),
        input.quantity === undefined ? existing.quantity : Math.max(0, Number(input.quantity)),
        input.lowStockThreshold === undefined ? existing.lowStockThreshold : Math.max(0, Number(input.lowStockThreshold)),
        input.locationId === undefined ? existing.locationId : input.locationId,
        input.status ?? existing.status,
        input.unitCostCents === undefined ? existing.unitCostCents : Math.max(0, Math.round(input.unitCostCents)),
        input.supplierId === undefined ? existing.supplierId : input.supplierId,
        now,
        input.id
      )

    return this.getItem(input.id)
  }

  deleteItem(id: string): void {
    this.getItem(id)
    this.database.prepare('DELETE FROM inventory_stock_items_v7 WHERE id = ?').run(id)
  }

  reserveItem(input: ReserveInventoryItemInput): InventoryItem {
    const item = this.getItem(input.itemId)
    const project = this.getProjectLabel(input.projectId)
    const now = new Date().toISOString()
    const quantity = Math.max(0.01, Number(input.quantityReserved))

    if (item.quantity > 0 && quantity > item.quantity) {
      throw new Error('No hay cantidad suficiente para reservar esa pieza.')
    }

    const id = crypto.randomUUID()
    this.database
      .prepare(
        `
        INSERT INTO inventory_item_project_links_v7 (
          id, item_id, project_id, quantity_reserved, status, notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?)
      `
      )
      .run(id, input.itemId, input.projectId, quantity, normalizeOptional(input.notes), now, now)

    this.database
      .prepare("UPDATE inventory_stock_items_v7 SET status = 'reserved', updated_at = ? WHERE id = ? AND status = 'available'")
      .run(now, input.itemId)
    this.addHistoryEvent(input.projectId, 'inventory_item_reserved', 'Pieza reservada', `${item.name} reservado para ${project}`, now)
    return this.getItem(input.itemId)
  }

  createItemPhoto(input: {
    itemId: string
    localPath: string
    filename: string
    mimeType: string
    hash: string
  }): InventoryItemPhoto {
    this.getItem(input.itemId)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    this.database
      .prepare(
        `
        INSERT INTO inventory_item_photos_v7 (id, item_id, local_path, filename, mime_type, hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(id, input.itemId, input.localPath, input.filename, input.mimeType, input.hash, now)

    return this.getPhoto(id)
  }

  createPurchaseOrder(input: CreatePurchaseOrderInput): PurchaseOrder {
    if (input.lines.length === 0) {
      throw new Error('Agrega al menos una linea de compra.')
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const subtotal = input.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitCostCents), 0)
    const tax = Math.max(0, Math.round(input.taxCents ?? 0))
    const shipping = Math.max(0, Math.round(input.shippingCents ?? 0))
    const importCost = Math.max(0, Math.round(input.importCents ?? 0))
    const total = subtotal + tax + shipping + importCost

    this.database
      .prepare(
        `
        INSERT INTO purchase_orders_v7 (
          id, supplier_id, project_id, order_number, ordered_on, expected_on, status,
          subtotal_cents, tax_cents, shipping_cents, import_cents, total_cents,
          notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.supplierId ?? null,
        input.projectId ?? null,
        normalizeOptional(input.orderNumber),
        input.orderedOn,
        input.expectedOn ?? null,
        input.status ?? 'pending',
        subtotal,
        tax,
        shipping,
        importCost,
        total,
        normalizeOptional(input.notes),
        now,
        now
      )

    for (const line of input.lines) {
      const lineProjectId = line.projectId ?? input.projectId ?? null
      const quantity = Math.max(0.01, Number(line.quantity))
      const unitCost = Math.max(0, Math.round(line.unitCostCents))
      this.database
        .prepare(
          `
          INSERT INTO purchase_order_lines_v7 (
            id, purchase_order_id, inventory_item_id, project_id, description,
            part_number, quantity, unit_cost_cents, line_total_cents, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          crypto.randomUUID(),
          id,
          line.inventoryItemId ?? null,
          lineProjectId,
          normalizeRequired(line.description, 'Linea de compra'),
          normalizeOptional(line.partNumber),
          quantity,
          unitCost,
          Math.round(quantity * unitCost),
          now
        )

      if (line.inventoryItemId) {
        this.database
          .prepare("UPDATE inventory_stock_items_v7 SET status = ?, updated_at = ? WHERE id = ? AND status != 'installed'")
          .run(resolveItemStatusForOrder(input.status ?? 'pending'), now, line.inventoryItemId)
      }
    }

    if (input.projectId) {
      this.addHistoryEvent(input.projectId, 'purchase_order_created', 'Orden de compra creada', `${input.orderNumber || id}: ${total}`, now)
    }

    return this.getPurchaseOrder(id)
  }

  updatePurchaseOrder(input: UpdatePurchaseOrderInput): PurchaseOrder {
    const existing = this.getPurchaseOrder(input.id)
    const now = new Date().toISOString()
    const tax = input.taxCents === undefined ? existing.taxCents : Math.max(0, Math.round(input.taxCents))
    const shipping = input.shippingCents === undefined ? existing.shippingCents : Math.max(0, Math.round(input.shippingCents))
    const importCost = input.importCents === undefined ? existing.importCents : Math.max(0, Math.round(input.importCents))
    const total = existing.subtotalCents + tax + shipping + importCost

    this.database
      .prepare(
        `
        UPDATE purchase_orders_v7
        SET
          supplier_id = ?,
          project_id = ?,
          order_number = ?,
          ordered_on = ?,
          expected_on = ?,
          received_on = ?,
          status = ?,
          tax_cents = ?,
          shipping_cents = ?,
          import_cents = ?,
          total_cents = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.supplierId === undefined ? existing.supplierId : input.supplierId,
        input.projectId === undefined ? existing.projectId : input.projectId,
        input.orderNumber === undefined ? existing.orderNumber : normalizeOptional(input.orderNumber),
        input.orderedOn ?? existing.orderedOn,
        input.expectedOn === undefined ? existing.expectedOn : input.expectedOn,
        input.receivedOn === undefined ? existing.receivedOn : input.receivedOn,
        input.status ?? existing.status,
        tax,
        shipping,
        importCost,
        total,
        input.notes === undefined ? existing.notes : normalizeOptional(input.notes),
        now,
        input.id
      )

    if (input.status) {
      this.syncOrderItemStatuses(input.id, input.status, now)
    }

    return this.getPurchaseOrder(input.id)
  }

  cancelPurchaseOrder(id: string): PurchaseOrder {
    return this.updatePurchaseOrder({ id, status: 'canceled' })
  }

  completePurchaseOrder(id: string): PurchaseOrder {
    const existing = this.getPurchaseOrder(id)

    if (existing.status === 'received') {
      return existing
    }

    const now = new Date().toISOString()
    const completed = this.updatePurchaseOrder({ id, status: 'received', receivedOn: now })

    for (const line of completed.lines) {
      if (!line.inventoryItemId) {
        continue
      }

      const item = this.getItem(line.inventoryItemId)
      this.database
        .prepare(
          `
          UPDATE inventory_stock_items_v7
          SET quantity = ?, status = 'received', updated_at = ?
          WHERE id = ?
        `
        )
        .run(item.quantity + line.quantity, now, line.inventoryItemId)
    }

    const affectedProjects = new Set(completed.lines.map((line) => line.projectId).filter(Boolean) as string[])
    if (completed.projectId) {
      affectedProjects.add(completed.projectId)
    }

    for (const projectId of affectedProjects) {
      this.addCostEntry(projectId, completed)
      this.addHistoryEvent(
        projectId,
        'purchase_order_received',
        'Orden de compra recibida',
        `${completed.orderNumber || completed.id}: ${completed.lines.map((line) => line.description).join(', ')}`,
        now
      )
    }

    return this.getPurchaseOrder(id)
  }

  createReport(reportType: InventoryReportType, projectId: string | null, status: 'generated' | 'failed', localPath: string): InventoryReport {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    this.database
      .prepare(
        `
        INSERT INTO inventory_reports_v7 (id, report_type, project_id, status, local_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(id, reportType, projectId, status, localPath, now)

    return this.getReport(id)
  }

  getItem(id: string): InventoryItem {
    const row = this.database
      .prepare(
        `
        SELECT
          item.*,
          location.name as location_name,
          supplier.name as supplier_name
        FROM inventory_stock_items_v7 item
        LEFT JOIN inventory_locations_v7 location ON location.id = item.location_id
        LEFT JOIN inventory_suppliers_v7 supplier ON supplier.id = item.supplier_id
        WHERE item.id = ?
      `
      )
      .get(id) as ItemRow | undefined

    if (!row) {
      throw new Error('Articulo de inventario no encontrado.')
    }

    return this.mapItem(row)
  }

  getPhotoPath(id: string): string {
    const row = this.database.prepare('SELECT local_path FROM inventory_item_photos_v7 WHERE id = ?').get(id) as
      | { local_path: string }
      | undefined

    if (!row) {
      throw new Error('Fotografia de inventario no encontrada.')
    }

    return row.local_path
  }

  getReportPath(id: string): string {
    const row = this.database.prepare('SELECT local_path FROM inventory_reports_v7 WHERE id = ?').get(id) as
      | { local_path: string }
      | undefined

    if (!row || !row.local_path) {
      throw new Error('Reporte de inventario no encontrado.')
    }

    return row.local_path
  }

  private getLocation(id: string): InventoryLocation {
    const row = this.database.prepare('SELECT * FROM inventory_locations_v7 WHERE id = ?').get(id) as LocationRow | undefined

    if (!row) {
      throw new Error('Ubicacion no encontrada.')
    }

    return mapLocation(row)
  }

  private getSupplier(id: string): InventorySupplier {
    const supplier = this.listSuppliers().find((item) => item.id === id)

    if (!supplier) {
      throw new Error('Proveedor no encontrado.')
    }

    return supplier
  }

  private getPhoto(id: string): InventoryItemPhoto {
    const row = this.database.prepare('SELECT * FROM inventory_item_photos_v7 WHERE id = ?').get(id) as PhotoRow | undefined

    if (!row) {
      throw new Error('Fotografia no encontrada.')
    }

    return mapPhoto(row)
  }

  private getPurchaseOrder(id: string): PurchaseOrder {
    const row = this.database
      .prepare(
        `
        SELECT
          po.*,
          supplier.name as supplier_name,
          trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label
        FROM purchase_orders_v7 po
        LEFT JOIN inventory_suppliers_v7 supplier ON supplier.id = po.supplier_id
        LEFT JOIN vehicle_projects project ON project.id = po.project_id
        WHERE po.id = ?
      `
      )
      .get(id) as OrderRow | undefined

    if (!row) {
      throw new Error('Orden de compra no encontrada.')
    }

    return this.mapPurchaseOrder(row)
  }

  private listPurchaseOrders(projectId?: string | null): PurchaseOrder[] {
    const where = projectId
      ? `
        WHERE po.project_id = @projectId
        OR EXISTS (
          SELECT 1 FROM purchase_order_lines_v7 line
          WHERE line.purchase_order_id = po.id AND line.project_id = @projectId
        )
      `
      : ''
    const statement = this.database.prepare(
      `
        SELECT
          po.*,
          supplier.name as supplier_name,
          trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label
        FROM purchase_orders_v7 po
        LEFT JOIN inventory_suppliers_v7 supplier ON supplier.id = po.supplier_id
        LEFT JOIN vehicle_projects project ON project.id = po.project_id
        ${where}
        ORDER BY po.created_at DESC
      `
    )
    const rows = (projectId ? statement.all({ projectId }) : statement.all()) as OrderRow[]

    return rows.map((row) => this.mapPurchaseOrder(row))
  }

  private listReports(projectId?: string | null): InventoryReport[] {
    const where = projectId === undefined ? '' : 'WHERE project_id IS @projectId OR project_id IS NULL'
    const statement = this.database.prepare(
      `
        SELECT *
        FROM inventory_reports_v7
        ${where}
        ORDER BY created_at DESC
        LIMIT 20
      `
    )
    const rows =
      projectId === undefined ? (statement.all() as ReportRow[]) : (statement.all({ projectId: projectId ?? null }) as ReportRow[])

    return rows.map(mapReport)
  }

  private getReport(id: string): InventoryReport {
    const row = this.database.prepare('SELECT * FROM inventory_reports_v7 WHERE id = ?').get(id) as ReportRow | undefined

    if (!row) {
      throw new Error('Reporte no encontrado.')
    }

    return mapReport(row)
  }

  private mapItem(row: ItemRow): InventoryItem {
    return {
      id: row.id,
      itemType: row.item_type,
      name: row.name,
      category: row.category,
      description: row.description,
      brand: row.brand,
      partNumber: row.part_number,
      manufacturer: row.manufacturer,
      quantity: Number(row.quantity),
      lowStockThreshold: Number(row.low_stock_threshold),
      locationId: row.location_id,
      locationName: row.location_name ?? '',
      status: row.status,
      unitCostCents: row.unit_cost_cents,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name ?? '',
      projectLinks: this.listProjectLinks(row.id),
      photos: this.listPhotos(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private listProjectLinks(itemId: string): InventoryProjectLink[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          link.*,
          trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label
        FROM inventory_item_project_links_v7 link
        INNER JOIN vehicle_projects project ON project.id = link.project_id
        WHERE link.item_id = ?
        ORDER BY link.created_at DESC
      `
      )
      .all(itemId) as LinkRow[]

    return rows.map(mapProjectLink)
  }

  private listPhotos(itemId: string): InventoryItemPhoto[] {
    const rows = this.database
      .prepare('SELECT * FROM inventory_item_photos_v7 WHERE item_id = ? ORDER BY created_at DESC')
      .all(itemId) as PhotoRow[]

    return rows.map(mapPhoto)
  }

  private mapPurchaseOrder(row: OrderRow): PurchaseOrder {
    return {
      id: row.id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name ?? '',
      projectId: row.project_id,
      projectLabel: row.project_label ?? '',
      orderNumber: row.order_number,
      orderedOn: row.ordered_on,
      expectedOn: row.expected_on,
      receivedOn: row.received_on,
      status: row.status,
      subtotalCents: row.subtotal_cents,
      taxCents: row.tax_cents,
      shippingCents: row.shipping_cents,
      importCents: row.import_cents,
      totalCents: row.total_cents,
      notes: row.notes,
      lines: this.listOrderLines(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private listOrderLines(purchaseOrderId: string): PurchaseOrderLine[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          line.*,
          trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label
        FROM purchase_order_lines_v7 line
        LEFT JOIN vehicle_projects project ON project.id = line.project_id
        WHERE line.purchase_order_id = ?
        ORDER BY line.created_at ASC
      `
      )
      .all(purchaseOrderId) as OrderLineRow[]

    return rows.map(mapOrderLine)
  }

  private buildStats(items: InventoryItem[], suppliers: InventorySupplier[], orders: PurchaseOrder[]): InventoryDashboard['stats'] {
    const activeOrders = orders.filter((order) => !['received', 'canceled'].includes(order.status))
    const delayed = activeOrders.filter((order) => order.expectedOn && new Date(order.expectedOn).getTime() < Date.now())

    return {
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      totalValueCents: Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitCostCents, 0)),
      reservedValueCents: Math.round(
        items.reduce(
          (sum, item) =>
            sum +
            item.projectLinks
              .filter((link) => link.status === 'reserved')
              .reduce((linkSum, link) => linkSum + link.quantityReserved * item.unitCostCents, 0),
          0
        )
      ),
      usedValueCents: Math.round(
        items.reduce(
          (sum, item) =>
            sum +
            item.projectLinks
              .filter((link) => link.status === 'installed')
              .reduce((linkSum, link) => linkSum + link.quantityReserved * item.unitCostCents, 0),
          0
        )
      ),
      pendingValueCents: activeOrders.reduce((sum, order) => sum + order.totalCents, 0),
      activeOrderCount: activeOrders.length,
      delayedOrderCount: delayed.length,
      supplierCount: suppliers.length
    }
  }

  private buildAlerts(items: InventoryItem[], orders: PurchaseOrder[], suggestions: SuggestedPurchase[]): InventoryAlert[] {
    const alerts: InventoryAlert[] = []

    for (const item of items) {
      if (item.lowStockThreshold > 0 && item.quantity <= item.lowStockThreshold && item.status !== 'discarded') {
        alerts.push({
          id: `stock-${item.id}`,
          severity: item.quantity === 0 ? 'high' : 'medium',
          title: 'Stock bajo',
          body: item.name,
          evidence: `${item.quantity}/${item.lowStockThreshold}`,
          projectId: null,
          itemId: item.id,
          purchaseOrderId: null
        })
      }
    }

    for (const order of orders) {
      if (!['received', 'canceled'].includes(order.status) && order.expectedOn && new Date(order.expectedOn).getTime() < Date.now()) {
        alerts.push({
          id: `order-${order.id}`,
          severity: 'high',
          title: 'Pedido retrasado',
          body: order.orderNumber || order.lines[0]?.description || 'Orden de compra',
          evidence: order.expectedOn,
          projectId: order.projectId,
          itemId: null,
          purchaseOrderId: order.id
        })
      }
    }

    for (const suggestion of suggestions.filter((item) => item.priority <= 2).slice(0, 5)) {
      alerts.push({
        id: `suggestion-${suggestion.id}`,
        severity: suggestion.priority === 1 ? 'critical' : 'high',
        title: 'Pieza critica faltante',
        body: suggestion.title,
        evidence: suggestion.evidence,
        projectId: suggestion.projectId,
        itemId: null,
        purchaseOrderId: null
      })
    }

    return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  }

  private listSuggestedPurchases(projectId?: string | null): SuggestedPurchase[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          checklist.id,
          checklist.project_id,
          checklist.title,
          checklist.section,
          checklist.notes,
          trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label
        FROM project_checklist_items checklist
        INNER JOIN vehicle_projects project ON project.id = checklist.project_id
        WHERE checklist.status NOT IN ('assembled', 'completed')
          AND (@projectId IS NULL OR checklist.project_id = @projectId)
        ORDER BY checklist.created_at ASC
      `
      )
      .all({ projectId: projectId ?? null }) as Array<{
      id: string
      project_id: string
      title: string
      section: string
      notes: string
      project_label: string
    }>

    const checklistSuggestions = rows
      .filter((row) => /(compr|pieza|falt|orden|refaccion|emblema|faro|radio|volante|llanta|rin|moldura)/.test(normalize(`${row.title} ${row.notes}`)))
      .filter((row) => !this.hasReservedEvidence(row.project_id, row.title))
      .map<SuggestedPurchase>((row) => ({
        id: `checklist-${row.id}`,
        projectId: row.project_id,
        projectLabel: row.project_label,
        title: row.title,
        source: 'checklist',
        priority: /falt|crit|faro|volante|motor/.test(normalize(row.title)) ? 1 : 3,
        evidence: `Checklist ${row.section}`,
        confidence: 0.72,
        checklistItemId: row.id
      }))

    const oemRows = this.database
      .prepare(
        `
        SELECT
          suggestion.id,
          suggestion.project_id,
          suggestion.title,
          suggestion.confidence,
          suggestion.oem_reference,
          trim(COALESCE(project.year || ' ', '') || project.make || ' ' || project.model) as project_label
        FROM oem_comparison_suggestions suggestion
        INNER JOIN vehicle_projects project ON project.id = suggestion.project_id
        WHERE suggestion.status = 'pending'
          AND suggestion.difference_type = 'missing_component'
          AND (@projectId IS NULL OR suggestion.project_id = @projectId)
        ORDER BY suggestion.confidence DESC
      `
      )
      .all({ projectId: projectId ?? null }) as Array<{
      id: string
      project_id: string
      title: string
      confidence: number
      oem_reference: string
      project_label: string
    }>

    const oemSuggestions = oemRows
      .filter((row) => !this.hasReservedEvidence(row.project_id, row.title))
      .map<SuggestedPurchase>((row) => ({
        id: `oem-${row.id}`,
        projectId: row.project_id,
        projectLabel: row.project_label,
        title: row.title,
        source: 'oem',
        priority: row.confidence >= 0.75 ? 1 : 2,
        evidence: row.oem_reference || 'Comparacion OEM',
        confidence: row.confidence,
        checklistItemId: null
      }))

    return [...checklistSuggestions, ...oemSuggestions].sort((a, b) => a.priority - b.priority || b.confidence - a.confidence)
  }

  private hasReservedEvidence(projectId: string, title: string): boolean {
    const needle = normalize(title)
    const links = this.database
      .prepare(
        `
        SELECT item.name, item.part_number
        FROM inventory_item_project_links_v7 link
        INNER JOIN inventory_stock_items_v7 item ON item.id = link.item_id
        WHERE link.project_id = ? AND link.status IN ('reserved', 'installed')
      `
      )
      .all(projectId) as Array<{ name: string; part_number: string }>

    return links.some((link) => {
      const haystack = normalize(`${link.name} ${link.part_number}`)
      return haystack.length > 2 && (needle.includes(haystack) || haystack.includes(needle) || tokenOverlap(needle, haystack) >= 2)
    })
  }

  private syncOrderItemStatuses(orderId: string, status: PurchaseOrderStatus, now: string): void {
    const itemStatus = resolveItemStatusForOrder(status)
    this.database
      .prepare(
        `
        UPDATE inventory_stock_items_v7
        SET status = ?, updated_at = ?
        WHERE id IN (
          SELECT inventory_item_id
          FROM purchase_order_lines_v7
          WHERE purchase_order_id = ? AND inventory_item_id IS NOT NULL
        )
          AND status != 'installed'
      `
      )
      .run(itemStatus, now, orderId)
  }

  private addCostEntry(projectId: string, order: PurchaseOrder): void {
    if (order.totalCents <= 0) {
      return
    }

    const description = `Compra inventario: ${order.orderNumber || order.lines.map((line) => line.description).join(', ')}`
    const existing = this.database
      .prepare('SELECT id FROM cost_entries WHERE project_id = ? AND description = ?')
      .get(projectId, description) as { id: string } | undefined

    if (existing) {
      return
    }

    const now = new Date().toISOString()
    this.database
      .prepare(
        `
        INSERT INTO cost_entries (
          id, project_id, component_id, supplier_id, purchase_id, category,
          description, amount_cents, occurred_on, created_at, updated_at
        )
        VALUES (?, ?, NULL, NULL, NULL, 'purchase', ?, ?, ?, ?, ?)
      `
      )
      .run(crypto.randomUUID(), projectId, description, order.totalCents, order.receivedOn ?? now.slice(0, 10), now, now)
  }

  private addHistoryEvent(projectId: string, eventType: string, title: string, body: string, occurredAt = new Date().toISOString()): void {
    this.database
      .prepare(
        `
        INSERT INTO history_events (
          id, project_id, event_type, title, body, occurred_at, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, '{}', ?)
      `
      )
      .run(crypto.randomUUID(), projectId, eventType, title, body, occurredAt, new Date().toISOString())
  }

  private getProjectLabel(projectId: string): string {
    const row = this.database
      .prepare("SELECT trim(COALESCE(year || ' ', '') || make || ' ' || model) as label FROM vehicle_projects WHERE id = ?")
      .get(projectId) as { label: string } | undefined

    if (!row) {
      throw new Error('Proyecto no encontrado.')
    }

    return row.label
  }
}

function mapLocation(row: LocationRow): InventoryLocation {
  return {
    id: row.id,
    name: row.name,
    locationType: row.location_type,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapSupplier(row: SupplierRow): InventorySupplier {
  const automaticDeliveryScore =
    row.average_delivery_seconds === null
      ? 0
      : row.average_delivery_seconds <= 7 * 86400
        ? 5
        : row.average_delivery_seconds <= 21 * 86400
          ? 4
          : row.average_delivery_seconds <= 45 * 86400
            ? 3
            : 2
  const deliveryScore = row.delivery_score || automaticDeliveryScore
  const qualityScore = row.quality_score || row.rating || 0
  const costScore = row.cost_score || row.rating || 0
  const rating = row.rating || averageScore([deliveryScore, qualityScore, costScore])

  return {
    id: row.id,
    name: row.name,
    country: row.country,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    website: row.website,
    notes: row.notes,
    rating,
    deliveryScore,
    qualityScore,
    costScore,
    purchaseCount: row.purchase_count,
    totalSpendCents: row.total_spend_cents,
    averageDeliverySeconds: row.average_delivery_seconds === null ? null : Math.round(row.average_delivery_seconds),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapProjectLink(row: LinkRow): InventoryProjectLink {
  return {
    id: row.id,
    itemId: row.item_id,
    projectId: row.project_id,
    projectLabel: row.project_label,
    quantityReserved: Number(row.quantity_reserved),
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapPhoto(row: PhotoRow): InventoryItemPhoto {
  return {
    id: row.id,
    itemId: row.item_id,
    filename: row.filename,
    mimeType: row.mime_type,
    photoUrl: `blackline-inventory://photo/${row.id}`,
    createdAt: row.created_at
  }
}

function mapOrderLine(row: OrderLineRow): PurchaseOrderLine {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    inventoryItemId: row.inventory_item_id,
    projectId: row.project_id,
    projectLabel: row.project_label ?? '',
    description: row.description,
    partNumber: row.part_number,
    quantity: Number(row.quantity),
    unitCostCents: row.unit_cost_cents,
    lineTotalCents: row.line_total_cents,
    createdAt: row.created_at
  }
}

function mapReport(row: ReportRow): InventoryReport {
  return {
    id: row.id,
    reportType: row.report_type,
    status: row.status,
    localFileUrl: row.local_path ? `blackline-inventory://report/${row.id}` : null,
    createdAt: row.created_at
  }
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`${label} es obligatorio.`)
  }

  return normalized
}

function normalizeOptional(value?: string | null): string {
  return value?.trim() ?? ''
}

function clampRating(value: number): number {
  return Math.min(5, Math.max(0, Number(value) || 0))
}

function averageScore(values: number[]): number {
  const nonZero = values.filter((value) => value > 0)

  if (nonZero.length === 0) {
    return 0
  }

  return Math.round((nonZero.reduce((sum, value) => sum + value, 0) / nonZero.length) * 10) / 10
}

function resolveItemStatusForOrder(status: PurchaseOrderStatus): InventoryItemStatus {
  switch (status) {
    case 'ordered':
    case 'paid':
      return 'ordered'
    case 'in_transit':
      return 'in_transit'
    case 'received':
      return 'received'
    case 'canceled':
      return 'available'
    default:
      return 'ordered'
  }
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter((token) => token.length > 2))
  return b.split(' ').filter((token) => tokensA.has(token)).length
}

function severityRank(value: RiskLevel): number {
  const ranks: Record<RiskLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
  }

  return ranks[value]
}
