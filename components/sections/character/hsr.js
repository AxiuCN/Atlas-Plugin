/**
 * 崩坏：星穹铁道角色构建（HSR）
 * 将 nanoka 星铁条目 JSON 归一化为统一角色模板数据
 *
 * 数据要点：
 * - 星铁条目无 detail.properties，基础属性取自 detail.stats 最高突破档：
 *   满级（80 级）值 = *_base + 79 × *_add，与 miao-plugin meta-sr 的 baseAttr 一致
 * - 行迹体系在 detail.skill_trees，按 point_type 区分：
 *   1 = 属性加成（恒 10 个节点，汇总为「总属性加成」栏）
 *   2 = 主技能树（与 detail.skills 内容重复，不单独展示）
 *   3 = 附加能力（恒 3 条，point_name 为名称）
 *   4 / 5 = 忆灵技 / 忆灵天赋（point_type 5 为仅有描述的忆灵额外天赋）
 * - 忆灵技能数据在 detail.memosprite.skills，键即 point_type 4 节点的 level_up_skill_id；
 *   栏目为「忆灵技能」，忆灵名 + 忆灵图标单独成子栏，其下按技能自身 type_name 分「忆灵技 / 忆灵天赋」
 * - 栏目顺序：技能 → 忆灵技能 → 附加能力 → 总属性加成 → 星魂 → 升级素材
 */
import { buildSkillParams } from './skillParams.js'
import { imgUrl, skillTag, cleanText, hsrLabel } from '../util.js'
import { aggregateMats } from '../materials.js'
import { getHsrItemName, getHsrItemIcon } from '../../../model/itemIndex/hsr.js'

/** 属性加成为固定数值（非比例）的星铁属性类型 */
const HSR_STAT_FLAT = new Set(['SpeedDelta'])

/** 技能类型排序权重（普攻 → 战技 → 终结技 → 天赋 → 秘技 → 其他） */
const HSR_SKILL_ORDER = { Normal: 0, BPSkill: 1, Ultra: 2, Maze: 3, ElationDamage: 4, Assist: 5 }

/** 忆灵技能的两个分类（memosprite.skills 的 type_name） */
const SPRITE_SKILL = '忆灵技'
const SPRITE_TALENT = '忆灵天赋'

/** 满级等级（基础属性按 80 级计算，成长级数 = 80 - 1） */
const HSR_MAX_LEVEL = 80

/**
 * 从技能描述提取各参数索引的展示格式
 * HSR param_list 为无标签数组，格式只能由描述中的 `#N[fmt]%` 推断：
 * 带 `%` → 比例值（渲染时 ×100）；`i` → 取整；`f1`/`f2` → 保留对应小数位
 * @param {string} desc - 技能描述
 * @returns {Object<number, {kind: 'percent'|'num', decimals: number}>}
 */
function hsrParamFormats (desc) {
  const formats = {}
  const re = /#(\d+)\[([^\]]+)\](%?)/g
  let m
  while ((m = re.exec(String(desc || '')))) {
    const idx = Number(m[1]) - 1
    const decimals = Number((m[2].match(/f(\d+)/) || [])[1] || 0)
    const kind = m[3] === '%' ? 'percent' : 'num'
    // 同一参数在描述中多次出现时以百分比为准（语义更完整）
    if (!formats[idx] || kind === 'percent') formats[idx] = { kind, decimals }
  }
  return formats
}

/**
 * 替换星铁描述中的参数占位符
 * 格式：#N[i] 整数 / #N[f1] 1 位小数；占位符后紧跟 % 时值 ×100（0.3 → 30%，2 → 200%）
 * <unbreak> 仅作显示包裹，剥除标签后统一处理占位符
 * @param {string} text
 * @param {Array} paramList
 * @returns {string}
 */
