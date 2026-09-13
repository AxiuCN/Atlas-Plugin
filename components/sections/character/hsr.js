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
 * - 角色加强（detail.enhanced['1']，10 个加强角色）：技能按 id 末 6 位、星魂按键、
 *   行迹节点按 treeKey/nodeKey 取加强档案数据直接替换加强前内容（加强前的技能/行迹/星魂不再展示）
 * - 参数表列名：HSR param_list 无标签，取自 miao-plugin 星铁数据（model/MiaoParams.js）按各级数值
 *   序列比对匹配；miao 未收录或与 nanoka 数值不一致时降级为「属性 N」
 * - 描述内联数值取「无星魂常规上限」档（行迹树节点数：普攻/忆灵技/忆灵天赋 6、战技/终结技/天赋/
 *   欢愉技 10、秘技 1），随等级变化的数值后标注 （Lv.N）（miao 图鉴同款）；常量参数不标注；
 *   官方 <color>/<u> 高亮由 cleanMarkup() 保留，色相映射见 components.css
 * - 开拓者条目名为占位符 {NICKNAME}（5 命途 × 2 性别），展示名按命途记为「开拓者·<命途>」
 */
import { buildSkillParams, varyingIndexes } from './skillParams.js'
import { matchParamNames } from '../../../model/MiaoParams.js'
import { imgUrl, skillTag, cleanMarkup, resolveHsrParams, hsrLabel } from '../util.js'

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

/**
 * 等级数据 → 描述取值档位与参数
 * 描述内联数值取「无星魂加持的常规上限」档（行迹树节点数：普攻/忆灵技/忆灵天赋 6、
 * 战技/终结技/天赋/欢愉技/助战技 10、秘技 1），该档不存在时取不超过上限的最大档
 * @param {object} levelData - s.level
 * @param {number} cap - 无星魂常规上限
 * @returns {{level: number, params: Array}|null} null 表示无法定位档位
 */
function descLevelParams (levelData, cap) {
  if (!levelData || typeof levelData !== 'object') return null
  const levels = Object.keys(levelData).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b)
  if (!levels.length) return null
  const pick = levels.filter(lv => lv <= cap).pop() ?? levels[0]
  return { level: pick, params: levelData[String(pick)]?.param_list || null }
}

/**
 * 等级数据 → 各等级 param_list（按等级升序）
 * miao 参数名按「各级数值序列」比对匹配，需要完整的等级序列而非单级
 * @param {object} levelData - s.level
 * @returns {Array<Array>}
 */
