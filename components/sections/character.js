/**
 * 角色 sections builder
 * 将三游戏异构 JSON 归一化为统一的角色模板数据
 *
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @returns {object} 模板数据 { gameName, pageTitle, name, rarity, metaFields, sections }
 */
export function buildCharacterData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  if (gameId === 'gi') return _buildGI(list, detail, record.meta)
  if (gameId === 'hsr') return _buildHSR(list, detail, record.meta)
  if (gameId === 'zzz') return _buildZZZ(list, detail, record.meta)
  return null
}

// ========== 原神 ==========

function _buildGI (list, detail, meta) {
  const sections = []

  // 属性概览
  const stats = list.stats || {}
  const metaFields = [
    { label: '元素', value: list.element || '' },
    { label: '武器', value: list.weapontype || '' },
    { label: '稀有度', value: meta?.rarity || list.rarity || '' },
    { label: '生命值', value: stats.hp || '' },
    { label: '攻击力', value: stats.atk || '' },
    { label: '防御力', value: stats.def || '' },
    { label: '突破属性', value: stats.special || list.substat || '' },
  ].filter(f => f.value)

  // 技能
  if (detail.skills && Array.isArray(detail.skills)) {
    const skillFields = detail.skills.map(s => ({
      name: s.name || '',
      tag: _skillTag(s.name, 'gi'),
      desc: _cleanText(s.desc || ''),
      params: _buildSkillParams(s.promote, 'gi')
    }))
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // 命座
  if (detail.constellations && Array.isArray(detail.constellations)) {
    const conList = detail.constellations.map((c, i) => ({
      order: i + 1,
      name: c.name || '',
      desc: _cleanText(c.desc || '')
    }))
    sections.push({ title: '命之座', type: 'constellation-grid', items: conList })
  }

  // 固有天赋
  if (detail.promote_skills && Array.isArray(detail.promote_skills)) {
    const extras = detail.promote_skills.map(p => ({
      name: p.title || p.name || '',
      desc: _cleanText(p.desc || '')
    })).filter(e => e.name)
    if (extras.length > 0) {
      sections.push({ title: '固有天赋', type: 'list', items: extras })
    }
  }

  // 角色资料
  if (detail.chara_info?.stories && Array.isArray(detail.chara_info.stories)) {
    const stories = detail.chara_info.stories
      .filter(s => s.content || s.detail)
      .map(s => ({ title: s.title || s.name || '', content: _cleanText(s.content || s.detail || '') }))
    if (stories.length > 0) {
      sections.push({ title: '资料', type: 'stories', items: stories })
    }
  }

  return { metaFields, sections }
}

// ========== 星铁 ==========

function _buildHSR (list, detail, meta) {
  const sections = []

  const metaFields = [
    { label: '属性', value: list.damageType || '' },
    { label: '命途', value: list.baseType || '' },
    { label: '稀有度', value: meta?.rarity || list.rarity || '' },
    { label: '阵营', value: detail.chara_info?.camp || '' },
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
    const skillFields = Object.values(detail.skills).map(s => ({
      name: s.name || '',
      tag: _skillTag(s.type || s.type_name || '', 'hsr'),
      desc: _cleanText(s.desc || s.simple_desc || ''),
      params: _buildSkillParams(s.level, 'hsr')
    }))
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // 星魂
  if (detail.ranks && typeof detail.ranks === 'object') {
    const conList = Object.entries(detail.ranks)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, r]) => ({ order: Number(r.id || 0), name: r.name || '', desc: _cleanText(r.desc || '') }))
    sections.push({ title: '星魂', type: 'constellation-grid', items: conList })
  }

  // 行迹
  if (detail.skill_trees && typeof detail.skill_trees === 'object') {
    const extras = []
    for (const [, tree] of Object.entries(detail.skill_trees)) {
      if (tree && typeof tree === 'object') {
        for (const [, node] of Object.entries(tree)) {
          if (node?.anchor && node.anchor !== 'Point01') continue // 只取主节点
          if (node?.level_up_skill_id) {
            extras.push({ name: node.anchor || '', desc: '' })
          }
        }
      }
    }
    if (extras.length > 0) {
      sections.push({ title: '行迹', type: 'list', items: extras })
    }
  }

  return { metaFields, sections }
}