function resolveHsrParams (text, paramList) {
  if (!text) return ''
  return String(text)
    .replace(/<\/?unbreak>/g, '')
    .replace(/#(\d+)\[([^\]]+)\](%?)/g, (m, n, fmt, pct) => {
      const val = paramList?.[Number(n) - 1]
      if (val == null) return m
      let out = Number(val)
      if (Number.isNaN(out)) return m
      if (pct === '%') out = out * 100
      if (fmt === 'i') out = Math.round(out)
      else if (/^f\d+$/.test(fmt)) out = Number(out).toFixed(Number(fmt.slice(1)))
      return out + pct
    })
}

/**
 * 合并两份参数格式表：仅补充 base 缺失的索引（percent 可覆盖 num）
 * @param {object} base
 * @param {object} extra
 * @returns {object}
 */
function mergeFormats (base, extra) {
  const out = { ...base }
  for (const [k, v] of Object.entries(extra || {})) {
    if (!out[k] || (v.kind === 'percent' && out[k].kind !== 'percent')) out[k] = v
  }
  return out
}

/** 等级数据 → 首级 param_list（描述内联数值按首级展示） */function firstLevelParams (levelData) {
  if (!levelData || typeof levelData !== 'object') return null
  const key = Object.keys(levelData).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))[0]
  return key == null ? null : levelData[key]?.param_list || null
}

/** 技能类型排序值（天赋无 type 字段，排在终结技与秘技之间） */
function hsrSkillOrder (s) {
  if (s?.type == null) return 2.5
  return HSR_SKILL_ORDER[s.type] ?? 9
}

/**
 * 基础属性（80 级）：stats 最高突破档基准值 + 成长值
 * @param {object} detail
 * @returns {Array<{label:string, value:string}>}
 */
