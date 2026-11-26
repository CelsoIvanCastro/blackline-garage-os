import { nativeImage } from 'electron'
import type { BoundingBox, ChecklistSection, InspectionFindingType } from '../../shared/types'

interface TileStats {
  x: number
  y: number
  width: number
  height: number
  imageWidth: number
  imageHeight: number
  rustRatio: number
  darkRatio: number
  brightRatio: number
  highSaturationRatio: number
  edgeDensity: number
  averageBrightness: number
}

export interface AnalyzerFinding {
  findingType: InspectionFindingType
  workCategory: ChecklistSection
  name: string
  description: string
  confidence: number
  boundingBox: BoundingBox | null
  suggestedAction: string
  checklistTitle: string
  metadata: Record<string, unknown>
}

interface ComponentSignal {
  name: string
  confidence: number
  boundingBox: BoundingBox
}

export class LocalVisionAnalyzer {
  analyzeImage(filePath: string): AnalyzerFinding[] {
    const image = nativeImage.createFromPath(filePath)

    if (image.isEmpty()) {
      throw new Error('No se pudo decodificar la imagen para analisis local.')
    }

    const originalSize = image.getSize()
    const width = Math.min(360, originalSize.width)
    const resized = image.resize({ width })
    const size = resized.getSize()
    const bitmap = resized.toBitmap()
    const tiles = buildTiles(bitmap, size.width, size.height, 8, 6)
    const findings: AnalyzerFinding[] = []
    const components = detectComponents(tiles, size.width, size.height)

    for (const component of components) {
      findings.push({
        findingType: 'component',
        workCategory: inferComponentCategory(component.name),
        name: component.name,
        description: 'Componente visible identificado por analisis local de forma, posicion, contraste y color.',
        confidence: component.confidence,
        boundingBox: component.boundingBox,
        suggestedAction: '',
        checklistTitle: '',
        metadata: { analyzer: 'local-vision-v1' }
      })
    }

    findings.push(...detectDamage(tiles))
    findings.push(...detectMissingParts(components, size.width, size.height))
    findings.push(...detectPossibleModifications(tiles, size.width, size.height))

    return findings
      .filter((finding) => finding.confidence >= minimumConfidence(finding.findingType))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 40)
  }
}

function buildTiles(buffer: Buffer, width: number, height: number, columns: number, rows: number): TileStats[] {
  const tileWidth = Math.floor(width / columns)
  const tileHeight = Math.floor(height / rows)
  const tiles: TileStats[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * tileWidth
      const y = row * tileHeight
      const stats = scanTile(buffer, width, height, x, y, tileWidth, tileHeight)
      tiles.push(stats)
    }
  }

  return tiles
}

function scanTile(
  buffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  width: number,
  height: number
): TileStats {
  let samples = 0
  let rust = 0
  let dark = 0
  let bright = 0
  let highSaturation = 0
  let edge = 0
  let brightnessTotal = 0

  const maxX = Math.min(imageWidth - 2, x + width)
  const maxY = Math.min(imageHeight - 2, y + height)

  for (let py = y; py < maxY; py += 2) {
    for (let px = x; px < maxX; px += 2) {
      const pixel = readPixel(buffer, imageWidth, px, py)
      const right = readPixel(buffer, imageWidth, px + 1, py)
      const down = readPixel(buffer, imageWidth, px, py + 1)
      const brightness = (pixel.r + pixel.g + pixel.b) / 3
      const saturation = saturationOf(pixel.r, pixel.g, pixel.b)
      const gradient =
        Math.abs(pixel.r - right.r) +
        Math.abs(pixel.g - right.g) +
        Math.abs(pixel.b - right.b) +
        Math.abs(pixel.r - down.r) +
        Math.abs(pixel.g - down.g) +
        Math.abs(pixel.b - down.b)

      samples += 1
      brightnessTotal += brightness

      if (isRustColored(pixel.r, pixel.g, pixel.b)) rust += 1
      if (brightness < 58) dark += 1
      if (brightness > 205) bright += 1
      if (saturation > 0.55 && brightness > 60) highSaturation += 1
      if (gradient > 150) edge += 1
    }
  }

  const divisor = Math.max(1, samples)

  return {
    x,
    y,
    width,
    height,
    imageWidth,
    imageHeight,
    rustRatio: rust / divisor,
    darkRatio: dark / divisor,
    brightRatio: bright / divisor,
    highSaturationRatio: highSaturation / divisor,
    edgeDensity: edge / divisor,
    averageBrightness: brightnessTotal / divisor
  }
}

