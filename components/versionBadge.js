/**
 * Hero 右上角的版本徽标
 *
 * 上游版本号规则（nanoka manifest 的 `latest`）：
 *   - 原神 / 星铁：`x.y` 是正式服；`x.y.N`（N ≥ 50）是**下一版本**的测试服，
 *     `x.y.50` = 下一版本 v1、`.51` = v2、`.52` = v3……；大版本最后一个小的
 *     `.N` 再 +1 就进新大版本（原神 `x.8.50` → `(x+1).0 v1`）。
 *     历史例外：原神 1.x 最后是 1.6、星铁 6.x 最后是 6.7，这两个不再套 x.8 规则。
 *   - 绝区零：`x.y.N+build` 的 N 就是测试服序号（`3.4.5+...` = 3.4 v5 测试服），
 *     `+` 后面的构建号原样带出、不参与计算；没有 N 就是正式服。
 */
import { getHesperidesUpstreamManifest } from '../model/Hesperides.js'

const GAMES = {
  gi: { name: '原神', code: 'GI', spaced: false },
  hsr: { name: '崩坏·星穹铁道', code: 'HSR', spaced: true },
  zzz: { name: '绝区零', code: 'ZZZ', spaced: false }
}

/** 大版本的最后一个小版本号（默认 8，历史例外见上） */
const LAST_MINOR = {
  gi: (major) => (Number(major) === 1 ? 6 : 8),
  hsr: (major) => (Number(major) === 6 ? 7 : 8)
}

/**
 * 解析一个上游版本号 → Hero 徽标文案
 * @param {string} gameId - gi/hsr/zzz
 * @param {string} raw - 上游 `latest` 版本号
 * @returns {{label: string, short: string}|null}
 */
export function parseVersionBadge (gameId, raw) {
  const meta = GAMES[gameId]
  const text = String(raw || '').trim()
  if (!meta || !text) return null
  const gap = meta.spaced ? ' ' : ''

  if (gameId === 'zzz') {
    const matched = text.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:\+(.+))?$/)
    if (!matched) return null
    const [, major, minor, patch, build] = matched
    if (patch) {
      return {
        label: `${meta.name}${gap}${major}.${minor} v${Number(patch)}测试服`,
        short: `${meta.code} ${major}.${minor}.${patch}${build ? `+${build}` : ''}`
      }
    }
    return { label: `${meta.name}${gap}${major}.${minor} 正式服`, short: `${meta.code} ${major}.${minor}` }
  }

  const matched = text.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/)
  if (!matched) return null
  const [, major, minor, patch] = matched
  const beta = patch !== undefined && Number(patch) >= 50
  if (!beta) {
    return { label: `${meta.name}${gap}${major}.${minor} 正式服`, short: `${meta.code} ${major}.${minor}` }
  }

  const step = Number(patch) - 49
  const lastMinor = LAST_MINOR[gameId](major)
  const next = Number(minor) >= lastMinor ? `${Number(major) + 1}.0` : `${major}.${Number(minor) + 1}`
  return {
    label: `${meta.name}${gap}${next} v${step}测试服`,
    short: `${meta.code} ${major}.${minor}.${patch}`
  }
}

/** 当前三个游戏的版本徽标（读上游 manifest 快照；没数据就返回 null） */
export function getVersionBadge (gameId) {
  try {
    const versions = getHesperidesUpstreamManifest()
    const raw = versions?.games?.[gameId]?.latest
    return parseVersionBadge(gameId, raw)
  } catch {
    return null
  }
}