function buildBaseStats (detail) {
  const entries = Object.entries(detail.stats || {})
    .filter(([k]) => /^\d+$/.test(k))
    .sort(([a], [b]) => Number(a) - Number(b))
  const top = entries.length ? entries[entries.length - 1][1] : null
  if (!top) return []

  const growth = HSR_MAX_LEVEL - 1
  const fields = []
  const pushSum = (label, base, add) => {
    if (base == null) return
    fields.push({ label, value: String(Math.round(Number(base) + growth * Number(add || 0))) })
  }
  pushSum('基础生命值', top.hp_base, top.hp_add)
  pushSum('基础攻击力', top.attack_base, top.attack_add)
  pushSum('基础防御力', top.defence_base, top.defence_add)
  if (top.speed_base != null) fields.push({ label: '基础速度', value: String(top.speed_base) })
  if (top.base_aggro != null) fields.push({ label: '嘲讽', value: String(top.base_aggro) })
  if (detail.sp_need != null) fields.push({ label: '能量上限', value: String(detail.sp_need) })
  return fields
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
  const enhanced = (detail.enhanced && typeof detail.enhanced === 'object' && !Array.isArray(detail.enhanced))
    ? detail.enhanced[Object.keys(detail.enhanced)[0]]
    : null

  // Hero
  // 头像用商店头像（avatarshopicon）；立绘用 avatarDrawCard 覆盖 hero 右半（landscape）
  const hero = {
    namecard: '',
    namecardImages: null,
    landscape: img('derived.avatarDrawCard') || img('icon') || img('detail.icon'),
    portrait: img('icon') || img('detail.icon'),
    title: '',
    element: hsrLabel(list.damageType || detail.damage_type || ''),
    weapon: hsrLabel(list.baseType || detail.base_type || ''),
    birthday: '',
    constellation: '',
    rarity: meta?.rarity || list.rarity || ''
  }

  // 行迹节点：每棵树只取首个等级节点（同一节点的各级重复）
  const traceNodes = []
  if (detail.skill_trees && typeof detail.skill_trees === 'object') {
    for (const [treeKey, tree] of Object.entries(detail.skill_trees)) {
      const nodeKey = Object.keys(tree || {})[0]
      if (nodeKey == null) continue
      traceNodes.push({ treeKey, nodeKey, node: tree[nodeKey] })
    }
  }

  // ── 属性概览：阵营 + 基础属性（80 级）──
  const metaFields = []
  if (detail.chara_info?.camp) {
    metaFields.push({ label: '阵营', value: detail.chara_info.camp })
  }
  metaFields.push(...buildBaseStats(detail))

  // 总属性加成：point_type 1 各节点 status_add_list 按属性累加（标签取数据自带中文名），
  // 独立成栏置于附加能力之后
  const bonusMap = new Map()
  for (const { node } of traceNodes) {
    if (node.point_type !== 1) continue
    for (const st of node.status_add_list || []) {
      const key = st.property_type || st.name
      if (!key) continue
      const cur = bonusMap.get(key) || { name: st.name || key, sum: 0 }
      cur.sum += Number(st.value) || 0
      bonusMap.set(key, cur)
    }
  }
  const bonusItems = []
  for (const [key, { name, sum }] of bonusMap) {
    const value = HSR_STAT_FLAT.has(key)
      ? String(Math.round(sum * 100) / 100)
      : (sum * 100).toFixed(1) + '%'
    bonusItems.push({ label: name, value })
  }

  // 技能 → 图标映射：skill_trees 节点 level_up_skill_id 指向技能 id，节点自带图标路径
  const skillIconMap = new Map()
  if (detail.skill_trees && typeof detail.skill_trees === 'object') {
    for (const [treeKey, tree] of Object.entries(detail.skill_trees)) {
      for (const [nodeKey, node] of Object.entries(tree || {})) {
        const ids = node?.level_up_skill_id
        if (!ids || !Array.isArray(ids) || ids.length === 0) continue
        const icon = img(`detail.skill_trees.${treeKey}.${nodeKey}.icon`)
        for (const id of ids) {
          if (!String(id)) continue
          if (!skillIconMap.has(String(id))) skillIconMap.set(String(id), icon)
        }
      }
    }
  }

  // 参数格式表：部分技能仅有简略描述（无占位符），按技能名汇总互补
  const spriteSkills = detail.memosprite?.skills || {}
  const formatsByName = new Map()
  const collectFormats = (s) => {
    if (!s?.name) return
    const own = mergeFormats(hsrParamFormats(s.desc), hsrParamFormats(s.simple_desc))
    formatsByName.set(s.name, mergeFormats(formatsByName.get(s.name) || {}, own))
  }
  for (const s of Object.values(detail.skills || {})) collectFormats(s)
  for (const s of Object.values(spriteSkills)) collectFormats(s)

  /**
   * 技能参数格式：优先本技能描述，其次同名技能（同一技能的不同版本可互补）
   * @param {object} s
   * @param {string} [rawDesc] - 加强版描述（enhanced 覆盖时与 s.desc 不同）
   */
  const skillFormats = (s, rawDesc) =>
    mergeFormats(hsrParamFormats(rawDesc ?? s.desc ?? s.simple_desc), formatsByName.get(s.name) || {})

  /**
   * 技能条目归一化（技能区与忆灵组共用）
   * @param {object} s - 技能原始数据
   * @param {object} formats - 参数格式表
   * @param {string} [iconPath] - 图标 fieldPath
   * @param {boolean} [plain] - 忆灵技能：不带图标与类型标签（类型由分组标题表达）
   * @returns {object}
   */
  const toSkillField = (s, formats, iconPath, plain = false) => {
    const rawDesc = s.desc || s.simple_desc || ''
    return {
      name: s.name || '',
      tag: plain ? '' : (s.type_name || skillTag(s.type || '', 'hsr')),
      icon: !plain && iconPath ? img(iconPath) : '',
      desc: cleanText(resolveHsrParams(rawDesc, firstLevelParams(s.level))),
      params: buildSkillParams(s.level, 'hsr', { formats })
    }
  }

  // ── 忆灵技能（point_type 4 / 5）：忆灵单独成子栏，其下按忆灵技 / 忆灵天赋分类 ──
  const sprite = Object.keys(spriteSkills).length > 0 ? detail.memosprite : null
  const spriteSeen = new Set()
  const spriteByType = new Map() // type_name → 技能条目[]
  const spriteTypeIcons = new Map() // type_name → 分类图标（取所属 skill_trees 节点图标）
  for (const { treeKey, nodeKey, node } of traceNodes) {
    if (node.point_type !== 4) continue
    const nodeIcon = img(`detail.skill_trees.${treeKey}.${nodeKey}.icon`)
    for (const id of node.level_up_skill_id || []) {
      const key = String(id)
      if (spriteSeen.has(key)) continue
      const skill = spriteSkills[key] || detail.skills?.[key]
      if (!skill) continue
      spriteSeen.add(key)
      const type = skill.type_name || ''
      if (!spriteTypeIcons.has(type)) spriteTypeIcons.set(type, nodeIcon)
      if (!spriteByType.has(type)) spriteByType.set(type, [])
      spriteByType.get(type).push(toSkillField(skill, skillFormats(skill), null, true))
    }
  }
  // point_type 5：忆灵额外天赋（仅有描述），并入忆灵天赋分类
  for (const { node } of traceNodes) {
    if (node.point_type !== 5) continue
    const desc = cleanText(resolveHsrParams(node.point_desc, node.param_list))
    if (!desc) continue
    const type = SPRITE_TALENT
    if (!spriteByType.has(type)) spriteByType.set(type, [])
    spriteByType.get(type).push({ name: node.point_name || '', tag: '', icon: '', desc, params: null })
  }

  // 分类顺序固定为 忆灵技 → 忆灵天赋，其余类型按出现顺序补后
  const spriteSubgroups = []
  for (const type of [SPRITE_SKILL, SPRITE_TALENT]) {
    if (!spriteByType.has(type)) continue
    spriteSubgroups.push({ name: type, icon: spriteTypeIcons.get(type) || '', skills: spriteByType.get(type) })
  }
  for (const [type, skills] of spriteByType) {
    if (type === SPRITE_SKILL || type === SPRITE_TALENT) continue
    spriteSubgroups.push({ name: type, icon: spriteTypeIcons.get(type) || '', skills })
  }

  const spriteSection = spriteSubgroups.length > 0
    ? (sprite
        // 有忆灵：忆灵名 + 忆灵图标单独成子栏
        ? { title: '忆灵技能', type: 'skill-groups', groups: [{ name: sprite.name || '', icon: img('detail.memosprite.icon'), subgroups: spriteSubgroups }] }
        // 无忆灵（如欢愉技）：栏目标题取行迹节点名，技能直接列出
        : {
            title: traceNodes.find(x => x.node.point_type === 4)?.node.point_name || '特殊技能',
            type: 'skill-groups',
            groups: [{ name: '', icon: '', subgroups: spriteSubgroups.map(sg => ({ ...sg, name: '', icon: '' })) }]
          })
    : null
  // 忆灵技能若取自 detail.skills（如欢愉技），从技能区剔除避免重复
  const spriteCovered = new Set([...spriteSeen].filter(id => detail.skills?.[id]))

  // ── 技能（排除秘技攻击与忆灵组已收录条目，按类型排序）──
  if (detail.skills && typeof detail.skills === 'object') {
    const enhSkills = enhanced?.skills && typeof enhanced.skills === 'object'
      ? Object.values(enhanced.skills)
      : null
    const skillFields = Object.entries(detail.skills)
      .map(([key, s], idx) => ({ key, s, enh: enhSkills?.[idx] || null }))
      // 排除秘技攻击（MazeNormal）、忆灵组已收录条目，以及数据中无描述的空占位条目
      .filter(({ key, s }) => s.type !== 'MazeNormal' && !spriteCovered.has(key) && (s.desc || s.simple_desc))
      .sort((a, b) => hsrSkillOrder(a.s) - hsrSkillOrder(b.s))
      .map(({ key, s, enh }) => {
        const levelData = enh?.level || s.level
        const rawDesc = enh?.desc || enh?.simple_desc || s.desc || s.simple_desc || ''
        return {
          name: s.name || '',
          tag: s.type_name || skillTag(s.type || '', 'hsr'),
          icon: skillIconMap.get(String(s.id)) || img(`detail.skills.${key}.level.0.icon`),
          desc: cleanText(resolveHsrParams(rawDesc, firstLevelParams(levelData))),
          params: buildSkillParams(levelData, 'hsr', { formats: skillFormats(s, rawDesc) })
        }
      })
    if (skillFields.length > 0) {
      sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
    }
  }

  // ── 忆灵技能（point_type 4 / 5，置于附加能力之前）──
  if (spriteSection) sections.push(spriteSection)

  // ── 附加能力（point_type 3，恒 3 条；名称取节点 point_name）──
  const extraAbilities = traceNodes
    .filter(({ node }) => node.point_type === 3)
    .map(({ treeKey, nodeKey, node }) => ({
      name: node.point_name || '',
      desc: cleanText(resolveHsrParams(node.point_desc, node.param_list)),
      icon: img(`detail.skill_trees.${treeKey}.${nodeKey}.icon`)
    }))
    .filter(e => e.name || e.desc)
  if (extraAbilities.length > 0) {
    sections.push({ title: '附加能力', type: 'list', items: extraAbilities })
  }

  // ── 总属性加成（行迹 point_type 1 汇总，置于附加能力之后）──
  if (bonusItems.length > 0) {
    sections.push({ title: '总属性加成', type: 'stat-grid', items: bonusItems })
  }

  // ── 星魂（enhanced.ranks 同键覆盖 desc）──
  if (detail.ranks && typeof detail.ranks === 'object') {
    const conList = Object.entries(detail.ranks)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, r], i) => {
        const enhRank = enhanced?.ranks?.[k] || null
        return {
          order: i + 1,
          name: enhRank?.name || r.name || '',
          icon: img(`detail.ranks.${k}.icon`),
          desc: cleanText(resolveHsrParams(enhRank?.desc || r.desc || '', enhRank?.param_list || r.param_list))
        }
      })
    if (conList.length > 0) {
      sections.push({ title: '星魂', type: 'constellation-grid', items: conList })
    }
  }

  // ── 升级素材（detail.stats[0~6].cost：与光锥 promotion_cost_list 同构，item_id=2 为信用点）──
  if (detail.stats && typeof detail.stats === 'object') {
    const levels = Object.values(detail.stats)
      .map(s => {
        const list = Array.isArray(s?.cost) ? s.cost : []
        const credit = list.find(c => c.item_id === 2)
        const mats = list
          .filter(c => c.item_id !== 2)
          .map(c => ({
            id: c.item_id,
            count: c.item_num,
            name: getHsrItemName(c.item_id) || String(c.item_id),
            rank: _hsrRarityRank(c.rarity)
          }))
        return { cost: credit?.item_num || 0, mats }
      })
      .filter(l => l.mats.length > 0 || l.cost > 0)
    if (levels.length > 0) {
      const agg = aggregateMats(levels)
      const items = []
      if (agg.cost > 0) {
        items.push({ name: '信用点', count: agg.cost, icon: getHsrItemIcon('2'), id: 2, rank: 0 })
      }
      for (const m of agg.mats) {
        items.push({ name: m.name, count: m.count, icon: getHsrItemIcon(m.id), id: m.id, rank: m.rank })
      }
      if (items.length > 0) {
        sections.push({ title: '升级素材', type: 'materials', items })
      }
    }
  }

  return { hero, metaFields, sections, _images: images }
}

/** HSR rarity 字符串 → 排序 rank（NotNormal < Rare < VeryRare） */
function _hsrRarityRank (rarity) {
  if (rarity === 'NotNormal') return 1
  if (rarity === 'Rare') return 2
  if (rarity === 'VeryRare') return 3
  return 0
}
