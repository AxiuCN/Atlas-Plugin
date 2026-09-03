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
  'refinement': '精炼',
  'quotes': '语音',
  'stories': '故事'
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
    groups.get(entity).push(buildItem(gameId, item))
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
 * @param {string} gameId
 * @param {object} item - diff.items[] 元素
 * @returns {object}
 */
function buildItem (gameId, item) {
  const textChanges = []
  const iconChanges = []
  // 序号展开字段（stats.N.attr / quote.N.text / skill.{id}.{lv}.row / trace.N.*）按「section + 子实体」聚合
  const seqGroups = new Map() // key: "section|entity" → { section, entity, count }
  const pending = []

  for (const c of item.changes || []) {
    if (c.contextOnly) continue
    // 图标类变更：仅当图标名实质变化时展示前后对比
    if (c.labelKey === 'image' || c.labelKey === 'icon' || c.valueKind === 'image') {
      if (c.before && c.after && String(c.before).trim() !== String(c.after).trim()) {
        iconChanges.push({
          key: c.key,
          section: SECTION_LABELS[c.section] || c.section || '',
          label: labelKeyLabel(c.labelKey),
          context: c.context || '',
          beforeIconUrl: iconUrl(gameId, c.before),
          afterIconUrl: iconUrl(gameId, c.after)
        })
      }
      continue
    }
    // 序号展开字段：按 key 中的「section.N.」识别，合并同一子实体（技能/等级组）的逐条展开
    const group = seqGroupOf(c)
    if (group) {
      const key = `${group.section}|${group.entity}`
      if (!seqGroups.has(key)) {
        seqGroups.set(key, { section: group.section, entity: seqEntityLabel(c, group), count: 0 })
      }
      seqGroups.get(key).count++
      continue
    }
    pending.push(c)
  }

  // 聚合条目 → 按子实体合并为单条变更
  for (const { section, entity, count } of seqGroups.values()) {
    textChanges.push({
      key: `${section}.N.*`,
      section: SECTION_LABELS[section] || section,
      label: '更新',
      context: entity || '',
      parts: [
        { type: 'same', text: `更新了 ${count} 处${sectionLabelHint(section)}`, color: '' }
      ],
      seqCount: count
    })
  }

  // 普通文本变更：富文本 diff
  for (const c of pending) {
    const before = parseRichText(c.before ?? '')
    const after = parseRichText(c.after ?? '')
    const parts = diffText(before, after)
      .map(p => ({ ...p, color: mapHlColor(p.color) }))
    if (parts.some(p => p.type === 'del' || p.type === 'add')) {
      textChanges.push({
        key: c.key,
        section: SECTION_LABELS[c.section] || c.section || '',
        label: labelKeyLabel(c.labelKey),
        context: c.context || '',
        parts
      })
    }
  }

  return {
    id: item.id,
    status: item.status === 'added' ? 'added' : 'changed',
    name: item.afterName || item.name || item.beforeName || '',
    icon: iconUrl(gameId, item.icon),
    rarity: item.rarity ?? '',
    changes: textChanges,
    iconChanges
  }
}

/**
 * 序号展开字段的聚合分组
 *
 * 命中的 key 形态（全部含两级数字段）：
 *   skill.{id}.{lv}.{field}      → section=skills, entity=技能id（同技能跨等级折叠）
 *   stats.{lv}.{attr} / quote.{N}.{field} / stories / traces / recommend.{N}.{field}
 * @param {object} c - change
 * @returns {{section:string, entity:string}|null}
 */
function seqGroupOf (c) {
  const sec = c.section
  if (!/^(skills|stats|quotes|stories|traces|recommend)/.test(sec)) return null
  // 需要「两级数字段」才算等级展开（skill.{id}.{lv}.field / stats.{lv}.attr）
  const m = c.key.match(/^([a-z_]+)\.([a-zA-Z0-9]+)\.[^.]+(\..*)?$/)
  if (!m) return null
  const id = m[2]
  // skills 按技能 id 分组；其余按 section 整体分组
  if (sec === 'skills') return { section: sec, entity: id }
  return { section: sec, entity: '' }
}

