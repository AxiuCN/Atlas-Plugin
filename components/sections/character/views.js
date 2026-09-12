/**
 * 角色子视图处理
 * 默认视图 / 天赋视图 / 命座视图 / 资料视图 / 故事视图 / 养成视图
 */
import { getSkillNames, getConstellationNames, getOutfits } from './names.js'
import { aggregateMats, buildMatItems } from '../materials.js'
import { imgUrl, formatFoodDesc, cleanForRender } from '../util.js'
import { getHsrItemName } from '../../../model/itemIndex/hsr.js'
import { getZZZItemName, getZZZItemIcon } from '../../../model/itemIndex/zzz.js'

/** 默认视图：隐藏技能参数等级表（保留固定属性小格），素材仅养成子视图展示 */
export function applyDefaultView (data) {
  // 隐藏技能参数等级表；有固定属性（冷却/能量/体力等）时保留小格展示
  const stripParams = (sk) =>
    sk.params?.fixed?.length
      ? { ...sk, params: { ...sk.params, rows: [] } }
      : { ...sk, params: null }

  const sections = data.sections
    .filter(s => s.type !== 'materials')
    .map(s => {
      if (s.type === 'skill-cards' && s.skills) {
        return { ...s, skills: s.skills.map(stripParams) }
      }
      if (s.type === 'skill-groups' && s.groups) {
        return {
          ...s,
          groups: s.groups.map(g => g.subgroups
            ? { ...g, subgroups: g.subgroups.map(sg => ({ ...sg, skills: (sg.skills || []).map(stripParams) })) }
            : g)
        }
      }
      return s
    })

  return { ...data, sections }
}

/** 天赋视图：仅技能（含忆灵技能组）+ 被动 + 相关效果（完整参数） */
export function applySkillsView (data) {
  const sections = data.sections.filter(s =>
    s.type === 'skill-cards' || s.type === 'skill-groups' || s.type === 'list'
  )
  return { ...data, sections }
}

/**
 * 倍率视图：仅技能卡与忆灵技能组，参数表切换为全等级转置（paramsAll）
 * 用于 #xxx倍率 等命令，渲染宽表模板；
 * 全等级列过多时按每组等级列拆分出多张续表，宽度受限于容器
 * @param {object} data - 角色模板数据
 * @param {number} [perTable] - 每张续表包含的等级列数上限
 */
export function applyRatesView (data, perTable = 5) {
  const toRates = (sk) => {
    const params = sk.paramsAll && sk.paramsAll.rows?.length ? sk.paramsAll : sk.params
    if (!params || !params.rows?.length) return { ...sk, params }
    return { ...sk, params: { ...params, tables: splitRateTables(params, perTable) } }
  }

  const sections = data.sections
    .filter(s => s.type === 'skill-cards' || s.type === 'skill-groups')
    .map(s => {
      if (s.type === 'skill-groups' && s.groups) {
        return {
          ...s,
          groups: s.groups.map(g => g.subgroups
            ? { ...g, subgroups: g.subgroups.map(sg => ({ ...sg, skills: (sg.skills || []).map(toRates) })) }
            : g)
        }
      }
      return { ...s, skills: (s.skills || []).map(toRates) }
    })
  return { ...data, sections }
}

/**
 * 全等级转置表 → 多张续表：按等级列数分块（每块保留「属性」首列）
 * @param {object} params - 全等级转置表 { headers: ['属性','Lv1',...], rows: [{name, values:[]}] }
 * @param {number} perTable - 每张表的等级列数上限
 * @returns {Array<{headers: string[], rows: Array<{name:string, values:Array}>}>}
 */
function splitRateTables (params, perTable) {
  const lvHeaders = params.headers.slice(1)
  const tables = []
  for (let i = 0; i < lvHeaders.length; i += perTable) {
    const chunk = lvHeaders.slice(i, i + perTable)
    tables.push({
      headers: ['属性', ...chunk],
      rows: params.rows.map(r => ({ name: r.name, values: r.values.slice(i, i + chunk.length) }))
    })
  }
  return tables
}

/** 命座视图：仅命座 + 相关效果 */
export function applyConstellationsView (data) {
  const sections = data.sections.filter(s =>
    s.type === 'constellation-grid' || s.isRefs
  )
  return { ...data, sections }
}

