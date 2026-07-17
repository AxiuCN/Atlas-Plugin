/**
 * LINK 占位符解析器
 * 解析角色技能/命座描述中的 {LINK#N...}、{LINK#S...} 标记，
 * 替换为高亮 HTML，并收集效果详述用于模板渲染。
 *
 * 数据源：nanoka-atlas-backend/data/items/简体中文/原神/文本链接/
 * 仅原神(gi)有文本链接数据，星铁/绝区零无此数据。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const dataDir = path.join(pluginRoot, 'tool/nanoka-atlas-backend/nanoka-atlas-backend/data')

/** 游戏 ID → 数据目录中文名 */
const GAME_FOLDER = { gi: '原神', hsr: '星铁', zzz: '绝区零' }

/** @type {Map<string, Map<string, {name: string, desc: string, color: string}>>} gameId → recordId → entry */
const linkIndexCache = new Map()

/** {LINK#(N|S)ID}text{/LINK} 完整格式 */
const LINK_WRAPPED_RE = /\{LINK#([NS])(\d+)}([\s\S]*?)\{\/LINK}/g

/** {LINK#(N|S)ID} 裸格式（无闭合标签，无包裹文本） */
const LINK_BARE_RE = /\{LINK#([NS])(\d+)}/g

/* ============================================================
 *  索引加载
 * ============================================================ */

/**
 * 惰性加载文本链接索引
 * @param {string} gameId — 'gi' | 'hsr' | 'zzz'
 * @returns {Map<string, {name, desc, color}>}
 */
export function loadLinkIndex (gameId) {
  if (linkIndexCache.has(gameId)) return linkIndexCache.get(gameId)

  const folder = GAME_FOLDER[gameId]
  if (!folder) {
    linkIndexCache.set(gameId, new Map())
    return linkIndexCache.get(gameId)
  }

  const linkDir = path.join(dataDir, 'items', '简体中文', folder, '文本链接', '未分类')
  const index = new Map()

  if (!fs.existsSync(linkDir)) {
    linkIndexCache.set(gameId, index)
    return index
  }

  try {
    const files = fs.readdirSync(linkDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = fs.readFileSync(path.join(linkDir, file), 'utf8')
        const data = JSON.parse(raw)
        const list = data?.content?.list
        if (!list || !list.name) continue
        index.set(data.meta.recordId, {
          name: list.name,
          desc: list.desc || '',
          color: list.color || '',
          param: Array.isArray(list.param) ? list.param : []
        })
      } catch { /* skip malformed files */ }
    }
  } catch { /* dir read error — return empty index */ }

  linkIndexCache.set(gameId, index)
  return index
}

/* ============================================================
 *  解析引擎
 * ============================================================ */

/**
 * 解析文本中的 LINK 标记，返回高亮文本和收集的效果引用
 * @param {string} text — 原始文本
 * @param {string} gameId — 'gi' | 'hsr' | 'zzz'
 * @returns {{ resolved: string, refs: Array<{name: string, desc: string}> }}
 */
export function resolveLinks (text, gameId) {
  if (!text) return { resolved: '', refs: [] }

  const index = loadLinkIndex(gameId)
  const refs = []

  // Step 1: 处理 {LINK#X...}text{/LINK} 完整包裹格式
  let resolved = String(text).replace(LINK_WRAPPED_RE, (match, prefix, id, inner) => {
    if (prefix === 'N') {
      const entry = index.get(id)
      if (entry) {
        // 收集效果详述（解析描述中的 {N} 参数和颜色标签）
        const desc = resolveLinkDesc(entry)
        if (desc) {
          refs.push({ name: entry.name, desc })
        }
      }
    }
    // 保留 inner 内容（通常是 <color=...>text</color>），转换颜色标签
    return _resolveColorTags(inner)
  })

  // Step 2: 兜底处理裸 {LINK#N...} 格式（无闭合标签）
  resolved = resolved.replace(LINK_BARE_RE, (match, prefix, id) => {
    if (prefix === 'N') {
      const entry = index.get(id)
      if (entry) {
        const desc = resolveLinkDesc(entry)
        if (desc) {
          refs.push({ name: entry.name, desc })
        }
        return `<span class="link-ref">${_escapeHtml(entry.name)}</span>`
      }
    }
    return '' // 查不到的移除
  })

  return { resolved, refs }
}

/**
 * 解析文本链接的描述文本
 * - {0}/{1}/{2} 替换为 param 对应索引值
 * - <color=#RGB>text</color> 转为 <span style="color:#RGB">text</span>
 * - \n 转实际换行
 * @param {{name, desc, color, param}} entry
 * @returns {string}
 */
function resolveLinkDesc (entry) {
  if (!entry.desc) return ''

  let desc = entry.desc
    .replace(/\\n/g, '\n')

  // {0}/{1}/{2} 替换为 param 数组中对应值
  desc = desc.replace(/\{(\d+)}/g, (match, idx) => {
    const val = entry.param[Number(idx)]
    return val != null && val !== '' ? String(val) : match
  })

  // <color=#RGB>text</color> → <span style="color:#RGB">text</span>
  desc = _resolveColorTags(desc)

  return desc.trim()
}

/* ============================================================
 *  工具函数
 * ============================================================ */

/**
 * <color=#RRGGBB(AA)>text</color> → <span style="color:#RRGGBB(AA)">text</span>
 */
function _resolveColorTags (text) {
  return text.replace(/<color=([^>]+)>([\s\S]*?)<\/color>/g, (match, color, inner) => {
    return `<span style="color:${color}">${inner}</span>`
  })
}

/**
 * HTML 转义（用于裸 LINK 查出的名称）
 */
function _escapeHtml (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 清除 LINK 标记（纯文本场景兜底，用于 _formatValue 等不需高亮的路径）
 * @param {string} text
 * @returns {string}
 */
export function stripLinks (text) {
  if (!text) return ''
  return String(text)
    .replace(LINK_WRAPPED_RE, (m, prefix, id, inner) => _stripColorTags(inner))
    .replace(LINK_BARE_RE, '')
}

/** <color=#RGB>text</color> → text */
function _stripColorTags (text) {
  return text.replace(/<color=[^>]+>([\s\S]*?)<\/color>/g, '$1')
}

/**
 * 重载文本链接索引（数据更新后调用）
 */
export function reloadLinkIndex () {
  linkIndexCache.clear()
}
