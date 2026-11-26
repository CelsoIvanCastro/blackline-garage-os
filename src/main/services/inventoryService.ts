import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, dialog } from 'electron'
import type {
  CreateInventoryItemInput,
  CreateInventoryLocationInput,
  CreateInventoryReportInput,
  CreateInventorySupplierInput,
  CreatePurchaseOrderInput,
  InventoryDashboard,
  InventoryItem,
  InventoryItemPhoto,
  InventoryLocation,
  InventoryReport,
  InventorySupplier,
  PurchaseOrder,
  ReserveInventoryItemInput,
  UpdateInventoryItemInput,
  UpdateInventorySupplierInput,
  UpdatePurchaseOrderInput
} from '../../shared/types'
import { InventoryRepository } from '../repositories/inventoryRepository'

const supportedImageFilters = [{ name: 'Fotografias', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] }]

export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

  getDashboard(projectId?: string | null): InventoryDashboard {
    return this.repository.getDashboard(projectId ?? undefined)
  }

  createLocation(input: CreateInventoryLocationInput): InventoryLocation {
    return this.repository.createLocation(input)
  }

  createSupplier(input: CreateInventorySupplierInput): InventorySupplier {
    return this.repository.createSupplier(input)
  }

  updateSupplier(input: UpdateInventorySupplierInput): InventorySupplier {
    return this.repository.updateSupplier(input)
  }

  createItem(input: CreateInventoryItemInput): InventoryItem {
    return this.repository.createItem(input)
  }

  updateItem(input: UpdateInventoryItemInput): InventoryItem {
    return this.repository.updateItem(input)
  }

  deleteItem(id: string): void {
    this.repository.deleteItem(id)
  }

  reserveItem(input: ReserveInventoryItemInput): InventoryItem {
    return this.repository.reserveItem(input)
  }

  createPurchaseOrder(input: CreatePurchaseOrderInput): PurchaseOrder {
    return this.repository.createPurchaseOrder(input)
  }

  updatePurchaseOrder(input: UpdatePurchaseOrderInput): PurchaseOrder {
    return this.repository.updatePurchaseOrder(input)
  }

  cancelPurchaseOrder(id: string): PurchaseOrder {
    return this.repository.cancelPurchaseOrder(id)
  }

  completePurchaseOrder(id: string): PurchaseOrder {
    return this.repository.completePurchaseOrder(id)
  }

  async importItemPhotos(itemId: string): Promise<InventoryItemPhoto[]> {
    this.repository.getItem(itemId)
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar fotografias de inventario',
      properties: ['openFile', 'multiSelections'],
      filters: supportedImageFilters
    })

    if (result.canceled || result.filePaths.length === 0) {
      return []
    }

    const itemDirectory = path.join(getInventoryStorageDirectory(), 'items', itemId, 'photos')
    fs.mkdirSync(itemDirectory, { recursive: true })
    const imported: InventoryItemPhoto[] = []

    for (const sourcePath of result.filePaths) {
      const extension = path.extname(sourcePath).toLowerCase()
      const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}${extension}`
      const destinationPath = path.join(itemDirectory, filename)
      fs.copyFileSync(sourcePath, destinationPath)
      imported.push(
        this.repository.createItemPhoto({
          itemId,
          localPath: destinationPath,
          filename: path.basename(sourcePath),
          mimeType: inferMimeType(extension),
          hash: hashFile(destinationPath)
        })
      )
    }

    return imported
  }

  generateReport(input: CreateInventoryReportInput): InventoryReport {
    const dashboard = this.repository.getDashboard(input.projectId ?? undefined)
    const directory = path.join(getInventoryStorageDirectory(), 'reports')
    fs.mkdirSync(directory, { recursive: true })
    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${input.reportType}.csv`
    const localPath = path.join(directory, filename)

    try {
      fs.writeFileSync(localPath, buildCsv(input.reportType, dashboard))
      return this.repository.createReport(input.reportType, input.projectId ?? null, 'generated', localPath)
    } catch {
      return this.repository.createReport(input.reportType, input.projectId ?? null, 'failed', '')
    }
  }
}

export function getInventoryStorageDirectory(): string {
  return path.join(app.getPath('userData'), 'storage', 'inventory')
}

function buildCsv(reportType: CreateInventoryReportInput['reportType'], dashboard: InventoryDashboard): string {
  switch (reportType) {
    case 'purchases':
      return toCsv([
        ['Orden', 'Proveedor', 'Proyecto', 'Estado', 'Fecha', 'Esperado', 'Total'],
        ...dashboard.purchaseOrders.map((order) => [
          order.orderNumber || order.id,
          order.supplierName,
          order.projectLabel,
          order.status,
          order.orderedOn,
          order.expectedOn ?? '',
          String(order.totalCents / 100)
        ])
      ])
    case 'suppliers':
      return toCsv([
        ['Proveedor', 'Pais', 'Contacto', 'Correo', 'Telefono', 'Compras', 'Gasto', 'Rating'],
        ...dashboard.suppliers.map((supplier) => [
          supplier.name,
          supplier.country,
          supplier.contactName,
          supplier.email,
          supplier.phone,
          String(supplier.purchaseCount),
          String(supplier.totalSpendCents / 100),
          String(supplier.rating)
        ])
      ])
    case 'project_parts':
      return toCsv([
        ['Articulo', 'Proyecto', 'Cantidad', 'Estado', 'Costo unitario'],
        ...dashboard.items.flatMap((item) =>
          item.projectLinks.map((link) => [
            item.name,
            link.projectLabel,
            String(link.quantityReserved),
            link.status,
            String(item.unitCostCents / 100)
          ])
        )
      ])
    default:
      return toCsv([
        ['Articulo', 'Tipo', 'Categoria', 'Parte', 'Cantidad', 'Estado', 'Ubicacion', 'Proveedor', 'Valor'],
        ...dashboard.items.map((item) => [
          item.name,
          item.itemType,
          item.category,
          item.partNumber,
          String(item.quantity),
          item.status,
          item.locationName,
          item.supplierName,
          String((item.quantity * item.unitCostCents) / 100)
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
    case '.webp':
      return 'image/webp'
    case '.heic':
    case '.heif':
      return 'image/heic'
    default:
      return 'application/octet-stream'
  }
}
