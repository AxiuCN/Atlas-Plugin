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

/**
 * 判断消息是否由 /→# 转换而来（框架 cfg.bot['/→#'] 开启时 /xxx → #xxx）
 *
 * 框架在 dealEvent 阶段只改写拼接出的 e.msg（/胡桃 → #胡桃），
 * e.message 消息段原文保留 / 前缀，据此区分手打 # 与 / 转换两种来源。
 * 命中时图鉴查询入口跳过（返回 false 继续传递），管理指令（#图鉴初始化等）不受影响。
 * @param {object} e - Runtime 实例
 * @returns {boolean} true = 由 / 前缀转换而来，应跳过图鉴查询
 */
export function isSlashMsg (e) {
  const seg = e?.message?.find(i => i.type === 'text')
  return typeof seg?.text === 'string' && /^\s*\//.test(seg.text)
}