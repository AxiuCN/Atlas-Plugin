/**
 * 敌人/怪物 sections builder
 */
export function buildMonsterData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  if (gameId === 'gi') return _buildGIMonster(list, detail, record.meta)
  if (gameId === 'hsr') return _buildHSRMonster(list, detail, record.meta)
  if (gameId === 'zzz') return _buildZZZMonster(list, detail, record.meta)
  return null
}

function _buildGIMonster (list, detail, meta) {
  const metaFields = [
    { label: '类型', value: detail.codex || list.type || '' }
  ].filter(f => f.value)

  const sections = []

  // 子怪物/变体
  if (detail.child && typeof detail.child === 'object') {
    const variants = Object.values(detail.child).map(c => {
      const stats = []
      if (c.base) {
        for (const [k, v] of Object.entries(c.base)) {
          if (v != null) stats.push(`${_label(k)}: ${v}`)
        }
      }
      return {
        name: c.monster_name || c.name || '',
        desc: stats.join(' / '),
        type: c.type || ''
      }
    }).filter(v => v.name)

    if (variants.length > 0) {
      // 取第一个变体的属性
      const first = detail.child[Object.keys(detail.child)[0]]
      if (first?.base) {
        for (const [k, v] of Object.entries(first.base)) {
          if (v != null) metaFields.push({ label: _label(k), value: String(v) })
        }
      }
      sections.push({ title: '变体', type: 'list', items: variants.map(v => ({
        name: v.name, desc: v.desc
      })) })
    }
  }

  return { metaFields, sections }
}

function _buildHSRMonster (list, detail, meta) {
  const metaFields = []
  const keys = ['attack_base', 'defence_base', 'hp_base', 'speed_base', 'stance_base']
  for (const key of keys) {
    if (detail[key] != null) metaFields.push({ label: _label(key), value: String(detail[key]) })
  }

  const sections = []

  if (detail.child && Array.isArray(detail.child)) {
    // 弱点
    for (const child of detail.child) {
      if (child.stance_weak_list && Array.isArray(child.stance_weak_list)) {
        metaFields.push({
          label: '弱点',
          value: child.stance_weak_list.join(' / ')
        })
      }
      if (child.damage_type_resistance && Array.isArray(child.damage_type_resistance)) {
        const resist = child.damage_type_resistance.map(r =>
          `${r.damage_type || ''}: ${r.value != null ? r.value : ''}`
        ).join(', ')
        if (resist) metaFields.push({ label: '抗性', value: resist })
      }
      // 技能
      if (child.skill_list && Array.isArray(child.skill_list)) {
        const skills = child.skill_list.map(s => ({
          name: s.skill_name || '',
          desc: _clean(s.skill_desc || ''),
          type: s.damage_type || ''
        }))
        if (skills.length > 0) {
          sections.push({ title: '技能', type: 'list', items: skills.map(s => ({
            name: `${s.name}${s.type ? ' [' + s.type + ']' : ''}`,
            desc: s.desc
          })) })
        }
      }
      break // 只取第一个 child
    }
  }

  return { metaFields, sections }
}

function _buildZZZMonster (list, detail, meta) {
  const metaFields = []

  if (detail.monster_info && typeof detail.monster_info === 'object') {
    for (const [, info] of Object.entries(detail.monster_info)) {
      if (info.type) metaFields.push({ label: '类型', value: info.type })
      if (info.tag && Array.isArray(info.tag)) metaFields.push({ label: '标签', value: info.tag.join(' / ') })
      if (info.element && typeof info.element === 'object') {
        metaFields.push({ label: '属性', value: Object.keys(info.element).join(' / ') })
      }
      if (info.stats) {
        for (const [k, v] of Object.entries(info.stats)) {
          if (v != null) metaFields.push({ label: _label(k), value: String(v) })
        }
      }
      break
    }
  }

  return { metaFields, sections: [] }
}

function _clean (s) {
  if (!s) return ''
  return String(s).replace(/\{RUBY_B#[^}]*}/g, '').replace(/\{RUBY_E#}/g, '').replace(/<[^>]+>/g, '').trim()
}

function _label (k) {
  const m = {
    attack_base: '攻击力', hp_base: '生命值', defence_base: '防御力',
    speed_base: '速度', stance_base: '韧性', hp: '生命值', atk: '攻击力',
    def: '防御力', em: '元素精通', hp_max: '生命值', attack: '攻击力',
    defence: '防御力', crit: '暴击率', crit_damage: '暴击伤害',
    stun: '击破', pen_rate: '穿透率'
  }
  return m[k] || k
}