// ========== 绝区零 ==========

function _buildZZZ (list, detail, meta) {
  const sections = []

  // 获取元素、强攻类型
  const elementType = detail.element_type ? Object.values(detail.element_type)[0] : ''
  const weaponType = detail.weapon_type ? Object.values(detail.weapon_type)[0] : ''

  const metaFields = [
    { label: '属性', value: elementType || list.element || '' },
    { label: '类型', value: weaponType || list.specialty || '' },
    { label: '稀有度', value: meta?.rarity || list.rarity || '' },
    { label: '阵营', value: detail.camp || '' },
    { label: '性别', value: detail.gender || '' },
  ].filter(f => f.value)

  // 基础属性
  if (detail.stats) {
    const statKeys = ['hp_max', 'attack', 'defence', 'crit', 'crit_damage', 'pen_rate', 'stun']
    for (const key of statKeys) {
      if (detail.stats[key] != null) {
        metaFields.push({ label: _propLabel(key), value: String(detail.stats[key]) })
      }
    }
  }

  // 技能 (basic/dodge/special/chain/core)
  if (detail.skill && typeof detail.skill === 'object') {
    const skillOrder = ['basic', 'dodge', 'special', 'chain', 'core']
    const skillLabels = { basic: '普通攻击', dodge: '闪避', special: '特殊技', chain: '连携技', core: '核心技' }
    const skillFields = []
    for (const key of skillOrder) {
      const sk = detail.skill[key]
      if (!sk) continue
      // ZZZ 技能描述在 description[] 中
      let desc = ''
      let params = null
      if (sk.description && Array.isArray(sk.description)) {
        const main = sk.description[0]
        if (main) {
          desc = _cleanText(main.desc || '')
          // 参数表 (potential + param)
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
        desc,
        params
      })
    }
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // 影画
  if (detail.talent && typeof detail.talent === 'object') {
    const conList = Object.entries(detail.talent)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, t]) => ({ order: Number(k), name: t.name || '', desc: _cleanText(t.desc || '') }))
    sections.push({ title: '影画', type: 'constellation-grid', items: conList })
  }

  // 潜能
  if (detail.potential_detail && typeof detail.potential_detail === 'object') {
    const extras = Object.values(detail.potential_detail).map(p => ({
      name: p.name || p.level_show_name || '',
      desc: _cleanText(p.desc || '')
    })).filter(e => e.name)
    if (extras.length > 0) {
      sections.push({ title: '潜能', type: 'list', items: extras })
    }
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

  return { metaFields, sections }
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

  // 检测 param 字段类型：数组（GI param）或对象（param_list/params）
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
      // HSR: param_list 是数组，无标签，用序号
      paramHeaders = paramList.map((_, i) => `属性${i + 1}`)
      getValues = (entry) => {
        const arr = entry?.param_list || []
        return paramHeaders.map((_, i) => _fmtNum(arr[i]))
      }
    } else if (typeof paramList === 'object') {
      // param_list 是对象 { key: value }
      paramHeaders = Object.keys(paramList)
      getValues = (entry) => paramHeaders.map(k => _fmtNum(entry?.param_list?.[k]))
    }
  }

  if (!paramHeaders.length && paramsObj && typeof paramsObj === 'object') {
    // params 对象兜底
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

/** 数值格式化：保留合理小数位 */
function _fmtNum (v) {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  if (Number.isInteger(n)) return String(n)
  // 小数 > 1 → 1 位，< 1 → 2 位，百分比类保留 1 位
  if (Math.abs(n) >= 1) return n.toFixed(1)
  if (Math.abs(n) >= 0.01) return n.toFixed(2)
  return String(n)
}

/** 清理 HTML、RUBY 标记、LINK 占位符、换行符 */
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
    BreakStun: '击破',
  }
  return labels[key] || key
}
