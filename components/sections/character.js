/**
 * 角色 sections builder
 * 将三游戏异构 JSON 归一化为统一的角色模板数据
 *
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @param {string|null} subView - 子视图: skills | constellations | profile | stories | materials
 * @returns {object} 模板数据 { hero, metaFields, sections }
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveLinks } from '../../model/LinkResolver.js'
import { backendRoot } from '../../model/AtlasService.js'

export function buildCharacterData (gameId, record, subView = null) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}
  const meta = record?.meta

  let fullData
  if (gameId === 'gi') fullData = _buildGI(list, detail, meta)
  else if (gameId === 'hsr') fullData = _buildHSR(list, detail, meta)
  else if (gameId === 'zzz') fullData = _buildZZZ(list, detail, meta)
  else return null

  if (!fullData) return null

  // ---- 子视图路由 ----
  if (!subView) {
    return _applyDefaultView(fullData, gameId)
  }
  switch (subView) {
    case 'skills': return _applySkillsView(fullData)
    case 'constellations': return _applyConstellationsView(fullData)
    case 'profile': return _applyProfileView(fullData, gameId, detail)
    case 'stories': return _applyStoriesView(fullData, gameId, detail)
    case 'materials': return _applyMaterialsView(fullData, gameId, detail)
    default: return _applyDefaultView(fullData, gameId)
  }
}

// ========== 图标解析 ==========

/**
 * 从 meta.images 数组查找指定 fieldPath 的本地文件 URL
 * @param {Array} images — record.meta.images
 * @param {string} fieldPath — 如 "detail.skills.0.promote.0.icon"
 * @returns {string} file:// URL，查不到返回空串
 */
function _imgUrl (images, fieldPath) {
  if (!images || !Array.isArray(images)) return ''
  const img = images.find(i => i.fieldPath === fieldPath)
  if (img?.localPath) {
    const fullPath = path.join(backendRoot, img.localPath)
    if (fs.existsSync(fullPath)) {
      return pathToFileURL(fullPath).href
    }
  }
  return ''
}

// ========== 原神 ==========

