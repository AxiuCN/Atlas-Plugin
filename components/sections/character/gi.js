/**
 * 原神角色构建（GI）
 * 将 nanoka 原神条目 JSON 归一化为统一角色模板数据
 */
import { resolveLinks } from '../../../model/LinkResolver.js'
import { buildSkillParams } from './skillParams.js'
import { imgUrl, galleryUrl, weaponLabel, formatBirthday, cleanMarkup, skillTag, passiveUnlock, giPropInfo, formatGiProp, GI_PROP_KEYS } from '../util.js'
import { ELEMENT_CN } from '../../constants.js'
import { familyName } from '../../protagonist.js'

/** 奇偶（千星奇域人偶主角）各元素形态的 hero 背景：人偶名片 */
const GI_MANEKIN_NAMECARD = 'UI_NameCardIcon_MarionetteNew'

/**
 * 旅行者各元素形态的 hero 背景：取对应地区的名片纹饰（数据里名片条目自带该资产，但旅行者条目未引用）
 * 无属性形态即枪主（第三人称射击旅行者），用 TPS 名片
 */
const GI_TRAVELER_NAMECARD = {
  Anemo: 'UI_NameCardIcon_Md', // 蒙德·风吟
  Geo: 'UI_NameCardIcon_Ly', // 璃月·岩寂
  Electro: 'UI_NameCardIcon_Daoqi1', // 稻妻·九条之纹
  Dendro: 'UI_NameCardIcon_Xumi1', // 须弥·照览
  Hydro: 'UI_NameCardIcon_Fontaine1', // 枫丹·奇械
  Pyro: 'UI_NameCardIcon_Natlan1', // 纳塔·归火（远端缺图，本地无文件时留空）
  Cryo: 'UI_NameCardIcon_Snezhnaya1', // 至冬·长夜
  None: 'UI_NameCardIcon_Tps1' // 至冬·梭影（枪主）
}

/**
 * 构建原神角色数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @param {object} [opts] - 索引附加数据：indexName（变体展示名）、siblingRecord（折叠掉的另一性别形态）
 * @returns {object|null} { hero, metaFields, sections, _images, recordName }
 */
export function buildGI (list, detail, meta, opts = {}) {
  const images = meta?.images || []
  const img = (fp) => imgUrl(images, fp)

  // 多形态角色（旅行者 / 奇偶）折叠后，hero 头像取男女两形态合体（左下-右上对角线划分）
  const siblingImages = opts.siblingRecord?.meta?.images || []
  const portrait = img('icon') || img('detail.icon')
  const portrait2 = siblingImages.length
    ? (imgUrl(siblingImages, 'icon') || imgUrl(siblingImages, 'detail.icon'))
    : ''

  // ── Hero 区块 ──
  // 主角 chara_info.vision 为「无」，元素改取 list.element（数据源元素码）
  const vision = detail.chara_info?.vision || ''
  // 旅行者（含无属性的枪主）自身无名片字段，hero 背景按元素取对应地区名片；奇偶取人偶名片
  const family = familyName('gi', meta?.name || list.zh || '')
  const familyCard = family === '旅行者'
    ? GI_TRAVELER_NAMECARD[list.element || detail.element]
    : (family === '奇偶' ? GI_MANEKIN_NAMECARD : '')
  const hero = {
    namecard: img('detail.chara_info.namecard.icon') || galleryUrl('gi', familyCard),
    portrait,
    portrait2,
    title: detail.chara_info?.title || '',
    element: (vision && vision !== '无') ? vision : (ELEMENT_CN[list.element] || ''),
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

    // 突破属性（第 6 次突破）——共用 GI_PROP 映射（与武器副属性同源）
    const asc = sm.ascension
    if (asc && asc.length > 0) {
      const last = asc[asc.length - 1] || {}
      for (const key of GI_PROP_KEYS) {
        const { label, kind } = giPropInfo(key, '突破 · ')
        const v = last[key]
        if (v == null || Number(v) === 0) continue
        metaFields.push({ label, value: formatGiProp(v, kind) })
        break
      }
    }
  }

  const sections = []

  // 星烁加强优先取特殊描述：special===true 且存在 special_desc 时用加强版，否则旧 desc
  const pickDesc = (item) => {
    if (!item) return ''
    if (item.special === true && item.special_desc) return item.special_desc
    return item.desc || ''
  }

  // ── 技能（含 LINK refs 收集，refs 汇总到命座后独立栏）──
  const allRefs = [] // 去重后的相关效果 [{name, desc}]
  const refSeen = new Set() // 按名称去重（refs 数据本唯一，重复仅因多技能各自收集）
  const collectRefs = (refs) => {
    for (const ref of refs) {
      if (!ref.name || refSeen.has(ref.name)) continue
      refSeen.add(ref.name)
      // refs desc 由 LinkResolver 产出（<span style="color:#RRGGBB(AA)"> 与转义 \n 未处理），
      // 与其它描述一致走 cleanMarkup：归一 6 位色号、转义换行，并剥除多余标签
      allRefs.push({ name: ref.name, desc: cleanMarkup(ref.desc) })
    }
  }

  if (detail.skills && Array.isArray(detail.skills)) {
    const skillFields = detail.skills.map((s, i) => {
      const { resolved, refs } = resolveLinks(pickDesc(s), 'gi')
      collectRefs(refs)
      return {
        name: s.name || '',
        tag: skillTag(s.name, 'gi'),
        icon: img(`detail.skills.${i}.promote.0.icon`),
        desc: cleanMarkup(resolved),
        params: buildSkillParams(s.promote, 'gi'),
        // 全等级转置表（倍率视图用，宽度自适应不抽样）
        paramsAll: buildSkillParams(s.promote, 'gi', { allLevels: true })
      }
    })
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // ── 固有天赋（技能与命座之间，refs 一并收集进相关效果栏）──
  if (detail.passives && Array.isArray(detail.passives)) {
    const extras = detail.passives.map((p, i) => {
      const { resolved, refs } = resolveLinks(pickDesc(p), 'gi')
      collectRefs(refs)
      const unlockLabel = passiveUnlock(p.unlock)
      return {
        name: unlockLabel ? `${p.name}（${unlockLabel}）` : p.name,
        desc: cleanMarkup(resolved),
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
      const { resolved, refs } = resolveLinks(pickDesc(c), 'gi')
      collectRefs(refs)
      return {
        order: i + 1,
        name: c.name || '',
        icon: img(`detail.constellations.${i}.icon`),
        desc: cleanMarkup(resolved)
      }
    })
    sections.push({ title: '命之座', type: 'constellation-grid', items: conList })
  }

  // ── 相关效果/规则术语（LINK refs 汇总，独立于技能栏，置于命座之后）──
  if (allRefs.length > 0) {
    sections.push({ title: '相关效果/规则术语', type: 'list', isRefs: true, items: allRefs })
  }

  return { hero, metaFields, sections, _images: images, recordName: opts.indexName || '' }
}