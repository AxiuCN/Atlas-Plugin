/**
 * 星铁怪物构建（HSR）
 * 基础属性 + 弱点/抗性 + 技能
 */
import { cleanText, propLabel } from '../util.js'

/**
 * 构建星铁怪物数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { metaFields, sections }
 */
export function buildHSRMonster (list, detail, meta) {
  const metaFields = []
  const keys = ['attack_base', 'defence_base', 'hp_base', 'speed_base', 'stance_base']
  for (const key of keys) {
    if (detail[key] != null) metaFields.push({ label: propLabel(key), value: String(detail[key]) })
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
          desc: cleanText(s.skill_desc || ''),
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