/** 资料视图：基础信息 + 特殊食物 + 服装 + 技能名 + 命座名 */
export function applyProfileView (data, gameId, detail) {
  const sections = []
  const charaInfo = detail.chara_info
  const images = data._images || []

  // 技能名称（无描述，含图标）
  const skillNames = getSkillNames(detail, gameId, images)
  if (skillNames.length > 0) {
    sections.push({
      title: gameId === 'gi' ? '技能与战斗机制' : gameId === 'hsr' ? '技能' : '技能',
      type: 'profile-summary',
      items: skillNames
    })
  }

  // 命之座/星魂/影画名称（无描述，含图标）
  const conNames = getConstellationNames(detail, gameId, images)
  if (conNames.length > 0) {
    sections.push({
      title: gameId === 'gi' ? '命之座' : gameId === 'hsr' ? '星魂' : '影画',
      type: 'profile-summary',
      items: conNames
    })
  }

  // 特殊食物（仅 GI）
  if (charaInfo?.special_food) {
    const sf = charaInfo.special_food
    const sfIcon = imgUrl(images, 'detail.chara_info.special_food.icon')
    sections.push({
      title: '特殊食物',
      type: 'profile-summary',
      items: [{ name: sf.name, desc: formatFoodDesc(sf), icon: sfIcon }]
    })
  }

  // 服装（GI: costume[], ZZZ: skin{}）
  const outfits = getOutfits(charaInfo, detail, gameId)
  if (outfits.length > 0) {
    sections.push({
      title: '服装',
      type: 'profile-summary',
      items: outfits
    })
  }

  return { ...data, sections }
}

/** 故事/语音视图：stories + voice lines */
export function applyStoriesView (data, gameId, detail) {
  const sections = []
  const charaInfo = detail.chara_info

  if (gameId === 'gi' && charaInfo) {
    // 故事
    if (charaInfo.stories && typeof charaInfo.stories === 'object') {
      const storyItems = Object.values(charaInfo.stories)
        .filter(s => s && s.title && s.text)
        .map(s => ({ title: s.title, content: cleanForRender(s.text) }))
      if (storyItems.length > 0) {
        sections.push({ title: '故事', type: 'stories', items: storyItems })
      }
    }

    // 语音
    if (charaInfo.quotes && typeof charaInfo.quotes === 'object') {
      const quoteItems = Object.values(charaInfo.quotes)
        .filter(q => q && q.title && q.text)
        .map(q => ({
          title: q.title + (q.unlocked?.length ? `（${q.unlocked.join('；')}）` : ''),
          content: cleanForRender(q.text)
        }))
      if (quoteItems.length > 0) {
        sections.push({ title: '语音', type: 'stories', items: quoteItems })
      }
    }
  }

  // ZZZ: partner_info 中包含简介
  if (gameId === 'zzz' && detail.partner_info) {
    const pi = detail.partner_info
    const zzzItems = []
    if (pi.profile_desc) zzzItems.push({ title: '简介', content: cleanForRender(pi.profile_desc) })
    if (pi.stories && typeof pi.stories === 'object') {
      for (const [k, story] of Object.entries(pi.stories)) {
        if (story && story.title && story.text) {
          zzzItems.push({ title: story.title, content: cleanForRender(story.text) })
        }
      }
    }
    if (zzzItems.length > 0) {
      sections.push({ title: '资料', type: 'stories', items: zzzItems })
    }
  }

  if (sections.length === 0) {
    sections.push({
      title: '提示',
      type: 'stories',
      items: [{ title: '暂无数据', content: '该角色暂无故事或语音数据' }]
    })
  }

  return { ...data, sections }
}

/**
 * 养成/素材视图：按游戏聚合养成材料（仅本子视图展示素材）
 * GI: detail.materials.ascensions / talents；HSR: stats[].cost（突破）+ skill_trees 各节点 material_list（行迹）；
 * ZZZ: detail.level[].materials（id=10 为丁尼）
 * @param {object} data - 角色模板数据
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} detail - record.content.detail
 */