function _buildGI (list, detail, meta) {
  const images = meta?.images || []
  const img = (fp) => _imgUrl(images, fp)

  // ── Hero 区块 ──
  const hero = {
    namecard: img('detail.chara_info.namecard.icon'),
    portrait: img('icon') || img('detail.icon'),
    title: detail.chara_info?.title || '',
    element: detail.chara_info?.vision || _elementLabel(list.element || ''),
    weapon: _weaponLabel(list.weapon || detail.weapon || ''),
    birthday: _formatBirthday(list.birth || detail.chara_info?.birth),
    constellation: detail.chara_info?.constellation || '',
    rarity: meta?.rarity || list.rarity || ''
  }

  // ── 属性概览（已去重：移除 hero 已展示的字段）──
  const metaFields = []

  // 基础数值取最高等级（优先 100 级，其次 90 级）
  const sm = detail.stats_modifier
  if (sm) {
    const hp90 = sm.hp?.['90']
    const hp100 = sm.hp?.['100']
    const atk90 = sm.atk?.['90']
    const atk100 = sm.atk?.['100']
    const def90 = sm.def?.['90']
    const def100 = sm.def?.['100']

    // base × 等级倍率 + 突破累计加成
    const baseHp = detail.base_hp || 0
    const baseAtk = detail.base_atk || 0
    const baseDef = detail.base_def || 0
    const ascLast = sm.ascension?.[sm.ascension.length - 1] || {}
    const ascHp = ascLast.fight_prop_base_hp || 0
    const ascAtk = ascLast.fight_prop_base_attack || 0
    const ascDef = ascLast.fight_prop_base_defense || 0

    if (hp90 != null) {
      const v90 = Math.round(baseHp * hp90 + ascHp)
      const v100 = hp100 != null ? Math.round(baseHp * hp100 + ascHp) : null
      metaFields.push({
        label: v100 != null ? '基础生命 (90/100级)' : '基础生命 (90级)',
        value: v100 != null ? `${v90} / ${v100}` : String(v90)
      })
    }
    if (atk90 != null) {
      const v90 = Math.round(baseAtk * atk90 + ascAtk)
      const v100 = atk100 != null ? Math.round(baseAtk * atk100 + ascAtk) : null
      metaFields.push({
        label: v100 != null ? '基础攻击 (90/100级)' : '基础攻击 (90级)',
        value: v100 != null ? `${v90} / ${v100}` : String(v90)
      })
    }
    if (def90 != null) {
      const v90 = Math.round(baseDef * def90 + ascDef)
      const v100 = def100 != null ? Math.round(baseDef * def100 + ascDef) : null
      metaFields.push({
        label: v100 != null ? '基础防御 (90/100级)' : '基础防御 (90级)',
        value: v100 != null ? `${v90} / ${v100}` : String(v90)
      })
    }

    // 突破属性
    const asc = sm.ascension
    if (asc && asc.length > 0) {
      const last = asc[asc.length - 1] || {}
      const propMap = [
        ['fight_prop_critical_hurt', '暴击伤害'],
        ['fight_prop_critical', '暴击率'],
        ['fight_prop_element_mastery', '元素精通'],
        ['fight_prop_physical_hurt', '物理伤害加成'],
        ['fight_prop_attack_percent', '攻击力%'],
        ['fight_prop_hp_percent', '生命值%'],
        ['fight_prop_defense_percent', '防御力%'],
        ['fight_prop_heal_add', '治疗加成']
      ]
      for (const [key, label] of propMap) {
        if (last[key]) {
          const v = last[key]
          // 突破属性是小数，转百分比
          metaFields.push({ label: label, value: _fmtPercent(v) })
          break
        }
      }
    }
  }

  const sections = []

  // ── 技能（含 LINK refs + 完整参数）──
  if (detail.skills && Array.isArray(detail.skills)) {
    const skillFields = detail.skills.map((s, i) => {
      const { resolved, refs } = resolveLinks(s.desc || '', 'gi')
      return {
        name: s.name || '',
        tag: _skillTag(s.name, 'gi'),
        icon: img(`detail.skills.${i}.promote.0.icon`),
        desc: _cleanForRender(resolved),
        refs,
        params: _buildSkillParams(s.promote, 'gi')
      }
    })
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // ── 固有天赋（技能与命座之间）──
  if (detail.passives && Array.isArray(detail.passives)) {
    const extras = detail.passives.map((p, i) => {
      const { resolved } = resolveLinks(p.desc || '', 'gi')
      const unlockLabel = _passiveUnlock(p.unlock)
      return {
        name: unlockLabel ? `${p.name}（${unlockLabel}）` : p.name,
        desc: _cleanForRender(resolved),
        icon: img(`detail.passives.${i}.icon`)
      }
    }).filter(e => e.name)
    if (extras.length > 0) {
      sections.push({ title: '固有天赋', type: 'list', items: extras })
    }
  }

  // ── 命之座（不含 LINK refs）──
  if (detail.constellations && Array.isArray(detail.constellations)) {
    const conList = detail.constellations.map((c, i) => {
      const { resolved } = resolveLinks(c.desc || '', 'gi')
      return {
        order: i + 1,
        name: c.name || '',
        icon: img(`detail.constellations.${i}.icon`),
        desc: _cleanForRender(resolved)
      }
    })
    sections.push({ title: '命之座', type: 'constellation-grid', items: conList })
  }

  return { hero, metaFields, sections, _images: images }
}

// ========== 星铁 ==========

function _buildHSR (list, detail, meta) {
  const images = meta?.images || []
  const img = (fp) => _imgUrl(images, fp)
  const sections = []

  // Hero
  const hero = {
    namecard: '',
    portrait: img('icon') || img('detail.icon'),
    title: '',
    element: list.damageType || '',
    weapon: list.baseType || '',
    birthday: '',
    constellation: '',
    rarity: meta?.rarity || list.rarity || ''
  }

  // 去重：仅保留阵营 + 基础属性
  const metaFields = []
  if (detail.chara_info?.camp) {
    metaFields.push({ label: '阵营', value: detail.chara_info.camp })
  }

  if (detail.properties && Array.isArray(detail.properties)) {
    const propFields = detail.properties.map(p => ({
      label: _propLabel(p.property_type || ''),
      value: `${p.base || ''}${p.add ? ' + ' + p.add : ''}`
    }))
    metaFields.push(...propFields)
  }

  // 技能
  if (detail.skills && typeof detail.skills === 'object') {
    const skillFields = Object.entries(detail.skills).map(([key, s]) => ({
      name: s.name || '',
      tag: _skillTag(s.type || s.type_name || '', 'hsr'),
      icon: img(`detail.skills.${key}.level.0.icon`),
      desc: _cleanText(s.desc || s.simple_desc || ''),
      params: _buildSkillParams(s.level, 'hsr')
    }))
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // 行迹（技能与星魂之间）
  if (detail.skill_trees && typeof detail.skill_trees === 'object') {
    const extras = []
    for (const [treeKey, tree] of Object.entries(detail.skill_trees)) {
      if (tree && typeof tree === 'object') {
        for (const [nodeKey, node] of Object.entries(tree)) {
          if (node?.anchor && node.anchor !== 'Point01') continue
          if (node?.level_up_skill_id) {
            extras.push({
              name: node.anchor || '',
              desc: '',
              icon: img(`detail.skill_trees.${treeKey}.${nodeKey}.icon`)
            })
          }
        }
      }
    }
    if (extras.length > 0) {
      sections.push({ title: '行迹', type: 'list', items: extras })
    }
  }

  // 星魂
  if (detail.ranks && typeof detail.ranks === 'object') {
    const conList = Object.entries(detail.ranks)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, r]) => ({
        order: Number(r.id || 0),
        name: r.name || '',
        icon: img(`detail.ranks.${k}.icon`),
        desc: _cleanText(r.desc || '')
      }))
    sections.push({ title: '星魂', type: 'constellation-grid', items: conList })
  }

  return { hero, metaFields, sections, _images: images }
}

