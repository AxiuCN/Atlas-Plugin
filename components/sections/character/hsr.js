/**
 * 崩坏：星穹铁道角色构建（HSR）
 * 将 nanoka 星铁条目 JSON 归一化为统一角色模板数据
 */
import { buildSkillParams } from './skillParams.js'
import { imgUrl, propLabel, skillTag, cleanText } from '../util.js'

/**
 * 构建星铁角色数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object|null} { hero, metaFields, sections, _images }
 */
export function buildHSR (list, detail, meta) {
  const images = meta?.images || []
  const img = (fp) => imgUrl(images, fp)
  const sections = []

  // 星烁加强（enhanced 集中覆盖档案）：单档位键 '1'，含加强版技能/行迹/星魂
  const enhanced = (detail.enhanced && typeof detail.enhanced === 'object')
    ? detail.enhanced[Object.keys(detail.enhanced)[0]]
    : null

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
      label: propLabel(p.property_type || ''),
      value: `${p.base || ''}${p.add ? ' + ' + p.add : ''}`
    }))
    metaFields.push(...propFields)
  }

  // 技能（enhanced.skills 按顺序对应加强版 desc）
  if (detail.skills && typeof detail.skills === 'object') {
    const enhSkills = enhanced?.skills && typeof enhanced.skills === 'object'
      ? Object.values(enhanced.skills)
      : null
    const skillFields = Object.entries(detail.skills).map(([key, s], idx) => {
      const enh = enhSkills?.[idx] || null
      return {
        name: s.name || '',
        tag: skillTag(s.type || s.type_name || '', 'hsr'),
        icon: img(`detail.skills.${key}.level.0.icon`),
        desc: cleanText(enh?.desc || enh?.simple_desc || s.desc || s.simple_desc || ''),
        params: buildSkillParams(enh?.level || s.level, 'hsr')
      }
    })
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // 行迹（enhanced.skill_trees 同键覆盖 point_desc）
  if (detail.skill_trees && typeof detail.skill_trees === 'object') {
    const extras = []
    for (const [treeKey, tree] of Object.entries(detail.skill_trees)) {
      if (tree && typeof tree === 'object') {
        for (const [nodeKey, node] of Object.entries(tree)) {
          if (node?.anchor && node.anchor !== 'Point01') continue
          if (node?.level_up_skill_id) {
            const enhNode = enhanced?.skill_trees?.[treeKey]?.[nodeKey] || null
            extras.push({
              name: node.anchor || '',
              desc: cleanText(enhNode?.point_desc || node.point_desc || ''),
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

  // 星魂（enhanced.ranks 同键覆盖 desc）
  if (detail.ranks && typeof detail.ranks === 'object') {
    const conList = Object.entries(detail.ranks)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, r]) => {
        const enhRank = enhanced?.ranks?.[k] || null
        return {
          order: Number(r.id || 0),
          name: enhRank?.name || r.name || '',
          icon: img(`detail.ranks.${k}.icon`),
          desc: cleanText(enhRank?.desc || r.desc || '')
        }
      })
    sections.push({ title: '星魂', type: 'constellation-grid', items: conList })
  }

  return { hero, metaFields, sections, _images: images }
}