export function applyMaterialsView (data, gameId, detail) {
  const sections = []
  const materials = detail.materials
  const images = data._images || []

  if (gameId === 'gi' && materials) {
    // 聚合突破材料（旅行者等数据仅有摩拉时也展示）
    const ascAgg = aggregateMats(materials.ascensions || [])
    if (ascAgg.mats.length > 0 || ascAgg.cost > 0) {
      sections.push({
        title: '突破材料（总计）',
        type: 'materials',
        items: buildMatItems(ascAgg, images, 'gi')
      })
    }

    // 聚合天赋材料（三个技能全部等级）
    if (materials.talents && Array.isArray(materials.talents)) {
      const allTalentLevels = materials.talents.flat().filter(Boolean)
      const talentAgg = aggregateMats(allTalentLevels)
      if (talentAgg.mats.length > 0) {
        sections.push({
          title: '天赋材料（总计）',
          type: 'materials',
          items: buildMatItems(talentAgg, images, 'gi')
        })
      }
    }
  } else if (gameId === 'hsr') {
    // 突破材料：detail.stats[0~6].cost（item_id=2 为信用点）
    const ascLevels = Object.values(detail.stats || {}).map(s => _hsrCostToLevel(s?.cost))
    sections.push(..._hsrMatSections(ascLevels, '突破材料（总计）', images))

    // 行迹材料：detail.skill_trees 各等级节点的 material_list（技能升级 / 附加能力与属性加成解锁）
    const traceLevels = []
    for (const tree of Object.values(detail.skill_trees || {})) {
      for (const node of Object.values(tree || {})) {
        if (!Array.isArray(node?.material_list) || node.material_list.length === 0) continue
        traceLevels.push(_hsrCostToLevel(node.material_list))
      }
    }
    sections.push(..._hsrMatSections(traceLevels, '行迹材料（总计）', images))
  } else if (gameId === 'zzz') {
    // 养成素材：detail.level[*].materials 对象（{ "10": 24000, "100213": 4 }，id=10 为丁尼）
    const levels = Object.values(detail.level || {})
      .filter(lv => lv && typeof lv.materials === 'object' && lv.materials)
      .map(lv => {
        const mats = Object.entries(lv.materials)
          .filter(([id]) => id !== '10')
          .map(([id, count]) => ({
            id,
            count: Number(count) || 0,
            name: getZZZItemName(id) || String(id),
            rank: 0
          }))
        return { cost: Number(lv.materials['10']) || 0, mats }
      })
      .filter(l => l.mats.length > 0 || l.cost > 0)
    const agg = aggregateMats(levels)
    const items = []
    if (agg.cost > 0) {
      items.push({ name: '丁尼', count: agg.cost, icon: getZZZItemIcon('10'), id: 10, rank: 0 })
    }
    for (const m of agg.mats) {
      items.push({ name: m.name, count: m.count, icon: getZZZItemIcon(m.id), id: m.id, rank: m.rank })
    }
    if (items.length > 0) {
      sections.push({ title: '养成素材（总计）', type: 'materials', items })
    }
  }

  if (sections.length === 0) {
    sections.push({
      title: '提示',
      type: 'stories',
      items: [{ title: '暂无数据', content: '该角色暂无养成材料数据' }]
    })
  }

  return { ...data, sections }
}

/**
 * HSR cost/material_list → aggregateMats 入参（item_id=2 为信用点，其余按物品索引取名称与图标）
 * @param {Array} list - [{ item_id, item_num, rarity }]
 * @returns {{cost: number, mats: Array}}
 */
function _hsrCostToLevel (list) {
  const arr = Array.isArray(list) ? list : []
  const credit = arr.find(c => c.item_id === 2)
  const mats = arr
    .filter(c => c.item_id !== 2)
    .map(c => ({
      id: c.item_id,
      count: c.item_num,
      name: getHsrItemName(c.item_id) || String(c.item_id),
      rank: _hsrRarityRank(c.rarity)
    }))
  return { cost: credit?.item_num || 0, mats }
}

/**
 * HSR 聚合结果 → materials 栏（信用点与材料图标、排序复用 buildMatItems）
 * @param {Array} levels - [{ cost, mats }]
 * @param {string} title
 * @param {Array} images - record.meta.images
 * @returns {Array} sections
 */
function _hsrMatSections (levels, title, images) {
  const valid = levels.filter(l => l.mats.length > 0 || l.cost > 0)
  if (valid.length === 0) return []
  const agg = aggregateMats(valid)
  const items = buildMatItems(agg, images, 'hsr')
  return items.length > 0 ? [{ title, type: 'materials', items }] : []
}

/** HSR rarity 字符串 → 排序 rank（NotNormal < Rare < VeryRare < SuperRare） */
function _hsrRarityRank (rarity) {
  if (rarity === 'NotNormal') return 1
  if (rarity === 'Rare') return 2
  if (rarity === 'VeryRare') return 3
  if (rarity === 'SuperRare') return 4
  return 0
}