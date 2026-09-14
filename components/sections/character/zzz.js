/**
 * 绝区零角色构建（ZZZ）
 * 将 nanoka 绝区零条目 JSON 归一化为统一角色模板数据
 */
import { imgUrl, cleanMarkup } from '../util.js'
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
          desc = cleanMarkup(main.desc || '')
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
            params = transposeTable({ headers, rows })
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