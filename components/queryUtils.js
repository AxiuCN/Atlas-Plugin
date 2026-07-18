/**
 * 图鉴数据构建工具（纯数据转换，不涉及业务编排）
 * 供 modules/atlasQuery.js 使用
 */
import { resolveRecordImage } from '../model/AtlasService.js'
import { stripLinks } from '../model/LinkResolver.js'
import {
  GAME_NAMES,
  PAGE_LABELS,
  CHALLENGE_PAGE_KEYS
} from './constants.js'
import { getSectionBuilder } from './sections/index.js'

/**
 * 字段名转中文标签
 * @param {string} key
 * @returns {string}
 */
export function fieldLabel (key) {
  const labels = {
    zh: '名称', en: '英文名', ja: '日文名', ko: '韩文名',
    desc: '描述', description: '描述', rank: '稀有度', rarity: '稀有度',
    stars: '星级', baseType: '类型', damageType: '属性',
    atk: '攻击力', def: '防御力', hp: '生命值',
    icon: '图标', id: 'ID', name: '名称', version: '版本'
  }
  return labels[key] || key
}

/**
 * 字段值格式化（清理 RUBY / LINK / HTML 标记）
 * @param {*} value
 * @returns {string}
 */
export function formatValue (value) {
  if (value == null) return ''
  let str = String(value)
  str = str.replace(/\\n/g, '\n')
  str = str.replace(/\{RUBY_B#[^}]*}/g, '')
  str = str.replace(/\{RUBY_E#}/g, '')
  str = stripLinks(str)
  str = str.replace(/<[^>]+>/g, '')
  return str.trim()
}

/**
 * 构建挑战类页面的结构化 sections
 * 从 detail 中提取 floor / room / buff 等层级数据
 * @param {string} pageKey
 * @param {object} detail - record.content.detail
 * @returns {Array<{title: string, fields: Array<{label: string, value: string}>}>}
 */
export function buildChallengeSections (pageKey, detail) {
  if (!detail || typeof detail !== 'object') return []

  const sections = []
  let floorData = null

  const floorKeys = ['floor', 'floors', 'nodes', 'rooms']
  for (const key of floorKeys) {
    if (detail[key] && typeof detail[key] === 'object' && !Array.isArray(detail[key])) {
      floorData = detail[key]
      break
    }
  }

  // 没有明确楼层 key，尝试找带数字子键的对象
  if (!floorData) {
    for (const [key, value] of Object.entries(detail)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const subKeys = Object.keys(value)
        const numericKeys = subKeys.filter(k => /^\d+$/.test(k))
        if (numericKeys.length > 0) {
          floorData = detail[key]
          break
        }
      }
    }
  }

  if (floorData) {
    const floorNums = Object.keys(floorData).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
    for (const floorNum of floorNums) {
      const floor = floorData[floorNum]
      if (!floor || typeof floor !== 'object') continue
      const fields = []
      const floorTitle = `第${floorNum}层`

      // 地脉异常 / buff
      if (floor.buff) {
        const buffText = Array.isArray(floor.buff)
          ? floor.buff.map(b => (typeof b === 'object' ? (b.name || b.title || '') : String(b))).filter(Boolean).join('；')
          : String(floor.buff)
        if (buffText.trim()) fields.push({ label: '地脉异常', value: buffText })
      }

      // 记忆紊流（星铁特有）
      if (floor.turbulence) {
        const turbText = Array.isArray(floor.turbulence)
          ? floor.turbulence.map(t => (typeof t === 'object' ? (t.name || t.title || '') : String(t))).filter(Boolean).join('；')
          : String(floor.turbulence)
        if (turbText.trim()) fields.push({ label: '记忆紊流', value: turbText })
      }

      // 房间 / 节点
      if (floor.room && typeof floor.room === 'object') {
        const roomNums = Object.keys(floor.room).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
        for (const roomNum of roomNums) {
          const room = floor.room[roomNum]
          if (!room) continue
          let roomText = ''
          if (typeof room === 'object') {
            const parts = []
            if (room.name) parts.push(String(room.name))
            if (room.title) parts.push(String(room.title))
            const monsters = room.monsters || room.enemies || room.monster
            if (Array.isArray(monsters)) {
              for (const m of monsters) {
                if (typeof m === 'object' && m.name) parts.push(String(m.name))
                else if (typeof m === 'string') parts.push(m)
              }
            }
            roomText = parts.join(' — ')
          } else {
            roomText = String(room)
          }
          if (roomText.trim()) fields.push({ label: `第${roomNum}间`, value: roomText })
        }
      }

      // 其他非嵌套字段
      for (const [key, value] of Object.entries(floor)) {
        if (['buff', 'turbulence', 'room', 'name', 'title'].includes(key)) continue
        if (value == null || typeof value === 'object') continue
        fields.push({ label: fieldLabel(key), value: formatValue(value) })
      }

      if (fields.length > 0) sections.push({ title: floorTitle, fields })
    }
  }

  return sections
}

/**
 * 构建详情页模板数据
 * @param {string} gameId
 * @param {object} result - 含 record 字段的搜索结果项
 * @returns {object} 模板数据
 */
export function buildDetailData (gameId, result) {
  const record = result.record
  const meta = record?.meta || {}
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}
  const pageKey = result.pageKey

  // 类型专用 sections builder
  const builder = getSectionBuilder(pageKey)
  if (builder) {
    const typeData = builder(gameId, record, result.subView || null)
    if (typeData) {
      return {
        gameName: GAME_NAMES[gameId],
        pageTitle: result.pageTitle || (PAGE_LABELS[pageKey] || pageKey),
        name: typeData.recordName || meta.name || result.name,
        rarity: meta.rarity || result.rarity || '',
        image: resolveRecordImage(record),
        hero: typeData.hero || null,
        metaFields: typeData.metaFields || [],
        sections: typeData.sections || [],
        rawFields: [],
        gameId,
        pageKey
      }
    }
  }

  // 回退：从 list / detail 提取可展示字段
  const rawFields = []
  const seenKeys = new Set()

  const listPriority = ['zh', 'en', 'ja', 'ko', 'desc', 'description', 'rank', 'rarity', 'stars', 'baseType', 'damageType']
  for (const key of listPriority) {
    if (list[key] != null && !seenKeys.has(key)) {
      seenKeys.add(key)
      rawFields.push({ label: fieldLabel(key), value: formatValue(list[key]) })
    }
  }

  for (const [key, value] of Object.entries(list)) {
    if (seenKeys.has(key) || key.startsWith('_')) continue
    seenKeys.add(key)
    if (value != null && typeof value !== 'object') {
      rawFields.push({ label: fieldLabel(key), value: formatValue(value) })
    }
  }

  if (detail && typeof detail === 'object') {
    const detailKeys = Object.keys(detail).filter(k => !k.startsWith('_') && detail[k] != null && typeof detail[k] !== 'object')
    for (const key of detailKeys.slice(0, 20)) {
      if (seenKeys.has(key)) continue
      seenKeys.add(key)
      rawFields.push({ label: fieldLabel(key), value: formatValue(detail[key]) })
    }
  }

  const desc = formatValue(list.desc || list.description || '')

  const sections = CHALLENGE_PAGE_KEYS.has(pageKey)
    ? buildChallengeSections(pageKey, detail)
    : []

  return {
    gameName: GAME_NAMES[gameId],
    pageTitle: result.pageTitle || (PAGE_LABELS[pageKey] || pageKey),
    recordName: meta.name || result.name,
    rarity: meta.rarity || result.rarity || '',
    desc: desc.length > 200 ? '' : desc,
    image: resolveRecordImage(record),
    metaFields: [],
    sections: sections || [],
    rawFields: rawFields || [],
    gameId,
    pageKey
  }
}

/**
 * 构建列表页模板数据
 * @param {string} gameId
 * @param {object} result - 搜索结果
 * @returns {object} 模板数据
 */
export function buildListData (gameId, result) {
  const groupMap = new Map()
  for (const item of result.results) {
    const key = item.pageKey
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        title: item.pageTitle || (PAGE_LABELS[key] || key),
        items: []
      })
    }
    groupMap.get(key).items.push({ name: item.name, rarity: item.rarity })
  }

  const groups = [...groupMap.values()]

  return {
    gameName: result.gameName || GAME_NAMES[gameId],
    keyword: result.keyword,
    groups,
    results: result.results,
    total: result.total,
    metaFields: [],
    sections: []
  }
}