function detectComponents(tiles: TileStats[], imageWidth: number, imageHeight: number): ComponentSignal[] {
  const components: ComponentSignal[] = []
  const bottomTiles = tiles.filter((tile) => tile.y > imageHeight * 0.55)
  const leftBottom = bottomTiles.filter((tile) => tile.x < imageWidth * 0.5)
  const rightBottom = bottomTiles.filter((tile) => tile.x >= imageWidth * 0.5)
  const upperTiles = tiles.filter((tile) => tile.y < imageHeight * 0.42)
  const middleTiles = tiles.filter((tile) => tile.y >= imageHeight * 0.25 && tile.y <= imageHeight * 0.7)
  const bodySignal = average(tiles.map((tile) => tile.edgeDensity + tile.highSaturationRatio * 0.4))
  const darkRoundLeft = strongest(leftBottom, (tile) => tile.darkRatio * 0.7 + tile.edgeDensity * 0.5)
  const darkRoundRight = strongest(rightBottom, (tile) => tile.darkRatio * 0.7 + tile.edgeDensity * 0.5)
  const glassSignal = strongest(
    upperTiles,
    (tile) => tile.brightRatio * 0.22 + (1 - tile.highSaturationRatio) * 0.08 + tile.edgeDensity * 0.8
  )
  const brightLeft = strongest(
    middleTiles.filter((tile) => tile.x < imageWidth * 0.5),
    (tile) => tile.brightRatio * tile.edgeDensity * 4
  )
  const brightRight = strongest(
    middleTiles.filter((tile) => tile.x >= imageWidth * 0.5),
    (tile) => tile.brightRatio * tile.edgeDensity * 4
  )
  const interiorDarkShape = strongest(middleTiles, (tile) => tile.darkRatio * 0.45 + tile.edgeDensity * 0.45)

  if (darkRoundLeft && darkRoundLeft.score > 0.21) {
    components.push(component('Llanta izquierda visible', darkRoundLeft.score, darkRoundLeft.tile))
    components.push(component('Rin izquierdo visible', darkRoundLeft.score * 0.86, shrinkBox(darkRoundLeft.tile, 0.62)))
  }

  if (darkRoundRight && darkRoundRight.score > 0.21) {
    components.push(component('Llanta derecha visible', darkRoundRight.score, darkRoundRight.tile))
    components.push(component('Rin derecho visible', darkRoundRight.score * 0.86, shrinkBox(darkRoundRight.tile, 0.62)))
  }

  if (glassSignal && glassSignal.score > 0.3) {
    components.push(component('Cristales', glassSignal.score, glassSignal.tile))
  }

  if (brightLeft && brightLeft.score > 0.08) {
    components.push(component('Faro izquierdo', brightLeft.score, brightLeft.tile))
  }

  if (brightRight && brightRight.score > 0.08) {
    components.push(component('Faro derecho', brightRight.score, brightRight.tile))
  }

  if (bodySignal > 0.18) {
    components.push({
      name: 'Cofre',
      confidence: clamp(0.34 + bodySignal * 0.9),
      boundingBox: normalizeBox({ x: imageWidth * 0.25, y: imageHeight * 0.18, width: imageWidth * 0.5, height: imageHeight * 0.25 }, imageWidth, imageHeight)
    })
    components.push({
      name: 'Puertas',
      confidence: clamp(0.32 + bodySignal * 0.75),
      boundingBox: normalizeBox({ x: imageWidth * 0.18, y: imageHeight * 0.38, width: imageWidth * 0.64, height: imageHeight * 0.28 }, imageWidth, imageHeight)
    })
  }

  if (interiorDarkShape && interiorDarkShape.score > 0.33) {
    components.push(component('Volante o tablero visible', interiorDarkShape.score * 0.78, interiorDarkShape.tile))
  }

  return dedupeComponents(components)
}