// ========== 绝区零 ==========

function _buildZZZ (list, detail, meta) {
  const images = meta?.images || []
  const img = (fp) => _imgUrl(images, fp)
  const sections = []

  const elementType = detail.element_type ? Object.values(detail.element_type)[0] : ''
  const weaponType = detail.weapon_type ? Object.values(detail.weapon_type)[0] : ''

  const hero = {
    namecard: '',
    portrait: img('icon') || img('detail.icon'),
    title: '',
    element: elementType || list.element || '',
    weapon: weaponType || list.specialty || '',
    birthday: '',
    constellation: '',
    rarity: meta?.rarity || list.rarity || ''
  }

  // 去重：仅保留阵营、性别 + stats
  const metaFields = []
  if (detail.camp) metaFields.push({ label: '阵营', value: detail.camp })
  if (detail.gender) metaFields.push({ label: '性别', value: detail.gender })

  if (detail.stats) {
    const statKeys = ['hp_max', 'attack', 'defence', 'crit', 'crit_damage', 'pen_rate', 'stun']
    for (const key of statKeys) {
      if (detail.stats[key] != null) {
        metaFields.push({ label: _propLabel(key), value: String(detail.stats[key]) })
      }
    }
  }

  // 技能
  if (detail.skill && typeof detail.skill === 'object') {
    const skillOrder = ['basic', 'dodge', 'special', 'chain', 'core']
    const skillLabels = { basic: '普通攻击', dodge: '闪避', special: '特殊技', chain: '连携技', core: '核心技' }
    const skillFields = []
    for (const key of skillOrder) {
      const sk = detail.skill[key]
      if (!sk) continue
      let desc = ''
      let params = null
      let main
      if (sk.description && Array.isArray(sk.description)) {
        main = sk.description[0]
        if (main) {
          desc = _cleanText(main.desc || '')
          if (main.param && Array.isArray(main.param)) {
            const headers = ['等级', ...(main.param.map(p => p.name || ''))]
            const maxLevel = Math.max(...main.param.map(p => (p.level || []).length), 0)
            const rows = []
            for (let lv = 0; lv < maxLevel; lv++) {
              const row = [String(lv + 1)]
              for (const p of main.param) {
                row.push(p.level?.[lv] || '')
              }
              rows.push(row)
            }
            params = { headers, rows }
          }
        }
      }
      skillFields.push({
        name: main?.name || sk.name || skillLabels[key],
        tag: skillLabels[key],
        icon: img(`detail.skill.${key}.icon`),
        desc,
        params
      })
    }
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // 潜能（技能与影画之间）
  if (detail.potential_detail && typeof detail.potential_detail === 'object') {
    const extras = Object.entries(detail.potential_detail).map(([k, p]) => ({
      name: p.name || p.level_show_name || '',
      desc: _cleanText(p.desc || ''),
      icon: img(`detail.potential_detail.${k}.icon`)
    })).filter(e => e.name)
    if (extras.length > 0) {
      sections.push({ title: '潜能', type: 'list', items: extras })
    }
  }

  // 影画
  if (detail.talent && typeof detail.talent === 'object') {
    const conList = Object.entries(detail.talent)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, t]) => ({
        order: Number(k),
        name: t.name || '',
        icon: img(`detail.talent.${k}.icon`),
        desc: _cleanText(t.desc || '')
      }))
    sections.push({ title: '影画', type: 'constellation-grid', items: conList })
  }

  // 资料
  if (detail.partner_info) {
    const pi = detail.partner_info
    const stories = []
    if (pi.profile_desc) stories.push({ title: '简介', content: _cleanText(pi.profile_desc) })
    if (pi.birthday) metaFields.push({ label: '生日', value: pi.birthday })
    if (pi.full_name) metaFields.push({ label: '全名', value: pi.full_name })
    if (pi.stature) metaFields.push({ label: '身高', value: pi.stature })
    if (stories.length > 0) {
      sections.push({ title: '资料', type: 'stories', items: stories })
    }
  }

  return { hero, metaFields, sections, _images: images }
}

