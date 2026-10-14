import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const configDir = path.join(pluginRoot, 'config')
const configFile = path.join(configDir, 'config.yaml')
const exampleFile = path.join(configDir, 'config.yaml.example')

/** 默认配置 */
const defaultConfig = {
  priority: 10000,
  renderScale: 1.5,
  autoUpdate: {
    enabled: true,
    cron: '0 0 5 * * *',
    retries: 1,
    retryDelayMs: 30000,
    fallbackToFull: true,
    timeoutMs: 2 * 60 * 60 * 1000
  },
  alias: {
    set: 'master',
    del: 'master',
    list: 'all'
  },
  notifyGroups: [],
  notifyMode: 'all'
}

/**
 * 深合并默认配置与运行时配置（autoUpdate 等嵌套对象逐字段兜底）
 * @param {object} base - 默认配置
 * @param {object|null} overlay - 运行时配置
 * @returns {object}
 */
function deepMerge (base, overlay) {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return { ...base }
  }
  const result = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)
      && base[key] !== null && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * 获取插件配置
 * config.yaml 不存在时从 .example 复制；.example 也不存在则返回默认值
 * @returns {object} 配置对象
 */
export function getPluginConfig () {
  if (fs.existsSync(configFile)) {
    try {
      return deepMerge(defaultConfig, YAML.parse(fs.readFileSync(configFile, 'utf8')))
    } catch (e) {
      logger?.warn('[Atlas] 配置文件解析失败，使用默认配置')
      return defaultConfig
    }
  }
  if (fs.existsSync(exampleFile)) {
    fs.copyFileSync(exampleFile, configFile)
    logger?.info('[Atlas] 已从 config.yaml.example 创建配置文件')
    try {
      return deepMerge(defaultConfig, YAML.parse(fs.readFileSync(configFile, 'utf8')))
    } catch (e) {
      return defaultConfig
    }
  }
  return defaultConfig
}

export { pluginRoot, configDir, configFile, exampleFile }