function detectDamage(tiles: TileStats[]): AnalyzerFinding[] {
  const findings: AnalyzerFinding[] = []

  for (const tile of tiles) {
    if (tile.rustRatio > 0.08) {
      const confidence = clamp(0.42 + tile.rustRatio * 2.2 + tile.edgeDensity * 0.3)
      findings.push(damageFinding('Oxido', 'Patron de color cafe/naranja compatible con oxido visible.', confidence, tile, 'Pintura'))
    }

    if (tile.rustRatio > 0.14 && tile.edgeDensity > 0.08) {
      const confidence = clamp(0.4 + tile.rustRatio * 1.9 + tile.edgeDensity * 0.45)
      findings.push(damageFinding('Corrosion', 'Textura irregular y coloracion compatible con corrosion.', confidence, tile, 'Pintura'))
    }

    if (tile.edgeDensity > 0.2 && tile.brightRatio < 0.18 && tile.rustRatio < 0.12) {
      const confidence = clamp(0.35 + tile.edgeDensity * 1.65)
      findings.push(damageFinding('Rayones o grietas', 'Alta densidad de bordes finos detectada en la zona.', confidence, tile, 'Pintura'))
    }

    if (tile.darkRatio > 0.42 && tile.edgeDensity > 0.12) {
      const confidence = clamp(0.34 + tile.darkRatio * 0.55 + tile.edgeDensity * 0.85)
      findings.push(damageFinding('Roturas o desgaste', 'Zona oscura con bordes fuertes compatible con desgaste o rotura.', confidence, tile, 'Interior'))
    }

    if (tile.highSaturationRatio < 0.04 && tile.averageBrightness > 165 && tile.edgeDensity < 0.08) {
      const confidence = clamp(0.28 + (tile.averageBrightness - 165) / 220)
      findings.push(damageFinding('Decoloracion', 'Zona clara y baja saturacion compatible con decoloracion.', confidence, tile, 'Detallado'))
    }
  }

  return mergeNearbyFindings(findings)
}

function detectMissingParts(components: ComponentSignal[], imageWidth: number, imageHeight: number): AnalyzerFinding[] {
  const names = new Set(components.map((item) => item.name))
  const findings: AnalyzerFinding[] = []

  if (names.has('Faro izquierdo') && !names.has('Faro derecho')) {
    findings.push(missingFinding('Faro derecho posiblemente faltante', imageWidth, imageHeight, 'electrical'))
  }

  if (names.has('Faro derecho') && !names.has('Faro izquierdo')) {
    findings.push(missingFinding('Faro izquierdo posiblemente faltante', imageWidth, imageHeight, 'electrical'))
  }

  if (names.has('Llanta izquierda visible') && !names.has('Llanta derecha visible')) {
    findings.push(missingFinding('Llanta derecha posiblemente faltante', imageWidth, imageHeight, 'mechanical'))
  }

  if (names.has('Llanta derecha visible') && !names.has('Llanta izquierda visible')) {
    findings.push(missingFinding('Llanta izquierda posiblemente faltante', imageWidth, imageHeight, 'mechanical'))
  }

  return findings
}

function detectPossibleModifications(tiles: TileStats[], imageWidth: number, imageHeight: number): AnalyzerFinding[] {
  const strongColorTile = strongest(tiles, (tile) => tile.highSaturationRatio * 0.8 + tile.edgeDensity * 0.15)

  if (!strongColorTile || strongColorTile.score < 0.32) {
    return []
  }

  return [
    {
      findingType: 'possible_modification',
      workCategory: 'exterior',
      name: 'Posible modificacion visible',
      description: 'Zona con color/accesorio de alta saturacion; requiere revision humana antes de marcar como no OEM.',
      confidence: clamp(strongColorTile.score),
      boundingBox: normalizeBox(strongColorTile.tile, imageWidth, imageHeight),
      suggestedAction: 'Revisar',
      checklistTitle: 'Revisar posible modificacion visible',
      metadata: { analyzer: 'local-vision-v1', signal: 'high_saturation_accessory_candidate' }
    }
  ]
}

function damageFinding(
  name: string,
  description: string,
  confidence: number,
  tile: TileStats,
  category: 'Pintura' | 'Interior' | 'Detallado'
): AnalyzerFinding {
  const workCategory = category === 'Interior' ? 'interior' : category === 'Pintura' ? 'paint' : 'detailing'
  const action = name.includes('Oxido') || name.includes('Corrosion') ? 'Reparar' : name.includes('Decoloracion') ? 'Detallar' : 'Reparar'

  return {
    findingType: 'damage',
    workCategory,
    name,
    description,
    confidence,
    boundingBox: normalizeBox(tile, tile.imageWidth, tile.imageHeight),
    suggestedAction: action,
    checklistTitle: `${action}: ${name}`,
    metadata: { analyzer: 'local-vision-v1' }
  }
}