function paramLevels (levelData) {
  if (!levelData || typeof levelData !== 'object') return []
  return Object.keys(levelData)
    .filter(k => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map(k => levelData[k]?.param_list || [])
}

/** 技能类型排序值（天赋无 type 字段，排在终结技与秘技之间） */
function hsrSkillOrder (s) {
  if (s?.type == null) return 2.5
  return HSR_SKILL_ORDER[s.type] ?? 9
}

/**
 * HSR 技能常规等级上限（含星魂加成）：天赋视图以该上限为终点保留末尾 HSR_LEVEL_SPAN 档。
 * 数据等级表普遍预留到 15 级（战技/终结技/天赋）或 10 级（普攻/忆灵），高于上限的档位实战不会出现。
 * 普攻 7（基础 6 + 星魂 1）、战技/终结技/天赋 12（基础 10 + 星魂 2）、秘技 1（不升级）、
 * 忆灵技与忆灵天赋 7（忆灵体系）、欢愉技/助战技同战技口径 12
 */
const HSR_LEVEL_CAP = { Normal: 7, BPSkill: 12, Ultra: 12, Maze: 1, ElationDamage: 12, Assist: 12 }
const HSR_LEVEL_CAP_DEFAULT = 12

/**
 * 取技能的常规等级上限
 * @param {object} s - 技能原始数据
 * @returns {number}
 */
function hsrLevelCap (s) {
  if (s?.type_name === SPRITE_SKILL || s?.type_name === SPRITE_TALENT) return 7
  if (s?.type == null) return HSR_LEVEL_CAP_DEFAULT
  return HSR_LEVEL_CAP[s.type] ?? HSR_LEVEL_CAP_DEFAULT
}

/**
 * HSR 技能「无星魂加持」的常规等级上限：行迹树节点数即该技能可升级到的档位
 * （普攻 6、战技/终结技/天赋 10、忆灵技/忆灵天赋 6、欢愉技 10、秘技 1；星魂另加普攻/忆灵 +1、战技类 +2）。
 * 描述内联数值以此档渲染并在数值后标注档位（miao 图鉴同款 `（Lv.N）` 提示）
 */
const HSR_BASE_CAP = { Normal: 6, BPSkill: 10, Ultra: 10, Maze: 1, ElationDamage: 10, Assist: 10 }
const HSR_BASE_CAP_DEFAULT = 10

/**
 * 取技能的无星魂常规等级上限
 * @param {object} s - 技能原始数据
 * @returns {number}
 */
function hsrBaseCap (s) {
  if (s?.type_name === SPRITE_SKILL || s?.type_name === SPRITE_TALENT) return 6
  if (s?.type == null) return HSR_BASE_CAP_DEFAULT
  return HSR_BASE_CAP[s.type] ?? HSR_BASE_CAP_DEFAULT
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
 * @returns {object|null} { hero, metaFields, sections, _images, recordName }
 */
export function buildHSR (list, detail, meta) {
  const images = meta?.images || []
  const img = (fp) => imgUrl(images, fp)
  const sections = []

  // 角色加强（enhanced 集中覆盖档案）：单档位键 '1'，含加强版技能/行迹/星魂
  const enhanced = (detail.enhanced && typeof detail.enhanced === 'object' && !Array.isArray(detail.enhanced))
    ? detail.enhanced[Object.keys(detail.enhanced)[0]]
    : null

  // 开拓者条目名为游戏占位符 {NICKNAME}（5 个命途 × 2 性别共 10 条）：展示名按命途区分，
  // 参数名查询键取 miao 的「穹·<命途>」目录（同命途男女形态数据一致，取其一即可）
  const rawName = list.zh || meta?.name || ''
  const isTrailblazer = rawName === '{NICKNAME}'
  const pathCn = isTrailblazer ? hsrLabel(detail.base_type || '') : ''
  const charName = isTrailblazer && pathCn ? `开拓者·${pathCn}` : rawName
  const miaoKey = isTrailblazer && pathCn ? `穹·${pathCn}` : rawName

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

  /**
   * 行迹节点的加强版覆盖（加强档案的 skill_trees 与基础节点按 treeKey/nodeKey 一一对应，
   * 未加强的节点内容与基础一致）
   */
  const enhNodeOf = (treeKey, nodeKey) => enhanced?.skill_trees?.[treeKey]?.[nodeKey] || null

  // 总属性加成：point_type 1 各节点 status_add_list 按属性累加（标签取数据自带中文名），
  // 独立成栏置于附加能力之后；已加强角色取加强节点数据
  const bonusMap = new Map()
  for (const { treeKey, nodeKey, node } of traceNodes) {
    if (node.point_type !== 1) continue
    const enhStatus = enhNodeOf(treeKey, nodeKey)?.status_add_list
    for (const st of (enhStatus?.length ? enhStatus : node.status_add_list) || []) {
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
    const levelData = s.level
    const paramNames = matchParamNames(miaoKey, paramLevels(levelData))
    // 描述数值取无星魂常规上限档，并在随等级变化的数值后标注该档位
    const dl = descLevelParams(levelData, hsrBaseCap(s))
    return {
      name: s.name || '',
      tag: plain ? '' : (s.type_name || skillTag(s.type || '', 'hsr')),
      icon: !plain && iconPath ? img(iconPath) : '',
      desc: cleanMarkup(resolveHsrParams(rawDesc, dl?.params, { level: dl?.level, varying: varyingIndexes(levelData) })),
      // 默认参数表按常规上限收敛（天赋视图）；全等级表供倍率视图使用
      params: buildSkillParams(levelData, 'hsr', { formats, paramNames, levelCap: hsrLevelCap(s) }),
      paramsAll: buildSkillParams(levelData, 'hsr', { formats, paramNames, allLevels: true })
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
    const desc = cleanMarkup(resolveHsrParams(node.point_desc, node.param_list))
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
    // 加强技能按 id 末 6 位与基础技能对应（加强档案键为前导 1 + 基础技能 id）
    const enhSkillById = new Map()
    for (const [enhKey, enhSkill] of Object.entries(enhanced?.skills || {})) {
      enhSkillById.set(String(enhSkill?.id || enhKey).slice(-6), enhSkill)
    }
    const skillFields = Object.entries(detail.skills)
      .map(([key, s]) => ({ key, s, enh: enhSkillById.get(String(s.id).slice(-6)) || null }))
      // 排除秘技攻击（MazeNormal）、忆灵组已收录条目，以及数据中无描述的空占位条目
      .filter(({ key, s }) => s.type !== 'MazeNormal' && !spriteCovered.has(key) && (s.desc || s.simple_desc))
      .sort((a, b) => hsrSkillOrder(a.s) - hsrSkillOrder(b.s))
      .map(({ key, s, enh }) => {
        const levelData = enh?.level || s.level
        const rawDesc = enh?.desc || enh?.simple_desc || s.desc || s.simple_desc || ''
        const paramNames = matchParamNames(miaoKey, paramLevels(levelData))
        // 描述数值取无星魂常规上限档，并在随等级变化的数值后标注该档位
        const dl = descLevelParams(levelData, hsrBaseCap(s))
        return {
          name: s.name || '',
          tag: s.type_name || skillTag(s.type || '', 'hsr'),
          icon: skillIconMap.get(String(s.id)) || img(`detail.skills.${key}.level.0.icon`),
          desc: cleanMarkup(resolveHsrParams(rawDesc, dl?.params, { level: dl?.level, varying: varyingIndexes(levelData) })),
          // 默认参数表按常规上限收敛（天赋视图）；全等级表供倍率视图使用
          params: buildSkillParams(levelData, 'hsr', { formats: skillFormats(s, rawDesc), paramNames, levelCap: hsrLevelCap(s) }),
          paramsAll: buildSkillParams(levelData, 'hsr', { formats: skillFormats(s, rawDesc), paramNames, allLevels: true })
        }
      })
    if (skillFields.length > 0) {
      sections.push({ title: '技能', type: 'skill-cards', skills: skillFields })
    }
  }

  // ── 忆灵技能（point_type 4 / 5，置于附加能力之前）──
  if (spriteSection) sections.push(spriteSection)

  // ── 附加能力（point_type 3，恒 3 条；名称取节点 point_name，已加强角色取加强节点数据）──
  const extraAbilities = traceNodes
    .filter(({ node }) => node.point_type === 3)
    .map(({ treeKey, nodeKey, node }) => {
      const enhNode = enhNodeOf(treeKey, nodeKey)
      return {
        name: enhNode?.point_name || node.point_name || '',
        desc: cleanMarkup(resolveHsrParams(enhNode?.point_desc || node.point_desc, enhNode?.param_list || node.param_list)),
        icon: img(`detail.skill_trees.${treeKey}.${nodeKey}.icon`)
      }
    })
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
          desc: cleanMarkup(resolveHsrParams(enhRank?.desc || r.desc || '', enhRank?.param_list || r.param_list))
        }
      })
    if (conList.length > 0) {
      sections.push({ title: '星魂', type: 'constellation-grid', items: conList })
    }
  }

  return { hero, metaFields, sections, _images: images, recordName: charName !== rawName ? charName : '' }
}

