/**
 * 崩坏：星穹铁道角色构建（HSR）
 * 将 nanoka 星铁条目 JSON 归一化为统一角色模板数据
 */
import { buildSkillParams } from './skillParams.js'
import { imgUrl, propLabel, skillTag, cleanText } from '../util.js'

/**
 * 替换星铁描述中的参数占位符与 <unbreak> 标签
 * 格式：#N[i] 整数 / #N[f1] 1位小数；<unbreak>值</unbreak> 保留内文去标签
 * 占位符 #N 对应 paramList[N-1]；占位符后紧跟 % 时值 ×100（0.3 → 30%），否则原值（算式系数/次数）
 * @param {string} text
 * @param {Array} paramList
 * @returns {string}
 */
function resolveHsrParams (text, paramList) {
  if (!text) return ''
  const fmtVal = (n, fmt, isPct) => {
    let val = paramList?.[Number(n) - 1]
    if (val == null) return null
    // 百分比语义：星铁 percent 型数值以比例存储，param<1 时 ×100（0.3→30%），
    // param>=1 时已是百分比数值直接显示（1→1%，避免 100% 误显示）
    if (isPct && Number(val) < 1) val = Number(val) * 100
    if (fmt === 'i') return String(Math.round(val))
    if (fmt === 'f1') return Number(val).toFixed(1)
    return String(val)
  }
  // 处理 <unbreak> 包裹：内部占位符按后随 % 决定倍率
  let out = text.replace(/<unbreak>([^<]*)<\/unbreak>/g, (m, inner) =>
    inner.replace(/#(\d+)\[([^\]]+)\]/g, (mm, n, fmt) => {
      const isPct = inner.slice(inner.indexOf(mm) + mm.length, inner.indexOf(mm) + mm.length + 1) === '%'
      const v = fmtVal(n, fmt, isPct)
      return v == null ? mm : v
    })
  )
  // 兜底处理未包裹 <unbreak> 的裸占位符（含其后 % 判断）
  out = out.replace(/#(\d+)\[([^\]]+)\](%?)/g, (m, n, fmt, pct) => {
    const v = fmtVal(n, fmt, pct === '%')
    return v == null ? m : v + pct
  })
  return out
}

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

  // 技能 → 图标映射：skill_trees 节点 level_up_skill_id[0] 指向技能 id，节点自带图标路径
  const skillIconMap = new Map()
  if (detail.skill_trees && typeof detail.skill_trees === 'object') {
    for (const [treeKey, tree] of Object.entries(detail.skill_trees)) {
      for (const [nodeKey, node] of Object.entries(tree || {})) {
        const ids = node?.level_up_skill_id
        if (!ids || !Array.isArray(ids) || ids.length === 0) continue
        const icon = img(`detail.skill_trees.${treeKey}.${nodeKey}.icon`)
        for (const id of ids) {
          if (!skillIconMap.has(String(id))) skillIconMap.set(String(id), icon)
        }
      }
    }
  }

  // 技能（enhanced.skills 按顺序对应加强版 desc；图标经 skill_trees 锚点关联）
  if (detail.skills && typeof detail.skills === 'object') {
    const enhSkills = enhanced?.skills && typeof enhanced.skills === 'object'
      ? Object.values(enhanced.skills)
      : null
    const skillFields = Object.entries(detail.skills).map(([key, s], idx) => {
      const enh = enhSkills?.[idx] || null
      const levelData = enh?.level || s.level
      // param_list 取首级（等级 1）作为展示参数
      const firstLv = levelData && typeof levelData === 'object'
        ? levelData[Object.keys(levelData).find(k => /^\d+$/.test(k))] || null
        : null
      const rawDesc = enh?.desc || enh?.simple_desc || s.desc || s.simple_desc || ''
      return {
        name: s.name || '',
        tag: skillTag(s.type || s.type_name || '', 'hsr'),
        icon: skillIconMap.get(String(s.id)) || img(`detail.skills.${key}.level.0.icon`),
        desc: cleanText(resolveHsrParams(rawDesc, firstLv?.param_list)),
        params: buildSkillParams(levelData, 'hsr')
      }
    })
    sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
  }

  // 行迹：取锚点唯一节点（普攻/战技/终结技/天赋/秘技 + 被动），名称用关联技能名或 point_desc
  if (detail.skill_trees && typeof detail.skill_trees === 'object') {
    const skillNameById = new Map()
    for (const s of Object.values(detail.skills || {})) {
      if (s?.id != null && s.name) skillNameById.set(String(s.id), s.name)
    }
    const extras = []
    for (const [treeKey, tree] of Object.entries(detail.skill_trees)) {
      for (const [nodeKey, node] of Object.entries(tree || {})) {
        // 仅取锚点唯一节点（每棵树的第一个等级节点），避免 point01 的 6 级重复
        if (tree && Object.keys(tree)[0] !== nodeKey) continue
        const id = node?.level_up_skill_id?.[0]
        const enhNode = enhanced?.skill_trees?.[treeKey]?.[nodeKey] || null
        const traceDesc = resolveHsrParams(enhNode?.point_desc || node?.point_desc || '', enhNode?.param_list || node?.param_list)
        const skillName = (id != null && skillNameById.get(String(id))) || ''
        // 过滤纯属性占位树（无技能关联且无被动描述，如 point09-18 属性强化）
        if (!skillName && !traceDesc) continue
        extras.push({
          name: skillName || traceDesc || node?.anchor || '',
          desc: cleanText(traceDesc || ''),
          icon: img(`detail.skill_trees.${treeKey}.${nodeKey}.icon`)
        })
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
          desc: cleanText(resolveHsrParams(enhRank?.desc || r.desc || '', enhRank?.param_list || r.param_list))
        }
      })
    sections.push({ title: '星魂', type: 'constellation-grid', items: conList })
  }

  return { hero, metaFields, sections, _images: images }
}