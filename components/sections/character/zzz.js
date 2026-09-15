/**
 * 绝区零角色构建（ZZZ）
 * 将 nanoka 绝区零条目 JSON 归一化为统一角色模板数据
 */
import { imgUrl, galleryUrl, cleanMarkup, evalArith } from '../util.js'
import { transposeTable } from './skillParams.js'
import { zzzRank } from '../../constants.js'

/** 生日字符串 → "X月X日"（原神格式对齐）："6/19" / "05/02" → "6月19日" / "5月2日" */
function _formatZzzBirthday (birth) {
  if (!birth || typeof birth !== 'string') return ''
  const m = birth.trim().match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!m) return ''
  return `${Number(m[1])}月${Number(m[2])}日`
}

/** 绝区零角色满级等级（属性成长表以 Lv60 为上限） */
const ZZZ_MAX_LEVEL = 60

/** 属性表格展示项与标签（顺序同游戏内面板；propLabel 缺冲击力/异常项） */
const ZZZ_STAT_LABEL = {
  hp_max: '生命值',
  attack: '攻击力',
  defence: '防御力',
  break_stun: '冲击力',
  element_abnormal_power: '异常掌控',
  element_mystery: '异常精通'
}

/** 随等级成长的属性 → 成长值字段（生命值的字段名是 hp_growth，不随其他键加 _growth） */
const ZZZ_GROWTH_KEY = {
  hp_max: 'hp_growth',
  attack: 'attack_growth',
  defence: 'defence_growth'
}

/**
 * 核心技强化属性 id → stats 键
 * 只收「基础值」类（format 无 %）：data 内出现的有 生命值/基础攻击力/冲击力/异常精通/异常掌控/基础能量自动回复
 */
const ZZZ_EXTRA_PROP = {
  11101: 'hp_max',
  12101: 'attack',
  12201: 'break_stun',
  31201: 'element_mystery',
  31401: 'element_abnormal_power',
  30501: 'sp_recover'
}

/** 数据里元素标签不统一（火属性/冰属性/电属性/风属性 带后缀），统一为游戏内元素名 */
const ZZZ_ELEMENT = {
  物理: '物理', 火属性: '火', 冰属性: '冰', 电属性: '电', 以太: '以太', 风属性: '风', 流明: '流明'
}

/** detail.gender：1=男、2=女（partner_info.gender 缺失时回退） */
const ZZZ_GENDER = { 1: '男', 2: '女' }

/** 满级基础值 = 基础 + (满级-1) × 成长/10000 + 最高突破档累计（与游戏内一致，取整截断） */
function _zzzMaxStat (base, growth, breakthrough) {
  return Math.trunc((Number(base) || 0) + (ZZZ_MAX_LEVEL - 1) * (Number(growth) || 0) / 10000 + (Number(breakthrough) || 0))
}

/**
 * 核心技满档（extra_level 最高档，值为累计加成）的「基础属性」加成
 * 百分比类项（如 攻击力+21%、生命值+18%）属游戏内「加成」而非基础值，不计入属性表格
 * @param {object} detail
 * @returns {object} { <propId>: value }
 */
function _zzzCoreBonus (detail) {
  const levels = detail.extra_level || {}
  const maxKey = Object.keys(levels).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)).pop()
  const extra = levels[maxKey]?.extra || {}
  const out = {}
  for (const [prop, item] of Object.entries(extra)) {
    if (String(item?.format || '').includes('%')) continue
    out[prop] = Number(item?.value) || 0
  }
  return out
}

/**
 * 属性表格：满级（Lv60，含最高突破）基础值 + 满核心技的固定加成
 * 生命/攻击/防御随等级成长；冲击力/异常掌控/异常精通不随等级变化，只有核心技加成
 * @param {object} detail
 * @returns {Array<{label:string,value:string}>}
 */
