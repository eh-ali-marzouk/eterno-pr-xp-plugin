const PALETTE = ['#3fb950', '#58a6ff', '#a371f7', '#f1c40f', '#f778ba', '#79c0ff', '#db6d28']

function fnv1a(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function identiconSvgString(seed: string, size = 40): string {
  const h = fnv1a(seed || 'anon')
  const color = PALETTE[h % PALETTE.length]
  const bg = '#0d1117'
  const cells: string[] = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const bit = (h >> (y * 3 + x)) & 1
      if (bit) {
        cells.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`)
        cells.push(`<rect x="${4 - x}" y="${y}" width="1" height="1" fill="${color}"/>`)
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 5 5" style="shape-rendering:crispEdges;display:block"><rect width="5" height="5" fill="${bg}"/>${cells.join('')}</svg>`
}