/** 聚合 section 的类型提示 */
function sectionLabelHint (section) {
  return {
    quotes: '（语音内容）',
    stories: '（故事内容）',
    stats: '（属性数值）',
    traces: '（行迹内容）'
  }[section] || ''
}

/**
 * 聚合子实体的展示名：从 change 的 context 提取（如「巡风剑舞 · Lv.1」→「巡风剑舞」）
 * @param {object} c - change
 * @param {{section:string, entity:string}} group
 * @returns {string}
 */
function seqEntityLabel (c, group) {
  const ctx = String(c.context || '').trim()
  if (!ctx) return group.section === 'skills' ? `技能 ${group.entity}` : ''
  // 提取「 · Lv.N」前缀作为技能名
  const name = ctx.replace(/\s*[·・]\s*Lv\.?\s*[\d]+.*$/i, '').trim()
  return name || ctx
}

/**
 * 图标名 → static 资源 URL
 * 复用后端资产约定：https://static.nanoka.cc/assets/{game}/[路径/]{名}.webp
 * batch（zzz 等）可能带已有扩展名，则原样保留。
 * @param {string} gameId
 * @param {string} icon - 图标名（如 UI_Gacha_AvatarImg_Vodyanitsa / avatarshopicon/1503.webp）
 * @returns {string}
 */