function _zzzStatFields (detail) {
  const stats = detail.stats || {}
  const level = detail.level || {}
  const maxKey = Object.keys(level).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)).pop()
  const breakthrough = level[maxKey] || {}
  const bonus = _zzzCoreBonus(detail)
  const addOf = (statKey) => Object.entries(ZZZ_EXTRA_PROP)
    .filter(([, k]) => k === statKey)
    .reduce((sum, [prop]) => sum + (bonus[prop] || 0), 0)

  const fields = []
  for (const key of ['hp_max', 'attack', 'defence']) {
    if (stats[key] == null) continue
    const growth = stats[ZZZ_GROWTH_KEY[key]]
    fields.push({ label: ZZZ_STAT_LABEL[key], value: String(_zzzMaxStat(stats[key], growth, breakthrough[key]) + addOf(key)) })
  }
  for (const key of ['break_stun', 'element_abnormal_power', 'element_mystery']) {
    if (stats[key] == null) continue
    fields.push({ label: ZZZ_STAT_LABEL[key], value: String(Math.trunc(Number(stats[key]) + addOf(key))) })
  }
  // 能量自动回复数据侧为 ×100 值（120 → 1.2/秒）
  if (stats.sp_recover != null) {
    const rate = (Number(stats.sp_recover) + addOf('sp_recover')) / 100
    fields.push({ label: '能量自动回复', value: String(Number(rate.toFixed(2))) })
  }
  return fields
}

/* ===== 技能（绝区零） =====
 * 数据形态：detail.skill.<类别>.description[] 里，带 desc 的条目是招式说明、带 param 的是倍率组，
 * 两者按 name 配对（同一招式一条 desc + 一条 param 组）；类别顺序 普攻/闪避/特殊技/连携技/支援技
 * （数据侧没有 core 键，核心被动在 detail.passive）。
 * 倍率取值（等级 1~12，5 个类别的 material 表都是 1~12 档）：
 *   行 desc 形如 `{Skill:<id>, Prop:<n>}`（单段）或 `{Skill:A}+{{Skill:B}/3}*3`（复合），
 *   每个引用取该技能 param 项在 Lv 下的 main + growth×(Lv-1)（main/growth 即该行 Prop 对应的数值）；
 *   `{CAL:表达式,倍数,小数位}` 是游戏公式行，AvatarSkillLevel(k) 恒等于本类别当前等级，按列等级求值；
 *   两者都不含的行（「能量消耗 20点」等）不随等级变化 → 走固定小格。
 */

/** 技能等级上限（数据 material 表 1~12） */
const ZZZ_MAX_SKILL_LEVEL = 12

/** 技能/天赋视图保留的末尾档数（与星铁天赋视图同口径） */
const ZZZ_TALENT_LEVEL_SPAN = 7

/** 技能类别顺序与标签 */
const ZZZ_SKILL_CATEGORIES = [
  ['basic', '普通攻击'],
  ['dodge', '闪避'],
  ['special', '特殊技'],
  ['chain', '连携技'],
  ['assist', '支援技']
]

/** 招式 desc 无 <IconMap> 时的类别默认图标（资源名，IconMap 键与资源名不同名） */
const ZZZ_SKILL_ICON = {
  basic: 'Icon_Normal',
  dodge: 'Icon_Evade',
  special: 'IconRoleSkillKeySpecial',
  chain: 'Icon_QTE',
  assist: 'Icon_Switch'
}

/** 倍率数值输出：数据域为 ×100（2690 → 26.9%），去掉多余小数位 */
function _fmtRate (v) {
  return `${Number((Number(v) / 100).toFixed(2))}%`
}

/**
 * 倍率行在指定等级的数值（整数域求值，与游戏一致）
 * @param {object} row - { desc, param }
 * @param {number} level
 * @returns {number|null} 行内没有技能引用或公式非法时返回 null
 */
