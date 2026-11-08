import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initAtlas } from './model/startup.js'
import { runLegacyCleanup } from './model/LegacyCleanup.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---- 配置初始化 ----
const configDir = path.join(__dirname, 'config')
const configFile = path.join(configDir, 'config.yaml')
const exampleFile = path.join(configDir, 'config.yaml.example')
const blacklistFile = path.join(configDir, 'blacklist.yaml')
const blacklistExample = path.join(configDir, 'blacklist.yaml.example')

if (!fs.existsSync(configFile) && fs.existsSync(exampleFile)) {
  fs.copyFileSync(exampleFile, configFile)
  logger?.info('[Atlas] 已从 config.yaml.example 创建配置文件')
}

if (!fs.existsSync(blacklistFile) && fs.existsSync(blacklistExample)) {
  fs.copyFileSync(blacklistExample, blacklistFile)
  logger?.info('[Atlas] 已从 blacklist.yaml.example 创建黑名单配置文件')
}

logger?.info('----Atlas-Plugin----')
logger?.info('[Atlas] 初始化中...')

// ---- 历史遗留清理 + 子模块同步 + 预加载索引 ----
// 清理必须**先跑完**再同步：两者都会写 .git/config，并发会撞 git 的 config.lock。
// 清理是本地文件操作（几十~几百 ms），同步可能拉到 120 s（框架 plugin_load_timeout 只有 60 s），
// 所以这里串行但不阻塞 index.js 主流程 —— 同步仍然不被 await 拖住。
runLegacyCleanup()
  .catch((err) => logger?.warn(`[Atlas] 历史遗留清理异常: ${err?.message || err}`))
  .then(() => initAtlas())
  .catch((err) => logger?.error('[Atlas] 启动编排异常:', err))

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