function missingFinding(name: string, imageWidth: number, imageHeight: number, workCategory: ChecklistSection): AnalyzerFinding {
  return {
    findingType: 'missing_part',
    workCategory,
    name,
    description: 'Asimetria visual: se detecto el componente opuesto, pero no este componente esperado.',
    confidence: 0.54,
    boundingBox: normalizeBox(
      { x: imageWidth * 0.3, y: imageHeight * 0.25, width: imageWidth * 0.4, height: imageHeight * 0.35 },
      imageWidth,
      imageHeight
    ),
    suggestedAction: 'Comprar e instalar',
    checklistTitle: `Comprar e instalar: ${name}`,
    metadata: { analyzer: 'local-vision-v1', signal: 'symmetry_absence' }
  }
}

function component(name: string, confidence: number, tile: TileStats | BoundingBox): ComponentSignal {
  return {
    name,
    confidence: clamp(confidence),
    boundingBox: 'rustRatio' in tile ? normalizeBox(tile, tile.imageWidth, tile.imageHeight) : tile
  }
}

function inferComponentCategory(name: string): ChecklistSection {
  const interiorSignals = ['Volante', 'tablero', 'Asientos', 'Radio', 'Consola', 'Tapiceria']

  if (interiorSignals.some((signal) => name.toLowerCase().includes(signal.toLowerCase()))) {
    return name.toLowerCase().includes('radio') ? 'sound' : 'interior'
  }

  if (name.toLowerCase().includes('faro')) {
    return 'electrical'
  }

  if (name.toLowerCase().includes('llanta') || name.toLowerCase().includes('rin')) {
    return 'mechanical'
  }

  return 'exterior'
}

function mergeNearbyFindings(findings: AnalyzerFinding[]): AnalyzerFinding[] {
  const bestByNameAndZone = new Map<string, AnalyzerFinding>()

  for (const finding of findings) {
    const box = finding.boundingBox
    const zone = box ? `${finding.name}-${Math.round(box.x * 4)}-${Math.round(box.y * 4)}` : finding.name
    const existing = bestByNameAndZone.get(zone)

    if (!existing || existing.confidence < finding.confidence) {
      bestByNameAndZone.set(zone, finding)
    }
  }

  return Array.from(bestByNameAndZone.values())
}

function dedupeComponents(components: ComponentSignal[]): ComponentSignal[] {
  const byName = new Map<string, ComponentSignal>()

  for (const componentSignal of components) {
    const existing = byName.get(componentSignal.name)

    if (!existing || existing.confidence < componentSignal.confidence) {
      byName.set(componentSignal.name, componentSignal)
    }
  }

  return Array.from(byName.values())
}

function strongest(
  tiles: TileStats[],
  score: (tile: TileStats) => number
): { tile: TileStats; score: number } | null {
  let selected: { tile: TileStats; score: number } | null = null

  for (const tile of tiles) {
    const current = score(tile)

    if (!selected || current > selected.score) {
      selected = { tile, score: current }
    }
  }

  return selected
}

function readPixel(buffer: Buffer, width: number, x: number, y: number): { r: number; g: number; b: number } {
  const index = (y * width + x) * 4
  const b = buffer[index] ?? 0
  const g = buffer[index + 1] ?? 0
  const r = buffer[index + 2] ?? 0
  return { r, g, b }
}

function saturationOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  if (max === 0) {
    return 0
  }

  return (max - min) / max
}

function isRustColored(r: number, g: number, b: number): boolean {
  return r > 82 && g > 34 && g < 150 && b < 118 && r > g * 1.12 && g > b * 0.82
}

function normalizeBox(box: { x: number; y: number; width: number; height: number }, imageWidth: number, imageHeight: number): BoundingBox {
  return {
    x: clamp(box.x / imageWidth),
    y: clamp(box.y / imageHeight),
    width: clamp(box.width / imageWidth),
    height: clamp(box.height / imageHeight)
  }
}

function shrinkBox(box: TileStats, factor: number): BoundingBox {
  const insetX = box.width * (1 - factor) * 0.5
  const insetY = box.height * (1 - factor) * 0.5
  return {
    x: (box.x + insetX) / box.imageWidth,
    y: (box.y + insetY) / box.imageHeight,
    width: (box.width * factor) / box.imageWidth,
    height: (box.height * factor) / box.imageHeight
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function minimumConfidence(type: InspectionFindingType): number {
  if (type === 'component') return 0.34
  if (type === 'possible_modification') return 0.4
  if (type === 'missing_part') return 0.5
  return 0.45
}
