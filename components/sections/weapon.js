/**
 * 武器/光锥/音擎 sections builder
 * @param {string} gameId
 * @param {object} record
 * @returns {object} { metaFields, sections }
 */
export function buildWeaponData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  if (gameId === 'gi') return _buildGIWeapon(list, detail, record.meta)
  if (gameId === 'hsr') return _buildHSRLightcone(list, detail, record.meta)
  if (gameId === 'zzz') return _buildZZZWeapon(list, detail, record.meta)
  return null
}

// ========== 原神武器 ==========

function _buildGIWeapon (list, detail, meta) {
  const metaFields = [
    { label: '类型', value: list.weapontype || '' },
    { label: '稀有度', value: meta?.rarity || list.rarity || '' },
  ].filter(f => f.value)

  // 基础属性
  if (detail.weapon_prop && Array.isArray(detail.weapon_prop)) {
    for (const prop of detail.weapon_prop) {
      const label = _propLabel(prop.prop_type || '')
      const value = prop.init_value != null ? String(prop.init_value) : ''
      if (label && value) metaFields.push({ label, value })
    }
  }

  // 副属性
  if (detail.stats_modifier) {
    const sm = detail.stats_modifier
    for (const [key, val] of Object.entries(sm)) {
      if (key === 'atk' && val?.base != null) metaFields.push({ label: '基础攻击力', value: String(val.base) })
      else if (key !== 'atk' && val?.base != null) metaFields.push({ label: _propLabel(key), value: String(val.base) })
    }
  }

  const sections = []

  // 精炼
  if (detail.refinement && typeof detail.refinement === 'object') {
    const refs = Object.entries(detail.refinement)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, r]) => ({
        level: `精炼 ${k}`,
        name: r.name || '',
        desc: _cleanText(r.desc || '')
      }))
    if (refs.length > 0) {
      sections.push({ title: '精炼', type: 'refinements', items: refs })
    }
  }

  return { metaFields, sections }
}

// ========== 星铁光锥 ==========

function _buildHSRLightcone (list, detail, meta) {
  const metaFields = [
    { label: '命途', value: list.baseType || '' },
    { label: '稀有度', value: meta?.rarity || list.rarity || '' },
  ].filter(f => f.value)

  // 基础属性
  if (detail.stats && Array.isArray(detail.stats)) {
    const base = detail.stats[0] || {}
    const statKeys = ['base_hp', 'base_atk', 'base_def', 'base_speed']
    for (const key of statKeys) {
      if (base[key] != null) metaFields.push({ label: _propLabel(key), value: String(base[key]) })
    }
  }

  const sections = []

  // 叠影
  if (detail.refinements) {
    const name = detail.refinements.name || ''
    const desc = _cleanText(detail.refinements.desc || '')
    let refs = []
    if (detail.refinements.level && typeof detail.refinements.level === 'object') {
      refs = Object.entries(detail.refinements.level)
        .filter(([k]) => /^\d+$/.test(k))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([k, r]) => {
          let refDesc = ''
          if (r?.param_list) {
            refDesc = Object.values(r.param_list).join(' / ')
          }
          return { level: `叠影 ${k}`, name, desc: refDesc || desc }
        })
    }
    if (refs.length > 0) {
      sections.push({ title: '叠影', type: 'refinements', items: refs })
    } else if (name || desc) {
      sections.push({
        title: '叠影',
        type: 'refinements',
        items: [{ level: '', name, desc }]
      })
    }
  }

  return { metaFields, sections }
}

// ========== 绝区零音擎 ==========

function _buildZZZWeapon (list, detail, meta) {
  const metaFields = [
    { label: '类型', value: detail.weapon_type ? Object.values(detail.weapon_type)[0] : '' },
    { label: '稀有度', value: meta?.rarity || list.rarity || '' },
  ].filter(f => f.value)

  // 基础属性
  if (detail.base_property) {
    metaFields.push({
      label: detail.base_property.name || '基础属性',
      value: detail.base_property.value != null
        ? `${detail.base_property.value}${detail.base_property.format || ''}`
        : ''
    })
  }
  if (detail.rand_property) {
    metaFields.push({
      label: detail.rand_property.name || '副属性',
      value: detail.rand_property.value != null
        ? `${detail.rand_property.value}${detail.rand_property.format || ''}`
        : ''
    })
  }

  const sections = []

  // 音擎天赋（类似精炼）
  if (detail.talents && typeof detail.talents === 'object') {
    const refs = Object.entries(detail.talents)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, t]) => ({
        level: `等级 ${k}`,
        name: t.name || '',
        desc: _cleanText(t.desc || '')
      }))
    if (refs.length > 0) {
      sections.push({ title: '音擎天赋', type: 'refinements', items: refs })
    }
  }

  return { metaFields, sections }
}

// ========== 工具 ==========

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

function _propLabel (key) {
  const labels = {
    atk: '攻击力', base_atk: '攻击力', hp: '生命值', base_hp: '生命值',
    def: '防御力', base_def: '防御力', base_speed: '速度',
    subStat: '副属性', FIGHT_PROP_CRITICAL: '暴击率',
    FIGHT_PROP_CRITICAL_HURT: '暴击伤害', FIGHT_PROP_CHARGE_EFFICIENCY: '元素充能效率',
    FIGHT_PROP_ELEMENT_MASTERY: '元素精���', FIGHT_PROP_HEAL_ADD: '治疗加成',
    FIGHT_PROP_PHYSICAL_ADD_HURT: '物理伤害加成',
  }
  return labels[key] || key
}
