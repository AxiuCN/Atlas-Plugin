/**
 * 黑名单检查 — 独立配置文件 config/blacklist.yaml
 *
 * 命中正则时图鉴两个入口（快捷入口 + 常规查询）均跳过处理：
 * 不回复、不拦截（返回 false 继续传递），消息交由其他插件处理。
 *
 * 热更新策略：以配置文件 mtime 为缓存键，文件变化即重新解析，
 * 无需 fs.watch，锅巴保存 / 手动编辑后下一条消息立即生效。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
export const blacklistFile = path.join(pluginRoot, 'config', 'blacklist.yaml')
export const blacklistExample = path.join(pluginRoot, 'config', 'blacklist.yaml.example')

/** 缓存：{ mtimeMs, raw: string[], regexps: RegExp[] } */
let cache = null

/**
 * 读取并解析黑名单（按 mtime 缓存，文件变化即重新解析）
 * @returns {{ raw: string[], regexps: RegExp[] }}
 */
export function readBlacklist () {
  const stat = fs.existsSync(blacklistFile)
    ? fs.statSync(blacklistFile)
    : null
  const mtime = stat?.mtimeMs ?? 0

  if (cache && cache.mtimeMs === mtime) return cache

  let raw = []
  try {
    const parsed = YAML.parse(fs.readFileSync(blacklistFile, 'utf8')) || {}
    raw = Array.isArray(parsed.patterns) ? parsed.patterns : []
  } catch (err) {
    logger?.warn(`[Atlas] 黑名单解析失败（按空名单处理）: ${err.message}`)
    raw = []
  }

  raw = raw
    .filter(p => typeof p === 'string' && p.trim())
    .map(p => p.trim())

  const regexps = raw
    .map(p => {
      try {
        return new RegExp(p)
      } catch (err) {
        logger?.warn(`[Atlas] 黑名单正则非法，已跳过: ${p} (${err.message})`)
        return null
      }
    })
    .filter(Boolean)

  cache = { mtimeMs: mtime, raw, regexps }
  return cache
}

/**
 * 获取黑名单正则原文列表（锅巴 getConfigData 用）
 * @returns {string[]}
 */
export function loadBlacklistPatterns () {
  return readBlacklist().raw
}

/**
 * 检查消息是否命中黑名单
 * @param {string} msg - 完整消息文本（e.msg，含前缀）
 * @returns {boolean} true = 命中，应跳过图鉴处理
 */
export function isBlacklisted (msg) {
  if (!msg) return false
  return readBlacklist().regexps.some(re => re.test(msg))
}