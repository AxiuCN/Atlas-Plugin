/**
 * 角色 sections builder
 * 将三游戏异构 JSON 归一化为统一的角色模板数据
 *
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @returns {object} 模板数据 { hero, metaFields, sections }
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveLinks } from '../../model/LinkResolver.js'
import { backendRoot } from '../../model/AtlasService.js'

export function buildCharacterData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  if (gameId === 'gi') return _buildGI(list, detail, record.meta)
  if (gameId === 'hsr') return _buildHSR(list, detail, record.meta)
  if (gameId === 'zzz') return _buildZZZ(list, detail, record.meta)
  return null
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

  const sections = []

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

  // ── 属性概览 ──
  const metaFields = [
    { label: '稀有度', value: hero.rarity },
    { label: '神之眼', value: hero.element },
    { label: '武器', value: hero.weapon },
    { label: '命之座', value: hero.constellation },
    { label: '生日', value: hero.birthday }
  ].filter(f => f.value)

  if (detail.base_hp != null) metaFields.push({ label: '基础生命', value: String(Math.round(detail.base_hp)) })
  if (detail.base_atk != null) metaFields.push({ label: '基础攻击', value: String(Math.round(detail.base_atk)) })
  if (detail.base_def != null) metaFields.push({ label: '基础防御', value: String(Math.round(detail.base_def)) })

  // 突破属性 — 从 ascension 推导
  const asc = detail.stats_modifier?.ascension
  if (asc && asc.length > 0) {
    const last = asc[asc.length - 1] || {}
    const propMap = [
      ['fight_prop_critical_hurt', '暴击伤害'],
      ['fight_prop_critical', '暴击率'],
      ['fight_prop_element_mastery', '元素精通'],
      ['fight_prop_physical_hurt', '物理伤害加成'],
      ['fight_prop_attack_percent', '攻击力%'],
      ['fight_prop_hp_percent', '生命值%'],
      ['fight_prop_defense_percent', '防御力%']
    ]
    for (const [key, label] of propMap) {
      if (last[key]) { metaFields.push({ label: '突破属性', value: label }); break }
    }
  }

  // ── 技能（含 LINK refs）──
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

  return { hero, metaFields, sections }
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

  const metaFields = [
    { label: '属性', value: hero.element },
    { label: '命途', value: hero.weapon },
    { label: '稀有度', value: hero.rarity },
    { label: '阵营', value: detail.chara_info?.camp || '' }
  ].filter(f => f.value)

  // 基础属性
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

  return { hero, metaFields, sections }
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

  const metaFields = [
    { label: '属性', value: hero.element },
    { label: '类型', value: hero.weapon },
    { label: '稀有度', value: hero.rarity },
    { label: '阵营', value: detail.camp || '' },
    { label: '性别', value: detail.gender || '' }
  ].filter(f => f.value)

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
      if (sk.description && Array.isArray(sk.description)) {
        const main = sk.description[0]
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

  return { hero, metaFields, sections }
}

// ========== 工具函数 ==========

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

  const paramArr = first?.param
  const paramList = first?.param_list
  const paramsObj = first?.params

  if (Array.isArray(paramArr) && paramArr.length > 0) {
    // GI: first.param 是数组，first.desc 含标签
    const descLabels = (first.desc || []).map(d => String(d).split('|')[0].trim()).filter(Boolean)
    if (descLabels.length > 0) {
      paramHeaders = descLabels
      getValues = (entry) => {
        const arr = entry?.param || []
        return paramHeaders.map((_, i) => _fmtNum(arr[i]))
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

  const headers = ['等级', ...paramHeaders]
  const rows = levels.map(lv => {
    const entry = levelData[lv]
    return [lv, ...getValues(entry)]
  })

  return { headers, rows }
}

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
