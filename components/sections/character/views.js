/**
 * 角色子视图处理
 * 默认视图 / 天赋视图 / 命座视图 / 资料视图 / 故事视图 / 养成视图
 */
import { getSkillNames, getConstellationNames, getOutfits } from './names.js'
import { aggregateMats, buildMatItems } from '../materials.js'
import { imgUrl, formatFoodDesc, cleanForRender } from '../util.js'

/** 默认视图：隐藏技能参数等级表（保留固定属性小格）+ 去重 metaFields */
export function applyDefaultView (data) {
  // 隐藏技能参数等级表；有固定属性（冷却/能量/体力等）时保留小格展示
  const stripParams = (sk) =>
    sk.params?.fixed?.length
      ? { ...sk, params: { ...sk.params, rows: [] } }
      : { ...sk, params: null }

  const sections = data.sections.map(s => {
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

/** 养成/素材视图：聚合突破+天赋材料总数，附加图标 */
export function applyMaterialsView (data, gameId, detail) {
  const sections = []
  const materials = detail.materials
  const images = data._images || []

  if (gameId === 'gi' && materials) {
    // 聚合突破材料
    const ascAgg = aggregateMats(materials.ascensions || [])
    if (ascAgg.mats.length > 0) {
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