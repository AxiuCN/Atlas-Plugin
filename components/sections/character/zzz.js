/**
 * 绝区零角色构建（ZZZ）
 * 将 nanoka 绝区零条目 JSON 归一化为统一角色模板数据
 */
import { imgUrl, propLabel, cleanText } from '../util.js'

/** 生日字符串 → "X月X日"（原神格式对齐）："6/19" / "05/02" → "6月19日" / "5月2日" */
function _formatZzzBirthday (birth) {
  if (!birth || typeof birth !== 'string') return ''
  const m = birth.trim().match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!m) return ''
  return `${Number(m[1])}月${Number(m[2])}日`
}

/**
 * 构建绝区零角色数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object|null} { hero, metaFields, sections, _images }
 */
export function buildZZZ (list, detail, meta) {
  const images = meta?.images || []
  const img = (fp) => imgUrl(images, fp)
  const sections = []

  const elementType = detail.element_type ? Object.values(detail.element_type)[0] : ''
  const weaponType = detail.weapon_type ? Object.values(detail.weapon_type)[0] : ''

  // 立绘后景：优先角色皮肤图（meta.images 中 skin.* 的 fieldPath，通常竖版立绘），退角色图标
  const skinField = Array.isArray(images)
    ? images.filter(i => i.fieldPath?.startsWith('skin.') && i.status === 'downloaded').pop()?.fieldPath
    : ''
  const hero = {
    namecard: skinField ? img(skinField) : (img('icon') || img('detail.icon')),
    portrait: img('detail.partner_info.icon_path') || img('icon') || img('detail.icon'),
    title: '',
    element: elementType || list.element || '',
    weapon: weaponType || list.specialty || '',
    birthday: _formatZzzBirthday(detail.partner_info?.birthday),
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
        metaFields.push({ label: propLabel(key), value: String(detail.stats[key]) })
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
          desc = cleanText(main.desc || '')
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
      desc: cleanText(p.desc || ''),
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
        desc: cleanText(t.desc || '')
      }))
    sections.push({ title: '影画', type: 'constellation-grid', items: conList })
  }

  // 资料
  if (detail.partner_info) {
    const pi = detail.partner_info
    const stories = []
    if (pi.profile_desc) stories.push({ title: '简介', content: cleanText(pi.profile_desc) })
    if (pi.birthday) metaFields.push({ label: '生日', value: pi.birthday })
    if (pi.full_name) metaFields.push({ label: '全名', value: pi.full_name })
    if (pi.stature) metaFields.push({ label: '身高', value: pi.stature })
    if (stories.length > 0) {
      sections.push({ title: '资料', type: 'stories', items: stories })
    }
  }

  return { hero, metaFields, sections, _images: images }
}