// ============================================================
//  子视图处理
// ============================================================

/** 默认视图：隐藏技能参数 + 去重 metaFields */
function _applyDefaultView (data, gameId) {
  // 隐藏技能参数
  const sections = data.sections.map(s => {
    if (s.type === 'skill-cards' && s.skills) {
      return {
        ...s,
        skills: s.skills.map(sk => ({ ...sk, params: null }))
      }
    }
    return s
  })

  return { ...data, sections }
}

/** 天赋视图：仅技能 + 被动（完整参数） */
function _applySkillsView (data) {
  const sections = data.sections.filter(s =>
    s.type === 'skill-cards' || s.type === 'list'
  )
  return { ...data, sections }
}

/** 命座视图：仅命座 */
function _applyConstellationsView (data) {
  const sections = data.sections.filter(s =>
    s.type === 'constellation-grid'
  )
  return { ...data, sections }
}

/** 资料视图：基础信息 + 特殊食物 + 服装 + 技能名 + 命座名 */
function _applyProfileView (data, gameId, detail) {
  const sections = []
  const charaInfo = detail.chara_info
  const images = data._images || []

  // 技能名称（无描述，含图标）
  const skillNames = _getSkillNames(detail, gameId, images)
  if (skillNames.length > 0) {
    sections.push({
      title: gameId === 'gi' ? '技能与战斗机制' : gameId === 'hsr' ? '技能' : '技能',
      type: 'profile-summary',
      items: skillNames
    })
  }

  // 命之座/星魂/影画名称（无描述，含图标）
  const conNames = _getConstellationNames(detail, gameId, images)
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
    const sfIcon = _imgUrl(images, 'detail.chara_info.special_food.icon')
    sections.push({
      title: '特殊食物',
      type: 'profile-summary',
      items: [{ name: sf.name, desc: _formatFoodDesc(sf), icon: sfIcon }]
    })
  }

  // 服装（GI: costume[], ZZZ: skin{}）
  const outfits = _getOutfits(charaInfo, detail, gameId)
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
function _applyStoriesView (data, gameId, detail) {
  const sections = []
  const charaInfo = detail.chara_info

  if (gameId === 'gi' && charaInfo) {
    // 故事
    if (charaInfo.stories && typeof charaInfo.stories === 'object') {
      const storyItems = Object.values(charaInfo.stories)
        .filter(s => s && s.title && s.text)
        .map(s => ({ title: s.title, content: _cleanForRender(s.text) }))
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
          content: _cleanForRender(q.text)
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
    if (pi.profile_desc) zzzItems.push({ title: '简介', content: _cleanForRender(pi.profile_desc) })
    if (pi.stories && typeof pi.stories === 'object') {
      for (const [k, story] of Object.entries(pi.stories)) {
        if (story && story.title && story.text) {
          zzzItems.push({ title: story.title, content: _cleanForRender(story.text) })
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
function _applyMaterialsView (data, gameId, detail) {
  const sections = []
  const materials = detail.materials
  const images = data._images || []

  if (gameId === 'gi' && materials) {
    // 聚合突破材料
    const ascAgg = _aggregateMats(materials.ascensions || [])
    if (ascAgg.mats.length > 0) {
      sections.push({
        title: '突破材料（总计）',
        type: 'materials',
        items: _buildMatItems(ascAgg, images, 'gi')
      })
    }

    // 聚合天赋材料（三个技能全部等级）
    if (materials.talents && Array.isArray(materials.talents)) {
      const allTalentLevels = materials.talents.flat().filter(Boolean)
      const talentAgg = _aggregateMats(allTalentLevels)
      if (talentAgg.mats.length > 0) {
        sections.push({
          title: '天赋材料（总计）',
          type: 'materials',
          items: _buildMatItems(talentAgg, images, 'gi')
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

/** 聚合材料数组：合并同名材料数量 + 摩拉 */
function _aggregateMats (levels) {
  const cost = levels.reduce((sum, l) => sum + (l.cost || 0), 0)
  const matMap = new Map() // id → { name, id, count, rank }
  for (const level of levels) {
    for (const m of (level.mats || [])) {
      const key = m.id || m.name
      const entry = matMap.get(key)
      if (entry) {
        entry.count += m.count || 0
      } else {
        matMap.set(key, { name: m.name, id: m.id, count: m.count || 0, rank: m.rank || 0 })
      }
    }
  }
  return { cost, mats: [...matMap.values()] }
}

/** 材料排序：按类型分组，组内按品质升序 */
function _matSortOrder (m) {
  const idNum = Number(m.id) || 0
  const rank = m.rank || 0

  // 分类：摩拉→经验书→区域特产→Boss素材→突破宝石→周本材料→智识之冕→天赋书→怪物素材
  let cat
  if (idNum === 202) cat = 0                           // 摩拉
  else if (idNum >= 104001 && idNum <= 104099) cat = 1  // 经验书
  else if (idNum >= 101000 && idNum <= 101999) cat = 2  // 区域特产
  else if (idNum >= 113000 && idNum <= 113999) cat = rank >= 5 ? 5 : 3  // Boss素材(rank<5) / 周本材料(rank≥5)
  else if (idNum >= 104100 && idNum <= 104199) cat = 4  // 突破宝石
  else if (idNum === 104319) cat = 6                     // 智识之冕
  else if (idNum >= 104300 && idNum <= 104399) cat = 7  // 天赋书
  else if (idNum >= 112000 && idNum <= 112999) cat = 8  // 怪物素材
  else cat = 99

  return cat * 100 + rank
}

/** 构建材料列表项（含图标，按类型+品质排序） */
function _buildMatItems (agg, images, gameId) {
  const items = []
  if (agg.cost > 0) {
    items.push({ name: '摩拉', count: agg.cost, icon: _matIcon(images, 'mora', gameId), id: 202, rank: 0 })
  }
  for (const m of agg.mats) {
    items.push({ name: m.name, count: m.count, icon: _matIcon(images, m.id, gameId), id: m.id, rank: m.rank })
  }
  items.sort((a, b) => _matSortOrder(a) - _matSortOrder(b))
  return items
}

/**
 * 材料图标查询：先查 meta.images 匹配，再按 UI_ItemIcon_<id> 模式直查 gallery
 */
function _matIcon (images, materialId, gameId) {
  if (!materialId) return ''
  // 先查已下载的 images 列表
  if (Array.isArray(images)) {
    const haystack = String(materialId)
    const hit = images.find(i => i.localPath && i.localPath.includes(haystack))
    if (hit?.localPath) {
      const fullPath = path.join(backendRoot, hit.localPath)
      if (fs.existsSync(fullPath)) return pathToFileURL(fullPath).href
    }
  }
  // 兜底：按命名约定直查 gallery
  const filename = materialId === 'mora'
    ? 'UI_ItemIcon_202.webp'
    : `UI_ItemIcon_${materialId}.webp`
  const fullPath = path.join(backendRoot, 'gallery', gameId, filename)
  if (fs.existsSync(fullPath)) return pathToFileURL(fullPath).href
  return ''
}

// ============================================================
//  工具函数
// ============================================================

/**
 * 解析 desc 中的格式说明符
 * "一段伤害|{param1:F1P}" → Map { 0: 'F1P' }
 * @param {string[]} descArray
 * @returns {Map<number, string>} paramIndex → format
 */
function _parseParamFormats (descArray) {
  const map = new Map()
  if (!descArray || !Array.isArray(descArray)) return map
  for (const d of descArray) {
    if (!d || typeof d !== 'string') continue
    const matches = d.matchAll(/\{param(\d+):([^}]+)\}/g)
    for (const m of matches) {
      const idx = Number(m[1]) - 1 // param1 → index 0
      if (!map.has(idx)) map.set(idx, m[2])
    }
  }
  return map
}

/**
 * 按格式说明符格式化参数值
 * @param {*} value
 * @param {string} format - F1P | P | F1 | F2 | undefined
 * @returns {string}
 */
function _fmtParam (value, format) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)

  if (!format) return _fmtNum(n)

  // 百分比格式
  if (format.includes('P')) {
    const pct = n * 100
    const decimals = format.match(/F(\d+)/)
    if (decimals) return pct.toFixed(Number(decimals[1])) + '%'
    if (Number.isInteger(pct)) return pct + '%'
    return pct.toFixed(1) + '%'
  }

  // 浮点数格式
  if (format.startsWith('F') && format.length > 1) {
    const decimals = Number(format.slice(1))
    if (!Number.isNaN(decimals)) return n.toFixed(decimals)
  }

  return _fmtNum(n)
}

/**
 * 从技能 promote/level 数据构建参数表
 * @param {object} levelData — s.promote (GI) 或 s.level (HSR)
 * @param {string} game — 'gi' | 'hsr'
 * @returns {object|null} { headers: string[], rows: string[][] } | null
 */
function _buildSkillParams (levelData, game) {
  if (!levelData || typeof levelData !== 'object') return null

  const levels = Object.keys(levelData).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
  if (!levels.length) return null

  const first = levelData[levels[0]]
  let paramHeaders = []
  let getValues
  let formatMap = new Map()

  const paramArr = first?.param
  const paramList = first?.param_list
  const paramsObj = first?.params

  if (Array.isArray(paramArr) && paramArr.length > 0) {
    // GI: first.param 是数组，first.desc 含标签和格式说明符
    const descLabels = (first.desc || []).map(d => String(d).split('|')[0].trim()).filter(Boolean)
    if (descLabels.length > 0) {
      paramHeaders = descLabels
      formatMap = _parseParamFormats(first.desc || [])
      getValues = (entry) => {
        const arr = entry?.param || []
        return paramHeaders.map((_, i) => _fmtParam(arr[i], formatMap.get(i)))
      }
    }
  }

  if (!paramHeaders.length && paramList != null) {
    if (Array.isArray(paramList) && paramList.length > 0) {
      paramHeaders = paramList.map((_, i) => `属性${i + 1}`)
      getValues = (entry) => {
        const arr = entry?.param_list || []
        return paramHeaders.map((_, i) => _fmtNum(arr[i]))
      }
    } else if (typeof paramList === 'object') {
      paramHeaders = Object.keys(paramList)
      getValues = (entry) => paramHeaders.map(k => _fmtNum(entry?.param_list?.[k]))
    }
  }

  if (!paramHeaders.length && paramsObj && typeof paramsObj === 'object') {
    paramHeaders = Object.keys(paramsObj)
    getValues = (entry) => paramHeaders.map(k => _fmtNum(entry?.params?.[k]))
  }

  if (!paramHeaders.length) return null

  // 等级偏移：GI promote 键 0-14 对应游戏内等级 1-15
  const levelOffset = game === 'gi' ? 1 : 0

  const headers = ['等级', ...paramHeaders]
  const rows = levels.map(lv => {
    const entry = levelData[lv]
    return [String(Number(lv) + levelOffset), ...getValues(entry)]
  })

  return { headers, rows }
}

// ========== 数值格式化 ==========

/** 格式化突破属性百分比 */
function _fmtPercent (v) {
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  if (n > 1) return n.toFixed(1) + '%' // 已经是百分比整数
  return (n * 100).toFixed(1) + '%'
}

/** 格式化特殊食物描述 */
function _formatFoodDesc (sf) {
  const parts = []
  if (sf.name) parts.push(sf.name)
  if (sf.recipe) parts.push(`食谱ID: ${sf.recipe}`)
  return parts.join(' | ')
}

// ========== 名称提取（资料子视图） ==========

/** 获取技能名称列表（无描述，含图标） */
function _getSkillNames (detail, gameId, images) {
  const names = []
  if (gameId === 'gi' && detail.skills && Array.isArray(detail.skills)) {
    detail.skills.forEach((s, i) => {
      names.push({ name: s.name, tag: _skillTag(s.name, 'gi'), icon: _imgUrl(images, `detail.skills.${i}.promote.0.icon`) })
    })
  } else if (gameId === 'hsr' && detail.skills && typeof detail.skills === 'object') {
    Object.entries(detail.skills).forEach(([key, s]) => {
      names.push({ name: s.name, tag: _skillTag(s.type || s.type_name || '', 'hsr'), icon: _imgUrl(images, `detail.skills.${key}.level.0.icon`) })
    })
  } else if (gameId === 'zzz' && detail.skill && typeof detail.skill === 'object') {
    const skillOrder = ['basic', 'dodge', 'special', 'chain', 'core']
    const skillLabels = { basic: '普通攻击', dodge: '闪避', special: '特殊技', chain: '连携技', core: '核心技' }
    for (const key of skillOrder) {
      const sk = detail.skill[key]
      if (!sk) continue
      const main = sk.description?.[0]
      names.push({ name: main?.name || sk.name || skillLabels[key] || key, tag: skillLabels[key] || key, icon: _imgUrl(images, `detail.skill.${key}.icon`) })
    }
  }
  return names
}

/** 获取命之座名称列表（无描述，含图标） */
function _getConstellationNames (detail, gameId, images) {
  const names = []
  if (gameId === 'gi' && detail.constellations && Array.isArray(detail.constellations)) {
    detail.constellations.forEach((c, i) => names.push({ order: i + 1, name: c.name, icon: _imgUrl(images, `detail.constellations.${i}.icon`) }))
  } else if (gameId === 'hsr' && detail.ranks && typeof detail.ranks === 'object') {
    Object.entries(detail.ranks)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([k, r]) => names.push({ order: Number(k), name: r.name, icon: _imgUrl(images, `detail.ranks.${k}.icon`) }))
  } else if (gameId === 'zzz' && detail.talent && typeof detail.talent === 'object') {
    Object.entries(detail.talent)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([k, t]) => names.push({ order: Number(k), name: t.name, icon: _imgUrl(images, `detail.talent.${k}.icon`) }))
  }
  return names
}

/** 获取服装列表 */
function _getOutfits (charaInfo, detail, gameId) {
  const outfits = []
  if (gameId === 'gi' && charaInfo?.costume && Array.isArray(charaInfo.costume)) {
    for (const c of charaInfo.costume) {
      outfits.push({ name: c.name, desc: c.desc || '' })
    }
  } else if (gameId === 'zzz' && detail.skin && typeof detail.skin === 'object') {
    for (const sk of Object.values(detail.skin)) {
      if (sk && sk.name) outfits.push({ name: sk.name, desc: sk.desc || '' })
    }
  } else if (gameId === 'hsr' && charaInfo?.skin_name) {
    outfits.push({ name: charaInfo.skin_name, desc: '' })
  }
  return outfits
}

// ========== 基础工具函数 ==========

/** 生日格式化：[1, 1] → "1月1日" */
function _formatBirthday (birth) {
  if (!birth || !Array.isArray(birth) || birth.length < 2) return ''
  return `${birth[0]}月${birth[1]}日`
}

/** 武器类型中文映射 */
function _weaponLabel (weapon) {
  const map = {
    WEAPON_SWORD_ONE_HAND: '单手剑',
    WEAPON_CLAYMORE: '双手剑',
    WEAPON_POLE: '长柄武器',
    WEAPON_CATALYST: '法器',
    WEAPON_BOW: '弓'
  }
  return map[weapon] || weapon
}

/** 元素类型中文映射（fallback，优先用 chara_info.vision 中文值） */
function _elementLabel (element) {
  const map = {
    Cryo: '冰', Pyro: '火', Hydro: '水', Electro: '雷',
    Anemo: '风', Geo: '岩', Dendro: '草'
  }
  return map[element] || element
}

/** 固有天赋解锁标签 */
function _passiveUnlock (unlock) {
  if (unlock === 1) return '突破1解锁'
  if (unlock === 4) return '突破4解锁'
  return ''
}

/** 数值格式化：保留合理小数位 */
function _fmtNum (v) {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  if (Number.isInteger(n)) return String(n)
  if (Math.abs(n) >= 1) return n.toFixed(1)
  if (Math.abs(n) >= 0.01) return n.toFixed(2)
  return String(n)
}

/**
 * 渲染用清洗：保留 HTML 标签（span 高亮等），清理 RUBY 标记和换行符
 * 同时将 <color=#RGB>text</color> 转为 <span style="color:#RGB">text</span>
 */
function _cleanForRender (str) {
  if (!str) return ''
  return String(str)
    .replace(/\\n/g, '\n')
    .replace(/\{RUBY_B#[^}]*}/g, '')
    .replace(/\{RUBY_E#}/g, '')
    .replace(/<color=([^>]+)>([\s\S]*?)<\/color>/g, (m, color, inner) => {
      return `<span style="color:${color}">${inner}</span>`
    })
    .trim()
}

/** 清理 HTML、RUBY 标记、LINK 占位符、换行符（纯文本场景） */
function _cleanText (str) {
  if (!str) return ''
  return String(str)
    .replace(/\\n/g, '\n')
    .replace(/\{RUBY_B#[^}]*}/g, '')
    .replace(/\{RUBY_E#}/g, '')
    .replace(/\{LINK#[^}]*}/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

/** 技能类型标签 */
function _skillTag (type, game) {
  if (game === 'gi') {
    const tags = { '普通攻击': '普通攻击', '元素战技': '元素战技', '元素爆发': '元素爆发', '冲刺': '冲刺' }
    for (const [k, v] of Object.entries(tags)) {
      if (type.includes(k)) return v
    }
    return '天赋'
  }
  if (game === 'hsr') {
    const tags = { 'Normal': '普攻', 'BPSkill': '战技', 'Ultra': '终结技', 'Talent': '天赋', 'Maze': '秘技' }
    return tags[type] || type
  }
  return type
}

/** 属性名转中文 */
function _propLabel (key) {
  const labels = {
    hp: '生命值', hp_max: '生命值', MaxHP: '生命值',
    atk: '攻击力', attack: '攻击力', Attack: '攻击力',
    def: '防御力', defence: '防御力', Defence: '防御力',
    speed: '速度', SpeedBase: '速度',
    crit: '暴击率', crit_damage: '暴击伤害',
    pen_rate: '穿透率', pen_ratio: '穿透率',
    stun: '击破', break_stun: '击破',
    sp_need: '能量上限',
    HateBase: '嘲讽', CriticalDamage: '暴击伤害', CriticalChance: '暴击率',
    BreakStun: '击破'
  }
  return labels[key] || key
}
