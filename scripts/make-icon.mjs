// Builds the app icons from Assets/MeowTrace Logo.svg (the logo is placed on a
// rounded tile in the artwork's red so it stays visible on dark taskbars).
// Runs before dev/build, so the generated binaries are not committed.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const source = resolve('Assets/MeowTrace Logo.svg')
const SIZE = 1024
await mkdir(resolve('build'), { recursive: true })
await mkdir(resolve('resources'), { recursive: true })
await mkdir(resolve('src/renderer/src/assets'), { recursive: true })

const logo = await sharp(source, { density: 300 })
  .trim({ threshold: 10 })
  .resize(Math.round(SIZE * 0.8), Math.round(SIZE * 0.8), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()

const tile = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
     <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="#d9230f"/><stop offset="1" stop-color="#a51305"/></linearGradient></defs>
     <rect x="16" y="16" width="${SIZE - 32}" height="${SIZE - 32}" rx="${SIZE * 0.22}" fill="url(#g)"/>
   </svg>`
)
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect x="16" y="16" width="${SIZE - 32}" height="${SIZE - 32}" rx="${SIZE * 0.22}" fill="#fff"/></svg>`
)
const icon = await sharp(
  await sharp(tile)
    .composite([{ input: logo, gravity: 'south' }])
    .png()
    .toBuffer()
)
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer()
// Logo alone (transparent) for in-app branding.
const mark = await sharp(logo).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = []
for (const s of icoSizes) pngs.push(await sharp(icon).resize(s, s).png().toBuffer())
await writeFile(resolve('build/icon.ico'), await pngToIco(pngs))
await writeFile(resolve('build/icon.png'), await sharp(icon).resize(512, 512).png().toBuffer())
await writeFile(resolve('resources/icon.png'), await sharp(icon).resize(256, 256).png().toBuffer())
await writeFile(resolve('src/renderer/src/assets/icon.png'), await sharp(icon).resize(128, 128).png().toBuffer())
await writeFile(resolve('src/renderer/src/assets/mark.png'), mark)
console.log('icons: build/icon.ico, build/icon.png, resources/icon.png, src/renderer/src/assets/{icon,mark}.png')
