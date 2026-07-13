import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reloadIndex } from './model/AtlasService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---- 配置初始化 ----
const configDir = path.join(__dirname, 'config')
const configFile = path.join(configDir, 'config.yaml')
const exampleFile = path.join(configDir, 'config.yaml.example')

if (!fs.existsSync(configFile) && fs.existsSync(exampleFile)) {
  fs.copyFileSync(exampleFile, configFile)
  logger?.info('[Atlas] 已从 config.yaml.example 创建配置文件')
}

logger?.info('----Atlas-Plugin----')
logger?.info('[Atlas] 初始化中...')

// ---- 预加载索引 ----
try {
  reloadIndex()
} catch (err) {
  logger?.warn(`[Atlas] 索引加载失败: ${err.message}`)
  logger?.warn('[Atlas] 请确保已执行 nanoka-atlas-backend 数据抓取')
}

// ---- 加载 apps ----
const appsDir = path.join(__dirname, 'apps')
const files = fs.readdirSync(appsDir).filter(f => f.endsWith('.js'))

const ret = await Promise.allSettled(
  files.map(f => import(`./apps/${f}`))
)

let apps = {}
for (let i = 0; i < files.length; i++) {
  const name = files[i].replace('.js', '')
  if (ret[i].status === 'fulfilled') {
    apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
    logger?.info(`[Atlas] 载入: ${name}`)
  } else {
    logger?.error(`[Atlas] 载入失败: ${logger?.red?.(name) || name}`)
    logger?.error(ret[i].reason)
  }
}

logger?.info('[Atlas] 载入完成')
logger?.info('----Atlas-Plugin----')

export { apps }
