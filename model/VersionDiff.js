/**
 * VersionDiff — 版本更新记录数据层
 *
 * 读取后端 scrape-diff.mjs 落盘的 data/diffs/{gameId}.json，
 * 归一化为 update-log.html 模板数据。只读本地文件，不发起任何网络请求。
 *
 * diff 结构（后端原文）：
 *   { gameId, localVersion, version, fetchedAt, diff: {
 *       fromVersion, toVersion, generatedAt, counts, items: [{
 *         id, entity, status: 'added'|'changed', name, beforeName, afterName,
 *         icon, rarity, changes: [{ key, section, labelKey, context, html,
 *                                   before, after, status, contextOnly, valueKind }]
 *       }] } }
 */
import fs from 'node:fs'
import path from 'node:path'
import { BACKEND_DIR } from './AtlasUpdater.js'

/** entity → 中文分组名（diff 的 entity 字段） */
const ENTITY_LABELS = {
  character: '角色',
  weapon: '武器',
  lightcone: '光锥',
  artifact: '圣遗物',
  relic: '遗器',
  relicset: '遗器',
  equipment: '驱动盘',
  bangboo: '邦布'
}

/** 分组固定顺序（未列出的 entity 追加在末尾） */
const ENTITY_ORDER = ['character', 'weapon', 'lightcone', 'artifact', 'relic', 'relicset', 'equipment', 'bangboo']

/** diff 的 section → 中文（字段所属区块标签） */
const SECTION_LABELS = {
  profile: '基础',
  skills: '技能',
  passives: '天赋',
  constellations: '命座',
  'mindscape': '影画',
  'cinema': '影画',
  'ranks': '星魂',
  'traces': '行迹',
  'stats': '属性',
  'materials': '材料',
  'recommendations': '推荐',
  'equipment': '装备',
  'form': '形态',
  'refinement': '精炼'
}

/** diff 的 labelKey → 中文（字段名标签） */
const LABEL_LABELS = {
  name: '名称',
  description: '描述',
  icon: '图标',
  image: '图标',
  rarity: '稀有度',
  title: '称号',
  gender: '性别',
  birthday: '生日',
  element: '属性',
  weaponType: '武器类型',
  path: '命途',
  aggro: '嘲讽',
  spNeed: '能量',
  energy: '能量',
  statValue: '数值',
  statName: '属性名',
  unlockLevel: '解锁等级',
  unlockPromotion: '解锁突破',
  material: '材料',
  voice: '语音',
  recommendedLightcone: '推荐光锥',
  recommendedRelic: '推荐遗器',
  recommendedMainStat: '推荐主词条',
  recommendedSubStat: '推荐副词条'
}

/**
 * 字段名中文化：labelKey → 中文；未知时回退原文
 * @param {string} key
 * @returns {string}
 */
function labelKeyLabel (key) {
  if (!key) return ''
  const base = key.split('.').pop()
  return LABEL_LABELS[base] || LABEL_LABELS[key] || base
}

/**
 * 读取本地 diff 文件
 * @param {string} gameId - gi / hsr / zzz
 * @returns {object|null} 归一化模板数据，无文件/解析失败返回 null
 */
export function loadVersionDiff (gameId) {
  try {
    const filePath = path.join(BACKEND_DIR, 'data', 'diffs', `${gameId}.json`)
    if (!fs.existsSync(filePath)) return null
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return buildDiffData(gameId, record)
  } catch (err) {
    logger?.warn(`[Atlas][版本记录] 读取 diff 失败: ${err.message}`)
    return null
  }
}

/**
 * 归一化 diff 记录为模板数据
 * @param {string} gameId
 * @param {object} record - diffs/{gameId}.json 原文
 * @returns {object|null}
 */
export function buildDiffData (gameId, record) {
  const diff = record?.diff
  if (!diff || !Array.isArray(diff.items)) return null

  // 按 entity 分组，保持固定顺序
  const groups = new Map()
  for (const item of diff.items) {
    const entity = item.entity || 'other'
    if (!groups.has(entity)) groups.set(entity, [])
    groups.get(entity).push(buildItem(item))
  }

  const ordered = [...groups.entries()].sort((a, b) => {
    const ia = ENTITY_ORDER.indexOf(a[0])
    const ib = ENTITY_ORDER.indexOf(b[0])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  return {
    gameId,
    gameName: gameNameOf(gameId),
    fromVersion: diff.fromVersion || '?',
    toVersion: diff.toVersion || record.version || '?',
    generatedAt: formatTime(diff.generatedAt || record.fetchedAt),
    groups: ordered.map(([entity, items]) => ({
      entity,
      title: ENTITY_LABELS[entity] || entity,
      added: items.filter(i => i.status === 'added').length,
      changed: items.filter(i => i.status === 'changed').length,
      items
    })),
    total: diff.items.length
  }
}

/**
 * 时间格式化（ISO → YYYY-MM-DD HH:mm）
 * @param {string} iso
 * @returns {string}
 */
function formatTime (iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

/**
 * 归一化单个变更条目
 * @param {object} item - diff.items[] 元素
 * @returns {object}
 */
function buildItem (item) {
  const changes = (item.changes || [])
    // 跳过「仅上下文变化」与图标类变更（图标对比价值低且占版面）
    .filter(c => !c.contextOnly && c.labelKey !== 'image' && c.labelKey !== 'icon')
    .map(c => ({
      key: c.key,
      section: SECTION_LABELS[c.section] || c.section || '',
      label: labelKeyLabel(c.labelKey),
      context: c.context || ''
    }))

  return {
    id: item.id,
    status: item.status === 'added' ? 'added' : 'changed',
    name: item.afterName || item.name || item.beforeName || '',
    icon: item.icon || '',
    rarity: item.rarity ?? '',
    changes
  }
}

/** 游戏 id → 中文名（与 queryUtils 保持一致） */
function gameNameOf (gameId) {
  return {
    gi: '原神',
    hsr: '星穹铁道',
    zzz: '绝区零'
  }[gameId] || gameId
}