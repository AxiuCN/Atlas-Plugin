// 渲染缩放端到端回归（真实 renderAtlas + 框架渲染后端，Chromium 指向本机浏览器）
//   ① 全部模板语法可编译，且 body 上带 zoom 值（防模板改坏）
//   ② 用真实配置链路渲染同一页：renderScale=1 与 1.5 的输出图尺寸应成 1.5 倍
//   ③ 临时改写 config.yaml 后必须按原字节还原（校验哈希）
// 前置：图鉴数据 + 可用浏览器（Edge/Chromium；可用 ATLAS_TEST_BROWSER 指定）
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import template from 'art-template'
import {
  mod, pluginRoot, appRoot, tmpDir, ensureTmpDir, findBrowser, skip,
  requireAtlasData, installFrameworkStubs
} from './_helper.mjs'

installFrameworkStubs({ echoError: true })
requireAtlasData()

const browser = findBrowser()
if (!browser) skip('未找到可用浏览器（可设 ATLAS_TEST_BROWSER=<可执行文件路径>）')
ensureTmpDir()

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? `  ${extra}` : ''}`)
}

/** 读 JPEG 尺寸（SOF 段） */
function jpegSize (buf) {
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return { w: 0, h: 0 }
}

console.log('=== ① 全部模板语法可编译且 body 带 zoom ===')
const tplDir = path.join(pluginRoot, 'resources/atlas')
const files = fs.readdirSync(tplDir).filter(f => f.endsWith('.html'))
for (const f of files) {
  const src = fs.readFileSync(path.join(tplDir, f), 'utf8')
  let err = ''
  try {
    template.compile(src) // 只校验语法（不执行，避免依赖完整渲染数据）
  } catch (e) {
    err = e.message
  }
  const zoomOk = /<body[^>]*style="zoom:\{\{renderScale\}\}"/.test(src)
  check(`${f} 语法 + body zoom`, !err && zoomOk, err || (zoomOk ? '' : '未找到 body zoom'))
}

console.log('\n=== ② 真实渲染：1 与 1.5 的输出尺寸 ===')
// 让框架渲染后端用本机浏览器
const RendererLoader = (await import(pathToFileURL(path.join(appRoot, 'lib/renderer/loader.js')).href)).default
RendererLoader.getRenderer('puppeteer').config.executablePath = browser

const { renderAtlas } = await import(mod('components/render.js'))
const { search, loadRecord } = await import(mod('model/AtlasService.js'))
const { buildDetailData } = await import(mod('components/queryUtils.js'))

const configFile = path.join(pluginRoot, 'config/config.yaml')
const originalConfig = fs.readFileSync(configFile)
const originalHash = createHash('sha256').update(originalConfig).digest('hex')

const sizes = {}
try {
  const entry = search('gi', '胡桃').results.find(r => r.pageKey === 'character')
  for (const scale of [1, 1.5]) {
    const patched = originalConfig.toString('utf8').replace(/^renderScale:.*$/m, `renderScale: ${scale}`)
    fs.writeFileSync(configFile, patched)
    const data = buildDetailData('gi', { ...entry, record: loadRecord(entry.filePath) })
    const t0 = Date.now()
    const buf = await renderAtlas('character', data, { imgType: 'jpeg' })
    if (!buf) {
      console.log(`  renderScale=${scale}: 渲染返回空（见上方 [error]）`)
      sizes[scale] = { w: 0, h: 0, kb: '0', ms: Date.now() - t0 }
      continue
    }
    const size = jpegSize(Buffer.from(buf))
    fs.writeFileSync(path.join(tmpDir, `scale-${scale}.jpg`), Buffer.from(buf))
    sizes[scale] = { ...size, kb: (buf.length / 1024).toFixed(0), ms: Date.now() - t0 }
    console.log(`  renderScale=${scale}: ${size.w}×${size.h}｜${sizes[scale].kb} KB｜${sizes[scale].ms}ms`)
  }
} finally {
  fs.writeFileSync(configFile, originalConfig)
}
check('config.yaml 已按原字节还原',
  createHash('sha256').update(fs.readFileSync(configFile)).digest('hex') === originalHash)

const ratioW = sizes[1.5].w / (sizes[1].w || 1)
const ratioH = sizes[1.5].h / (sizes[1].h || 1)
check('宽度比 ≈ 1.5', Math.abs(ratioW - 1.5) < 0.02, `${sizes[1].w} → ${sizes[1.5].w}（×${ratioW.toFixed(3)}）`)
check('高度比 ≈ 1.5（整块内容取整，允许 3%）', Math.abs(ratioH - 1.5) < 0.03, `${sizes[1].h} → ${sizes[1.5].h}（×${ratioH.toFixed(3)}）`)
check('scale=1 尺寸与 base.css 一致（body 900px，border-box）', Math.abs(sizes[1].w - 900) <= 2, `${sizes[1].w}px`)
check('输出体积随缩放增加', Number(sizes[1.5].kb) > Number(sizes[1].kb), `${sizes[1].kb}KB → ${sizes[1.5].kb}KB`)

console.log(`\n样例图：${path.join(tmpDir, 'scale-1.jpg')} / ${path.join(tmpDir, 'scale-1.5.jpg')}`)
console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
