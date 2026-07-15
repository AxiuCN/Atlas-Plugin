/**
 * 邦布 sections builder（仅 ZZZ）
 */
export function buildBangbooData (gameId, record) {
  if (gameId !== 'zzz') return null
  const detail = record?.content?.detail || {}

  const metaFields = [
    { label: '稀有度', value: record?.meta?.rarity || '' }
  ].filter(f => f.value)

  // 基础属性
  if (detail.stats) {
    const statKeys = ['endurance', 'hp_max', 'attack', 'defence', 'break_stun', 'crit', 'crit_dmg', 'pen_ratio']
    for (const key of statKeys) {
      if (detail.stats[key] != null) metaFields.push({ label: _label(key), value: String(detail.stats[key]) })
    }
  }

  const sections = []

  // 技能 A/B/C
  if (detail.skill && typeof detail.skill === 'object') {
    const slotLabels = { a: '主动技 (A)', b: '额外能力 (B)', c: '连携技 (C)' }
    const skills = []
    for (const [slot, sk] of Object.entries(detail.skill)) {
      if (!sk) continue
      let desc = ''
      let params = null
      if (sk.level && typeof sk.level === 'object') {
        const levels = Object.keys(sk.level).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
        if (levels.length > 0) {
          const first = sk.level[levels[0]]
          desc = _clean(first?.desc || '')
          if (first?.property && Array.isArray(first.property)) {
            const headers = ['等级', ...(first.property.map(p => p.name || ''))]
            const rows = levels.map(lv => {
              const l = sk.level[lv]
              const vals = (l?.property || []).map(p => p.param || '')
              return [lv, ...vals]
            })
            params = { headers, rows }
          }
        }
      }
      skills.push({
        name: `${slotLabels[slot] || slot}`,
        tag: '',
        desc,
        params
      })
    }
    sections.push({ title: '技能', type: 'skill-cards', skills })
  }

  // 影画 (talent, 类似角色命座)
  if (detail.talent && typeof detail.talent === 'object') {
    const items = Object.entries(detail.talent)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, t]) => ({
        order: Number(k),
        name: t.name || '',
        desc: _clean(t.desc || '')
      }))
    if (items.length > 0) {
      sections.push({ title: '影画', type: 'constellation-grid', items })
    }
  }

  return { metaFields, sections }
}

function _clean (s) {
  if (!s) return ''
  return String(s).replace(/\{RUBY_B#[^}]*}/g, '').replace(/\{RUBY_E#}/g, '').replace(/<[^>]+>/g, '').trim()
}

function _label (k) {
  const m = {
    endurance: '耐久', hp_max: '生命值', attack: '攻击力',
    defence: '防御力', break_stun: '击破', crit: '暴击率',
    crit_dmg: '暴击伤害', pen_ratio: '穿透率'
  }
  return m[k] || k
}