function _rateValueAt (row, level) {
  const desc = String(row?.desc || '')
  const refs = [...desc.matchAll(/\{+Skill:(\d+),\s*Prop:(\d+)\}+/g)]
  if (!refs.length) return null
  let expr = desc
  // 从后往前替换引用，避免索引位移
  for (let i = refs.length - 1; i >= 0; i--) {
    const m = refs[i]
    const item = row?.param?.[m[1]]
    const v = (Number(item?.main) || 0) + (Number(item?.growth) || 0) * (level - 1)
    expr = expr.slice(0, m.index) + String(v) + expr.slice(m.index + m[0].length)
  }
  return evalArith(expr.replace(/[{}]/g, ''))
}

/**
 * 单个 `{CAL:表达式,倍数,小数位}` 求值 → 展示字符串
 * 倍数 100 表示表达式是小数比例（×100 后即为百分数）；AvatarSkillLevel(k) 代入 level
 * @param {string} expr
 * @param {string|number} scale
 * @param {string|number} decimals
 * @param {number} level
 * @returns {string|null} 无法求值返回 null
 */
function _calValue (expr, scale, decimals, level) {
  const substituted = String(expr).replace(/AvatarSkillLevel\(\d+\)/g, String(level))
  if (/[A-Za-z]/.test(substituted)) return null
  const v = evalArith(substituted)
  if (v == null) return null
  const scaled = v * (Number(scale) === 100 ? 100 : 1)
  const digits = Math.min(Math.max(Number(decimals) || 0, 0), 4)
  return String(Number(scaled.toFixed(digits)))
}

/**
 * 设备相关按键提示占位符清洗
 * `{LAYOUT_CONSOLECONTROLLER#操作杆}{LAYOUT_FALLBACK#摇杆}` 是同义的按键提示（主机手柄布局 / 其它布局各一份），
 * 取 FALLBACK 那份（非主机手柄布局下的通用叫法），避免原文两个词并排出现；落单的 `{LAYOUT_XXX#文案}` 取文案
 * @param {string} text
 * @returns {string}
 */
