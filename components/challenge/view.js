/**
 * 终局视图模型（challenge）公共工具
 *
 * 目标：把「各源各玩法各有各的结构」收敛成一套模板能渲染的形状。
 *
 * ```
 * view = {
 *   summary: [{ label, value }],
 *   groups: [
 *     { kind: 'list',     title, fields: [{ label, value }] },
 *     { kind: 'cards',    title, cards:  [{ title, sub, fields, icons }] },
 *     { kind: 'icons',    title, items:  [{ icon, name, sub }] },
 *     { kind: 'collapse', title, fields: [{ label, value }] }
 *   ]
 * }
 * ```
 *
 * 约定：
 *   - 只做「有的就上，没有就不造」，任何字段缺失都不补占位符、不猜名字；
 *   - 文本统一过 `plain()`（去标签、压空白），避免把上游 HTML 注记糊到画布上；
 *   - 图标按 `fieldPath` 从记录自带的 `imagerefs` 里取，取不到就不放 `<img>`。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { HESPERIDES_DIR } from '../../model/Hesperides.js'
import { getMonsterEntry } from '../../model/monsterIndex/index.js'

const TEXT_MAX = 140

/** 去标签 + 压空白 + 截断（保留可读性，不保留上游 HTML 注记） */
export function plain (value, max = TEXT_MAX) {
  if (value === null || value === undefined) return ''
  const text = String(value)
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/<[^>]+>/g, '')
    .replace(/\\[nr]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 数值 → 文本（保留一位小数，避免 0.7 显示成 0.70 之外的噪声） */
export function num (value, digits = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return String(Number(n.toFixed(digits)))
}

/**
 * 百分比文本：支持 0.7（比率）与 "30%"（已带百分号）两种上游写法
 * @param {*} value
 * @returns {string}
 */
export function percent (value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' && value.includes('%')) return value
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return `${num(n * 100)}%`
}

/**
 * 记录里某字段的本地图片（file:// URL）
 *
 * Hesperides 的 `imagerefs` 用 `fieldPath` 精确指向记录字段（`Monsters.51337.Icon`），
 * 这里按同样的键取引用，占位图跳过。
 * @param {object} record — 插件记录（`{ meta: { images } }`）
 * @param {string} fieldPath
 * @returns {string}
 */
export function fieldImage (record, fieldPath) {
  if (!fieldPath) return ''
  const images = record?.meta?.images
  if (!Array.isArray(images) || !images.length) return ''
  const hit = images.find((image) => image?.fieldPath === fieldPath && image?.localPath && !image?.placeholder)
  if (!hit) return ''
  const localPath = String(hit.localPath).replace(/\\/g, '/')
  return pathToFileURL(path.join(HESPERIDES_DIR, localPath)).href
}

/**
 * 怪物名/图标解析器
 *
 * 优先用记录内自带的 `Name` / `Icon`（玉璃的终局页把名字写在记录里），
 * 只有缺名字时才回落到怪物索引（zzz 的 `monster_list` 只有 id）。
 * @param {string} gameId
 * @param {object} record
 * @param {object} [local] - 该玩法记录里 id → 原始怪物对象的映射
 * @returns {(id:string|number) => { name: string, icon: string }}
 */
export function makeMonsterResolver (gameId, record, local = {}, container = 'Monsters') {
  return (id) => {
    const key = String(id)
    const raw = local?.[key]
    const fromIndex = getMonsterEntry(gameId, key)
    const name = plain(raw?.Name || raw?.name || fromIndex?.name || '') || key
    // 玉璃不同玩法的图标字段位置不同：深渊是 `Monsters.<id>.Icon`，剧诗直接是 `Monsters.<id>`
    const icon = fieldImage(record, `${container}.${key}.Icon`) ||
      fieldImage(record, `${container}.${key}`) ||
      fieldImage(record, `Monsters.${key}.Icon`) ||
      fieldImage(record, `Monsters.${key}`)
    return { name, icon }
  }
}

/** 两列清单段 */
export function listGroup (title, fields) {
  const rows = (fields || []).filter((field) => field?.label && field?.value !== '' && field?.value !== null && field?.value !== undefined)
  return rows.length ? { kind: 'list', title, fields: rows } : null
}

/** 图标网格段（复用 .material-grid 样式） */
export function iconGroup (title, items) {
  const rows = (items || []).filter((item) => item && (item.name || item.icon))
  return rows.length ? { kind: 'icons', title, items: rows } : null
}

/** 分块卡片段（楼层 / 关卡 / 强敌）；`cols: 2` 只给字段短的段用，长文本走单列 */
export function cardsGroup (title, cards, { cols = 1 } = {}) {
  const rows = (cards || []).filter((card) => card && (card.title || card.fields?.length || card.icons?.length))
  if (!rows.length) return null
  const group = { kind: 'cards', title, cards: rows }
  if (cols === 2) group.cols = 2
  return group
}

/** 折叠段（血量档位这类「有数据但不必抢眼」的信息） */
export function collapseGroup (title, fields) {
  const rows = (fields || []).filter((field) => field?.label && field?.value)
  return rows.length ? { kind: 'collapse', title, fields: rows } : null
}

export function pushGroup (groups, group) {
  if (group) groups.push(group)
  return groups
}

/** 旧通用 sections → 视图段（未知玩法/字段变化时兜底，不空白） */
export function groupsFromSections (sections) {
  return (sections || [])
    .map((section) => listGroup(section?.title || '详情', section?.fields || []))
    .filter(Boolean)
}