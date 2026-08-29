/**
 * 原神角色构建（GI）
 * 将 nanoka 原神条目 JSON 归一化为统一角色模板数据
 */
import { resolveLinks } from '../../../model/LinkResolver.js'
import { buildSkillParams } from './skillParams.js'
import { imgUrl, elementLabel, weaponLabel, formatBirthday, fmtPercent, cleanForRender, skillTag, passiveUnlock } from '../util.js'

/**
 * 构建原神角色数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object|null} { hero, metaFields, sections, _images }
 */
export function buildGI (list, detail, meta) {
  const images = meta?.images || []
  const img = (fp) => imgUrl(images, fp)

  // ── Hero 区块 ──
  const hero = {
    namecard: img('detail.chara_info.namecard.icon'),
    portrait: img('icon') || img('detail.icon'),
    title: detail.chara_info?.title || '',
    element: detail.chara_info?.vision || elementLabel(list.element || ''),
    weapon: weaponLabel(list.weapon || detail.weapon || ''),
    birthday: formatBirthday(list.birth || detail.chara_info?.birth),
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
          metaFields.push({ label: label, value: fmtPercent(v) })
          break
        }
      }
    }
  }

  const sections = []

  // ── 技能（含 LINK refs 收集，refs 汇总到命座后独立栏）──
  const allRefs = [] // 去重后的相关效果 [{name, desc}]
  const refSeen = new Set() // 按名称去重（refs 数据本唯一，重复仅因多技能各自收集）
  const collectRefs = (refs) => {
    for (const ref of refs) {
      if (!ref.name || refSeen.has(ref.name)) continue
      refSeen.add(ref.name)
      allRefs.push(ref)
    }
  }

  if (detail.skills && Array.isArray(detail.skills)) {
    const skillFields = detail.skills.map((s, i) => {
      const { resolved, refs } = resolveLinks(s.desc || '', 'gi')
      collectRefs(refs)
      return {
        name: s.name || '',
        tag: skillTag(s.name, 'gi'),
        icon: img(`detail.skills.${i}.promote.0.icon`),
        desc: cleanForRender(resolved),
        params: buildSkillParams(s.promote, 'gi')
      }
    })
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // ── 固有天赋（技能与命座之间，refs 一并收集进相关效果栏）──
  if (detail.passives && Array.isArray(detail.passives)) {
    const extras = detail.passives.map((p, i) => {
      const { resolved, refs } = resolveLinks(p.desc || '', 'gi')
      collectRefs(refs)
      const unlockLabel = passiveUnlock(p.unlock)
      return {
        name: unlockLabel ? `${p.name}（${unlockLabel}）` : p.name,
        desc: cleanForRender(resolved),
        icon: img(`detail.passives.${i}.icon`)
      }
    }).filter(e => e.name)
    if (extras.length > 0) {
      sections.push({ title: '固有天赋', type: 'list', items: extras })
    }
  }

  // ── 命之座（refs 一并收集进相关效果栏）──
  if (detail.constellations && Array.isArray(detail.constellations)) {
    const conList = detail.constellations.map((c, i) => {
      const { resolved, refs } = resolveLinks(c.desc || '', 'gi')
      collectRefs(refs)
      return {
        order: i + 1,
        name: c.name || '',
        icon: img(`detail.constellations.${i}.icon`),
        desc: cleanForRender(resolved)
      }
    })
    sections.push({ title: '命之座', type: 'constellation-grid', items: conList })
  }

  // ── 相关效果（LINK refs 汇总，独立于技能栏，置于命座之后）──
  if (allRefs.length > 0) {
    sections.push({ title: '相关效果', type: 'list', isRefs: true, items: allRefs })
  }

  return { hero, metaFields, sections, _images: images }
}