function _cleanDeviceText (text) {
  return String(text || '')
    .replace(/\{LAYOUT_([A-Z_]+)#([^}]*)\}\{LAYOUT_([A-Z_]+)#([^}]*)\}/g, (m, tag1, text1, tag2, text2) => {
      if (tag2 === 'FALLBACK') return text2
      if (tag1 === 'FALLBACK') return text1
      return text2
    })
    .replace(/\{LAYOUT_[A-Z_]+#([^}]*)\}/g, '$1')
}

/**
 * CAL 公式文本求值（描述与倍率行通用）
 * 表达式可嵌在文字中间（如「露西攻击力{CAL:…}%+{CAL:…}」）；
 * 数值在数据里常被 <color> 单独包裹且单位在标签外（`<color>{CAL:…}</color>%`），
 * 故把紧随其后的闭合标签与单位一起捕获再原样吐出，让单位与数值相邻；
 * annotate 且表达式引用了技能等级（AvatarSkillLevel）时，在单位之后补档位标注
 * @param {string} text
 * @param {number} level
 * @param {boolean} [annotate]
 * @returns {string|null} 任一公式无法求值时返回 null
 */
function _substituteCal (text, level, annotate = false) {
  const src = String(text || '')
  if (!src.includes('{CAL:')) return src
  const calRe = /\{CAL:([^,}]+),(\d+),(\d+)\}((?:<\/span>|<\/color>)*)(\s*(?:点|%|％|秒|次|层|格|倍))?/g
  let ok = true
  const out = src.replace(calRe, (raw, expr, scale, decimals, closers, unit) => {
    const v = _calValue(expr, scale, decimals, level)
    if (v == null) {
      ok = false
      return raw
    }
    const tag = annotate && /AvatarSkillLevel\(/.test(expr)
      ? `<span class="lv-tag">（Lv.${level}）</span>`
      : ''
    return `${v}${closers || ''}${unit || ''}${tag}`
  })
  return ok ? out : null
}

/**
 * CAL 公式行在指定等级的展示文本（倍率表格内，不带档位标注——列头已标等级）
 * @param {object} row
 * @param {number} level
 * @returns {string|null}
 */
function _calTextAt (row, level) {
  const desc = String(row?.desc || '')
  if (!desc.includes('{CAL:')) return null
  return _substituteCal(desc, level, false)
}

/**
 * 招式倍率组 → 技能卡参数（形态与原神/星铁一致）
 * params：单表（末尾 ZZZ_TALENT_LEVEL_SPAN 档，与星铁天赋视图同口径），模板标题为「属性」
 * paramsAll：全等级单表，由倍率视图按每 5 列拆续表
 * 不随等级变化的行进固定小格
 * @param {Array} rows - description[i].param 数组
 * @returns {object|null} { fixed, rows, rowsAll, headers, headersAll }
 */
function _moveParams (rows) {
  if (!Array.isArray(rows) || !rows.length) return null
  const fixed = []
  const varying = []
  for (const row of rows) {
    if (!row) continue
    const desc = String(row.desc || '')
    if (/Skill:\d+/.test(desc) && _rateValueAt(row, 1) != null) {
      varying.push({ name: row.name || '', value: (lv) => _fmtRate(_rateValueAt(row, lv)) })
    } else if (desc.includes('{CAL:')) {
      varying.push({ name: row.name || '', value: (lv) => _calTextAt(row, lv) || '' })
    } else {
      // 不随等级变化（「能量消耗 20点」等）或公式无法解析 → 固定小格
      fixed.push({ label: row.name || '', value: desc })
    }
  }
  if (!varying.length) return fixed.length ? { fixed } : null
  const transposeLevels = (from, to) => {
    const headers = ['等级', ...varying.map(r => r.name)]
    const body = []
    for (let lv = from; lv <= to; lv++) body.push([String(lv), ...varying.map(r => r.value(lv))])
    return transposeTable({ headers, rows: body })
  }
  const tailFrom = Math.max(1, ZZZ_MAX_SKILL_LEVEL - ZZZ_TALENT_LEVEL_SPAN + 1)
  return { fixed, ...transposeLevels(tailFrom, ZZZ_MAX_SKILL_LEVEL), all: transposeLevels(1, ZZZ_MAX_SKILL_LEVEL) }
}

/**
 * 招式说明：`{CAL:…}` 按满技能等级代入数值（引用等级的补档位标注）、`<IconMap:Icon_X>` 换成 <img>，
 * 其余交 cleanMarkup 清洗官方标注；图标先替换成不含尖括号的占位符，避免被 cleanMarkup 的剥标签规则删除
 * @param {string} desc
 * @param {string} iconPrefix - 该条目的 fieldPath 前缀（detail.skill.<类>.description.<i>.desc.IconMap）
 * @param {function} img - fieldPath → URL
 * @returns {string}
 */
function _skillDesc (desc, iconPrefix, img) {
  const withCal = _substituteCal(_cleanDeviceText(desc), ZZZ_MAX_SKILL_LEVEL, true) ?? String(desc)
  const tokenized = withCal.replace(/<IconMap:([A-Za-z0-9_]+)>/g, (m, name) => `@@ATLAS_ICON:${name}@@`)
  return cleanMarkup(tokenized).replace(/@@ATLAS_ICON:([A-Za-z0-9_]+)@@/g, (m, name) => {
    const url = img(`${iconPrefix}.${name}`) || galleryUrl('zzz', name)
    return url ? `<img class="inline-icon" src="${url}"/>` : ''
  })
}

/**
 * 技能段落 → 招式卡数组（按类别顺序，每招式一张卡，tag 为技能类别）
 * @param {object} detail
 * @param {function} img - fieldPath → URL
 * @returns {Array<{name,tag,icon,desc,params}>}
 */
function _zzzSkillCards (detail, img) {
  const cards = []
  for (const [key, label] of ZZZ_SKILL_CATEGORIES) {
    const sk = detail?.skill?.[key]
    if (!sk || !Array.isArray(sk.description)) continue
    const moves = []
    const byName = new Map()
    const ensure = (name) => {
      const k = name || label
      if (!byName.has(k)) {
        const mv = { name: k, desc: '', icon: '', rows: [] }
        byName.set(k, mv)
        moves.push(mv)
      }
      return byName.get(k)
    }
    sk.description.forEach((entry, i) => {
      if (!entry) return
      if (entry.desc) {
        const mv = ensure(entry.name)
        const prefix = `detail.skill.${key}.description.${i}.desc.IconMap`
        const iconName = String(entry.desc).match(/<IconMap:([A-Za-z0-9_]+)>/)?.[1]
        if (!mv.icon && iconName) mv.icon = img(`${prefix}.${iconName}`)
        mv.desc = _skillDesc(entry.desc, prefix, img)
      }
      if (Array.isArray(entry.param)) ensure(entry.name).rows.push(...entry.param)
    })
    const fallbackIcon = galleryUrl('zzz', ZZZ_SKILL_ICON[key]) || ''
    for (const mv of moves) {
      if (!mv.desc && !mv.rows.length) continue
      const params = _moveParams(mv.rows)
      cards.push({
        name: mv.name,
        tag: label,
        icon: mv.icon || fallbackIcon,
        desc: mv.desc,
        // 技能视图单表（末尾 7 档）；倍率视图由 paramsAll 的全等级单表拆续表
        params: params ? { headers: params.headers, rows: params.rows, fixed: params.fixed } : null,
        paramsAll: params?.all ? { headers: params.all.headers, rows: params.all.rows, fixed: params.fixed } : null
      })
    }
  }
  return cards
}

/**
 * 核心被动：`passive.level` 每档含 [核心被动, 额外能力] 两条 name/desc，取最高档
 * 7 个角色（悠真/格莉丝/猫又/珂蕾妲/艾莲/莱卡恩/零号·安比）有 14 档 = 两套（后一套为加强版），
 * 按 level 覆盖式读取，与 ZZZ-Plugin 的取法一致
 * @param {object} detail
 * @returns {Array<{name:string, desc:string}>}
 */
function _corePassiveItems (detail) {
  const byLevel = new Map()
  for (const v of Object.values(detail?.passive?.level || {})) {
    if (v?.level != null) byLevel.set(Number(v.level), v)
  }
  const max = Math.max(...byLevel.keys(), 0)
  const top = byLevel.get(max)
  if (!top) return []
  const names = top.name || []
  const descs = top.desc || []
  return names
    .map((name, i) => {
      const raw = _cleanDeviceText(descs[i] || '')
      return { name, desc: cleanMarkup(_substituteCal(raw, ZZZ_MAX_SKILL_LEVEL, true) ?? raw) }
    })
    .filter(it => it.name)
}

/**
 * 核心技强化数值：format 含 % 的按 ×100 存储（1800 → 18%）；基础能量自动回复同样 ×100（36 → 0.36）
 * @param {string} prop - 属性 id
 * @param {object} item
 * @returns {string}
 */
function _fmtExtraValue (prop, item) {
  const v = Number(item?.value) || 0
  if (String(item?.format || '').includes('%')) return `${Number((v / 100).toFixed(2))}%`
  if (String(prop) === '30501') return String(Number((v / 100).toFixed(2)))
  return String(v)
}

/**
 * 核心技强化：`extra_level` 各档（A~F，值为累计加成）的属性加成
 * 含百分比类条目（游戏内属「加成」，与属性表格只取基础值的口径不同，故在此完整列出）
 * @param {object} detail
 * @returns {Array<{label:string, value:string}>}
 */
function _coreLevelItems (detail) {
  const levels = detail?.extra_level || {}
  const keys = Object.keys(levels).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
  const items = []
  keys.forEach((k, i) => {
    const extra = levels[k]?.extra || {}
    const parts = Object.entries(extra)
      .filter(([, item]) => Number(item?.value) !== 0) // 该档为 0 的属性不列（如 A 档的基础攻击力 +0）
      .map(([prop, item]) => `${item?.name || prop} +${_fmtExtraValue(prop, item)}`)
    if (parts.length) items.push({ label: 'ABCDEF'[i] || String(i + 1), value: parts.join('、') })
  })
  return items
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
  const hitType = detail.hit_type ? Object.values(detail.hit_type)[0] : ''
  const camp = detail.camp ? Object.values(detail.camp)[0] : ''
  const info = detail.partner_info || {}
  const element = ZZZ_ELEMENT[elementType] || elementType || list.element || ''
  const birthday = _formatZzzBirthday(info.birthday)
  const gender = info.gender || ZZZ_GENDER[detail.gender] || ''

  // hero 背景同原神：取角色自带的横版完整插画 Mindscape_<id>_3（影画第三阶段 2580×1080，退第二/第一），
  // 由模板写成 .hero 的内联 background-image，填充沿用 .hero 的 cover + center 30%（与原神名片大图完全同一套）
  // 上游未抓到的图在 meta.images 里是占位（gallery/_placeholder/unknown.svg），必须跳过，否则占位会顶掉后面的退路
  const realImg = (fp) => {
    const url = img(fp)
    return url && !url.includes('/_placeholder/') ? url : ''
  }
  const hero = {
    // 三张影画都缺（当前仅新角色佩洛伊斯/克拉蕾/洛克茜）时退角色立绘大图（1516×2128 完整插画），不再往下退小图标
    namecard: realImg('derived.mindscape.3') || realImg('derived.mindscape.2') || realImg('derived.mindscape.1')
      || realImg('icon') || '',
    portrait: img('detail.partner_info.icon_path') || img('icon') || img('detail.icon'),
    title: '',
    element,
    weapon: weaponType || list.specialty || '',
    birthday,
    constellation: '',
    rarity: zzzRank(list.rank ?? detail.rarity ?? meta?.rarity, 'character'),
    // hero 小方框：属性 特性 攻击类型 阵营 性别 生日 身高（生日/身高带标签，其余为裸值）
    chips: [
      element,
      weaponType || list.specialty || '',
      hitType,
      camp,
      gender,
      birthday ? `生日 ${birthday}` : '',
      info.stature ? `身高 ${info.stature}` : ''
    ].filter(Boolean)
  }

  // 属性表格：满级基础值 + 满核心技固定加成（阵营/性别/生日/身高等身份项已进 hero 小方框）
  const metaFields = _zzzStatFields(detail)

  // 技能（每招式一张卡，倍率表 Lv1~12 每 5 列一续表；不随等级变化的行进固定小格）
  const skillCards = _zzzSkillCards(detail, img)
  if (skillCards.length) {
    sections.push({ title: '技能', type: 'skill-cards', skills: skillCards })
  }

  // 核心被动（核心被动 + 额外能力，取最高档）与核心技强化（A~F 累计加成）
  const passiveItems = _corePassiveItems(detail)
  if (passiveItems.length) {
    sections.push({ title: '核心被动', type: 'list', items: passiveItems })
  }
  const coreLevelItems = _coreLevelItems(detail)
  if (coreLevelItems.length) {
    // inSkills：核心技强化与核心被动同属核心技，纳入天赋/技能子视图
    sections.push({ title: '核心技强化', type: 'stat-grid', items: coreLevelItems, inSkills: true })
  }

  // 潜能（技能与影画之间）
  if (detail.potential_detail && typeof detail.potential_detail === 'object') {
    const extras = Object.entries(detail.potential_detail).map(([k, p]) => ({
      name: p.name || p.level_show_name || '',
      desc: cleanMarkup(p.desc || ''),
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
        desc: cleanMarkup(t.desc || '')
      }))
    sections.push({ title: '影画', type: 'constellation-grid', items: conList })
  }

  // 资料（生日/全名/身高已归入 hero 小方框或不再展示，详见 buildZZZ 头部注释）
  if (detail.partner_info) {
    const pi = detail.partner_info
    const stories = []
    if (pi.profile_desc) stories.push({ title: '简介', content: cleanMarkup(pi.profile_desc) })
    if (stories.length > 0) {
      sections.push({ title: '资料', type: 'stories', items: stories })
    }
  }

  return { hero, metaFields, sections, _images: images }
}