function iconUrl (gameId, icon) {
  const raw = String(icon ?? '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\?.*$/, '')
  const file = normalized.includes('.') ? normalized : `${normalized}.webp`
  return `https://static.nanoka.cc/assets/${gameId}/${file}`
}

/**
 * 富文本解析：剥离 HTML 标签为纯文本，同时记录高亮字符的原始颜色
 *
 * 高亮块 = <span style="...color:..."> / <strong> 包裹的内容。
 * 输出字符级数组 [{ ch, color }]，color 为原始高亮色（十六进制，未映射），无高亮为 ''。
 * @param {string} html
 * @returns {Array<{ ch: string, color: string }>}
 */
function parseRichText (html) {
  const src = String(html ?? '')
  const chars = []
  let colors = [] // 高亮色栈（<span> 嵌套）
  let i = 0
  while (i < src.length) {
    if (src[i] === '<') {
      const end = src.indexOf('>', i)
      if (end === -1) break
      const tag = src.slice(i + 1, end).trim().toLowerCase()
      if (tag === 'br' || tag === 'br/') {
        chars.push({ ch: '\n', color: currentColor(colors) })
      } else if (/^span(\s|$)/.test(tag)) {
        const color = extractColor(tag)
        colors.push(color || (colors.length ? colors[colors.length - 1] : ''))
      } else if (tag === 'strong' || tag === 'b' || tag === 'b/') {
        colors.push(currentColor(colors) || defaultHlColor)
      } else if (tag.startsWith('/') && (tag.slice(1) === 'span' || tag.slice(1) === 'strong' || tag.slice(1) === 'b')) {
        if (colors.length) colors.pop()
      }
      i = end + 1
    } else if (src[i] === '&') {
      const semi = src.indexOf(';', i)
      if (semi !== -1 && semi - i <= 8) {
        const ent = src.slice(i, semi + 1)
        const map = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&amp;': '&' }
        const ch = map[ent] ?? ent
        const color = currentColor(colors)
        if (ch.length === 1 || ch === '\n') chars.push({ ch, color })
        else for (const c of ch) chars.push({ ch: c, color })
        i = semi + 1
      } else {
        chars.push({ ch: '&', color: currentColor(colors) })
        i++
      }
    } else {
      chars.push({ ch: src[i], color: currentColor(colors) })
      i++
    }
  }
  return chars
}

/** 当前高亮色（栈顶，无则空） */
function currentColor (colors) {
  return colors.length ? colors[colors.length - 1] : ''
}

/** <strong>/<b> 无显式颜色时的高亮色（与图鉴惯例一致：亮金） */
const defaultHlColor = '#FFD780'

/**
 * 从 <span style="color:#RRGGBB..."> 提取原始颜色（十六进制，大写）
 * @param {string} tag - 小写的开标签文本
 * @returns {string|null}
 */
function extractColor (tag) {
  const m = tag.match(/color\s*:\s*#([0-9a-f]{6})/i)
  return m ? `#${m[1].toUpperCase()}` : null
}

/**
 * 高亮色映射：亮色 → 深色（与 detail.css 的 [style*="#FFD780"] 等规则一一对应）
 * 浅底页面将游戏原生亮色转深以保证可读性
 * @param {string} color - '#RRGGBB' 大写
 * @returns {string}
 */
function mapHlColor (color) {
  if (!color) return ''
  const map = {
    '#FFD780': '#8a6b2f', // 亮金 → 深金棕
    '#FFE699': '#967a35', // 淡金 → 中金
    '#80C0FF': '#1a6fb2', // 亮蓝 → 深蓝
    '#99FFFF': '#1f7a8d', // 青白 → 深青
    '#80FFD7': '#0f8a6f', // 青绿 → 深青绿
    '#99FF88': '#2e7d32', // 亮绿 → 深绿
    '#FFACFF': '#8e4fa3', // 淡紫 → 深紫
    '#FF9999': '#b7463c', // 粉红 → 深朱
    '#37FFFF': '#0e7c88', // 荧光青 → 深青蓝
    '#38FFFF': '#0e7c88'
  }
  return map[color] || color
}

/**
 * 字符级 LCS diff — 产出单段融合的变更序列（按字符切分，保留高亮颜色）
 * @param {Array<{ch:string,color:string}>} before - 旧富文本字符数组
 * @param {Array<{ch:string,color:string}>} after - 新富文本字符数组
 * @returns {Array<{ type: 'same'|'del'|'add', text: string, color: string }>}
 *   same 正常显示，del 删除段（赤红删除线），add 新增段（深绿），按旧文本顺序交错排列
 */
function diffText (before, after) {
  const a = Array.isArray(before) ? before : [...String(before ?? '')].map(ch => ({ ch, color: '' }))
  const b = Array.isArray(after) ? after : [...String(after ?? '')].map(ch => ({ ch, color: '' }))
  const m = a.length
  const n = b.length

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i].ch === b[j].ch ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i].ch === b[j].ch) {
      ops.push({ type: 'same', ch: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', ch: a[i] })
      i++
    } else {
      ops.push({ type: 'add', ch: b[j] })
      j++
    }
  }
  while (i < m) {
    ops.push({ type: 'del', ch: a[i] })
    i++
  }
  while (j < n) {
    ops.push({ type: 'add', ch: b[j] })
    j++
  }

  // 合并相邻同类且同高亮色的段
  const merged = []
  for (const op of ops) {
    const last = merged[merged.length - 1]
    if (last && last.type === op.type && last.color === op.ch.color) {
      last.text += op.ch.ch
    } else {
      merged.push({ type: op.type, text: op.ch.ch, color: op.ch.color })
    }
  }

  // 噪音净化：纯空白的 del/add 段降级为 same（无意义的空白不标色）
  return merged
    .filter(op => op.type !== 'del' && op.type !== 'add' || !/^\s*$/.test(op.text))
    .map(op => (/^\s*$/.test(op.text) && (op.type === 'del' || op.type === 'add'))
      ? { type: 'same', text: op.text, color: op.color }
      : op)
}

/** 游戏 id → 中文名（与 queryUtils 保持一致） */
function gameNameOf (gameId) {
  return {
    gi: '原神',
    hsr: '星穹铁道',
    zzz: '绝区零'
  }[gameId] || gameId
}