/**
 * 角色攻略页图标解析（数据源：nanoka-atlas-backend）
 *
 * 攻略数据本身只存文字，攻略页用到的图标在渲染时按名称到图鉴里现取：
 * - 武器：武器名 → weapon 页条目 → meta.images 的 icon
 * - 圣遗物：套装名 → artifact 页部件条目的 content.list.set[].name.zh → 该部件条目的 icon
 *   （套装没有独立图标资源，用套装部件图标代替；套装名↔图标索引进程内缓存，只读一次）
 * - 天赋：天赋字母（A/E/Q）→ 角色条目 detail.skills[].promote[0].icon
 * - 命座：命座序号（二命 / index 2 → 第 2 个）→ 角色条目 detail.constellations[].icon
 * - 配队：队内每个角色名 → character 页条目 → meta.images 的 icon（头像，页面只出头像不出名字）
 *
 * 取名称有两条路，**优先走 v2 的 ref**：
 * - v2 结构化数据：条目自带 `ref`（`weapon:西风剑` / `artifact:千岩牢固` / `talent:Q` /
 *   `constellation:2` / `character:丝柯克`），类型前缀直接决定用哪个解析器，不再靠行形态猜名字；
 *   段落级引用（section.iconRef）用于段落标题图标，条目级引用用于档位行里的小图标
 * - 旧版文本行：没有 ref，退回原来的「取段落首个名字」启发式（resolveGuideIcons 的兜底分支）
 *
 * 取不到或图鉴缺图一律返回空串，由模板决定不渲染或退回文字，不影响文案。
 */
import { loadMap, loadRecord, search } from '../AtlasService.js'
import { normalizeForMatch, loadAliasMap } from '../AliasLoader.js'
import { imgUrl } from '../../components/sections/util.js'

/** 套装名 → 图标 URL（按游戏缓存；只构建一次） */
const setIconCache = new Map()

/** 角色名 → 条目 path（只读 map.json 索引，不读条目文件） */
const charPathCache = new Map()

/** 角色名 → 头像图标 URL（按需读条目，读到就缓存） */
const charIconCache = new Map()

/** 武器名 → 图标 URL（v2 会给每个推荐武器挂图标，命中率高的别名重复出现时不必重查） */
const weaponIconCache = new Map()

/** 剥掉行内标签与实体，得到纯文本（用于从模板数据里取名称） */
function plainText (html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
}

/** 拆 ref（`weapon:西风剑` → { type: 'weapon', name: '西风剑' }） */
function parseRef (ref) {
  const text = String(ref ?? '')
  const i = text.indexOf(':')
  if (i < 0) return { type: '', name: text.trim() }
  return { type: text.slice(0, i).trim(), name: text.slice(i + 1).trim() }
}

/**
 * 这次搜索命中是否「名字对得上」（严格模式用）
 *
 * v2 的 ref 按约定写图鉴标准名（攻略仓库自带的 validate() 就是按标准名校验的），
 * 所以 ref 驱动的取图只在名字确实对得上时才出图标：
 *   ① 命中条目名本身
 *   ② 命中条目的别名（图鉴索引期会把主角形态名「旅行者·火」「冰主」这类并入别名）
 *   ③ 命中别名系统登记过的写法（miao / resources/alias 预设）
 * 三条都不满足就当作解析失败——搜索是加权评分的模糊匹配，名不对题时（数据里的
 * 「88爆伤武器」这类描述）会返回一个看着像、其实错的条目，出个错图标比不出图标更糟。
 * @param {string} gameId
 * @param {string} name - 数据里写的名字
 * @param {object} entry - search() 返回的候选条目（带 name / aliases）
 * @returns {boolean}
 */
function nameMatches (gameId, name, entry) {
  if (!name || !entry) return false
  const key = normalizeForMatch(name)
  if (!key) return false
  if (normalizeForMatch(entry.name) === key) return true
  for (const alias of entry.aliases || []) {
    if (normalizeForMatch(alias) === key) return true
  }
  const registered = loadAliasMap(gameId).get(key) || []
  return registered.some(item => normalizeForMatch(item.value) === normalizeForMatch(entry.name))
}

/**
 * 构建「圣遗物套装名 → 部件图标」索引
 * 部件条目（artifact 页）的 content.list.set 里带多语言套装名，是名称与图标之间唯一的对应关系
 * @param {string} gameId
 * @returns {Map<string, string>}
 */
function setIconIndex (gameId) {
  if (setIconCache.has(gameId)) return setIconCache.get(gameId)
  const index = new Map()
  const records = loadMap()?.games?.[gameId]?.locales?.zh?.pages?.artifact?.records || {}
  for (const rec of Object.values(records)) {
    if (!rec?.path) continue
    let record
    try {
      record = loadRecord(rec.path)
    } catch {
      continue
    }
    const icon = imgUrl(record?.meta?.images, 'icon') || imgUrl(record?.meta?.images, 'detail.icon')
    if (!icon) continue
    for (const entry of Object.values(record?.content?.list?.set || {})) {
      const name = entry?.name?.zh
      if (name && !index.has(name)) index.set(name, icon)
    }
  }
  setIconCache.set(gameId, index)
  return index
}

/**
 * 武器名 → 图标（走搜索 + 条目 icon）
 * @param {string} gameId
 * @param {string} name
 * @param {boolean} [strict] - 严格模式（v2 的 ref）：名字对不上就不出图，避免出错误图标
 */
function weaponIcon (gameId, name, strict = false) {
  if (!name) return ''
  const key = `${gameId}|${name}|${strict ? 's' : 'n'}`
  if (weaponIconCache.has(key)) return weaponIconCache.get(key)
  let top
  try {
    const res = search(gameId, name)
    top = res?.results?.find(r => ['weapon', 'lightcone', 'equipment'].includes(r.pageKey)) || res?.results?.[0]
  } catch {
    return ''
  }
  if (strict && !nameMatches(gameId, name, top)) return ''
  let url = ''
  if (top) {
    try {
      url = imgUrl(loadRecord(top.filePath)?.meta?.images, 'icon') || ''
    } catch {
      url = ''
    }
  }
  // 只缓存命中的结果：图鉴索引晚于首次查询就绪时，下次仍能重新解析
  if (url) weaponIconCache.set(key, url)
  return url
}

/** 套装名 → 图标 */
function artifactIcon (gameId, name) {
  if (!name) return ''
  return setIconIndex(gameId).get(name) || ''
}

/**
 * 角色名 → 条目 path（同时登记归一化写法，便于「菈乌玛/拉乌玛」这类差异命中）
 * @param {string} gameId
 * @returns {Map<string, string>}
 */
function characterPaths (gameId) {
  if (charPathCache.has(gameId)) return charPathCache.get(gameId)
  const map = new Map()
  const records = loadMap()?.games?.[gameId]?.locales?.zh?.pages?.character?.records || {}
  for (const rec of Object.values(records)) {
    if (!rec?.name || !rec.path) continue
    map.set(rec.name, rec.path)
    const key = normalizeForMatch(rec.name)
    if (!map.has(key)) map.set(key, rec.path)
  }
  charPathCache.set(gameId, map)
  return map
}

/**
 * 角色名 → 头像图标（按需读条目并缓存；先直查索引，未命中再走一次搜索兜底别名）
 * @param {string} gameId
 * @param {string} name
 * @param {boolean} [strict] - 严格模式（v2 的 ref）：搜索兜底还要核对名字，避免出错误头像
 * @returns {string} file:// URL；取不到返回空串
 */
export function characterIcon (gameId, name, strict = false) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  const key = `${gameId}|${raw}|${strict ? 's' : 'n'}`
  if (charIconCache.has(key)) return charIconCache.get(key)

  let url = ''
  const paths = characterPaths(gameId)
  const filePath = paths.get(raw) || paths.get(normalizeForMatch(raw))
  const fromRecord = (recordPath) => {
    if (!recordPath) return ''
    try {
      return imgUrl(loadRecord(recordPath)?.meta?.images, 'icon') || ''
    } catch {
      return ''
    }
  }
  url = fromRecord(filePath)
  if (!url) {
    try {
      const top = search(gameId, raw)?.results?.find(r => r.pageKey === 'character')
      if (!strict || nameMatches(gameId, raw, top)) url = fromRecord(top?.filePath)
    } catch {
      url = ''
    }
  }
  charIconCache.set(key, url)
  return url
}

/** 天赋优先级字母（A/E/Q）→ 技能图标：原神技能顺序为 普通攻击 / 元素战技 / 元素爆发 */
const TALENT_INDEX = { A: 0, E: 1, Q: 2 }

function talentIcon (record, letter) {
  const idx = TALENT_INDEX[String(letter || '').trim().toUpperCase()]
  const skills = record?.content?.detail?.skills
  if (idx == null || !Array.isArray(skills) || !skills[idx]) return ''
  return imgUrl(record.meta.images, `detail.skills.${idx}.promote.0.icon`)
}

/** 命座序号（1-6）→ 图标 */
function constellationIconByIndex (record, index) {
  const idx = Number(index)
  const cons = record?.content?.detail?.constellations
  if (!Number.isInteger(idx) || idx < 1 || !Array.isArray(cons) || !cons[idx - 1]) return ''
  return imgUrl(record.meta.images, `detail.constellations.${idx - 1}.icon`)
}

/** 命座中文序号 → 下标 */
const CONSTELLATION_INDEX = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

/** 命座标签（「二命」）→ 图标 */
function constellationIcon (record, label) {
  const m = plainText(label).match(/([一二三四五六])命/)
  return m ? constellationIconByIndex(record, CONSTELLATION_INDEX[m[1]]) : ''
}

/** 取段落第一行内容的纯文本（跳过标签；去掉「（二命）」这类后缀限定） */
function firstValue (section) {
  const row = section?.rows?.[0]
  if (!row) return ''
  const first = row.items?.[0]
  return plainText(first?.text || '').replace(/[（(][^）)]*[）)]?/g, '').trim()
}

/**
 * 单个 ref → 图标（v2 结构化数据的唯一入口：类型前缀决定解析器）
 *
 * 一律走严格模式：ref 按约定写图鉴标准名，名字对不上就不出图标（降级成纯文字），
 * 绝不因为「搜索看着像」而显示一个错的图标。
 * @param {string} gameId
 * @param {string} ref - `weapon:西风剑` / `artifact:千岩牢固` / `character:芙宁娜` / `talent:Q` / `constellation:2`
 * @param {object|null} record - 图鉴角色条目（天赋 / 命座图标取自它，可为 null）
 * @returns {{icon: string, iconLine: boolean}} iconLine=线稿图标（天赋 / 命座），模板据此反相
 */
function refIcon (gameId, ref, record) {
  const { type, name } = parseRef(ref)
  switch (type) {
    case 'weapon':
      return { icon: weaponIcon(gameId, name, true), iconLine: false }
    case 'artifact':
      return { icon: artifactIcon(gameId, name), iconLine: false }
    case 'character':
      return { icon: characterIcon(gameId, name, true), iconLine: false }
    case 'talent':
      return { icon: talentIcon(record, name), iconLine: true }
    case 'constellation':
      return { icon: constellationIconByIndex(record, name), iconLine: true }
    default:
      // 完全没有类型前缀时按武器名兜一次；前缀不认识就当作解析失败
      // （宁可不显示图标，也不显示一个错的图标）
      return type
        ? { icon: '', iconLine: false }
        : { icon: weaponIcon(gameId, name, true), iconLine: false }
  }
}

/**
 * 解析攻略页各段落标题图标
 *
 * 有 v2 就用段落里的 ref（`section.iconRef` 起头，顺次往后找第一个能取到图的）直接取图；
 * 一段 ref 都取不到（或干脆没有 ref，即旧版文本行）时，退回「取该段第一个推荐名字」的启发式，
 * 行为与改造前一致。
 * @param {string} gameId - gi / hsr / zzz
 * @param {object} guide - getCharacterGuide() 返回的攻略数据（段落已按长图顺序排好）
 * @param {object|null} record - 图鉴角色条目（角色页 hero 用的同一份，可为 null）
 * @returns {{weapon: string, artifact: string, talent: string, constellation: string}} file:// URL，取不到为空串
 */
export function resolveGuideIcons (gameId, guide, record) {
  const empty = { weapon: '', artifact: '', talent: '', constellation: '' }
  if (!gameId || !guide || !record) return empty
  const sections = guide.sections || []
  const find = (re) => sections.find(s => re.test(String(s.title || '')))
  const weaponSection = find(/武器/)
  const artifactSection = find(/圣遗物/)
  const talentSection = find(/天赋/)
  const constellationSection = find(/命座/)

  /**
   * 有 ref 先走 ref（按段落内的顺序，第一个能取到图的就用作段落图标），
   * 全取不到再退回「按名字猜」（旧版文本行的路径，行为不变）
   */
  const withRef = (section, byName) => {
    const refs = [section?.iconRef, ...(section?.rows || []).map(row => row.ref)].filter(Boolean)
    for (const ref of refs) {
      const { icon } = refIcon(gameId, ref, record)
      if (icon) return icon
    }
    return byName()
  }

  return {
    weapon: withRef(weaponSection, () => weaponIcon(gameId, firstValue(weaponSection))),
    artifact: withRef(artifactSection, () => artifactIcon(gameId, firstValue(artifactSection))),
    talent: withRef(talentSection, () => talentIcon(record, firstValue(talentSection))),
    constellation: withRef(constellationSection, () => constellationIcon(record, constellationSection?.rows?.[0]?.label))
  }
}

/**
 * 给带 ref 的档位条目挂图标（v2 结构化数据）
 *
 * v1 文本行的条目没有 ref，原样返回——段落标题图标仍由 resolveGuideIcons 负责，行为不变。
 * 解析失败（ref 类型不认识、名字不在图鉴、图鉴缺图）时不写 icon 字段，模板自动退回纯文字条目。
 * @param {string} gameId
 * @param {Array} sections - parse.js 产出的段落数组
 * @param {object|null} record - 图鉴角色条目（天赋 / 命座图标取自它）
 * @returns {Array} 新的段落数组
 */
export function attachItemIcons (gameId, sections, record) {
  if (!gameId || !Array.isArray(sections)) return sections
  return sections.map(section => {
    if (!Array.isArray(section?.rows)) return section
    const rows = section.rows.map(row => {
      if (!Array.isArray(row?.items)) return row
      const items = row.items.map(item => {
        if (!item?.ref) return item
        const { icon, iconLine } = refIcon(gameId, item.ref, record)
        return icon ? { ...item, icon, iconLine } : item
      })
      return { ...row, items }
    })
    return { ...section, rows }
  })
}

/**
 * 给配队段落挂成员头像
 * 成员由「纯名字字符串」变成 { name, plain, icon }：模板只画头像，取不到图标时才退回显示名字
 * v2 成员是 { name, ref } 对象（按 ref 严格取图，名字照样只作降级），旧版文本行成员是纯字符串
 * （旧版保持原来的宽松取图，不改现状）
 * @param {string} gameId
 * @param {Array} sections - parse.js 产出的段落数组
 * @returns {Array} 新的段落数组（非配队段原样返回）
 */
export function attachTeamIcons (gameId, sections) {
  if (!gameId || !Array.isArray(sections)) return sections
  return sections.map(section => {
    if (section?.type !== 'teams' || !Array.isArray(section.teams)) return section
    const teams = section.teams.map(team => ({
      ...team,
      members: (team.members || []).map(member => {
        const structured = member !== null && typeof member === 'object'
        const name = structured ? member.name : member
        const plain = plainText(name)
        // v2 成员按 ref（character: 前缀）严格取图；旧版只有纯名字，走原来的宽松路径
        const ref = structured ? String(member.ref || '') : ''
        const icon = (structured && member.icon) || (ref
          ? refIcon(gameId, ref, null).icon
          : characterIcon(gameId, plain))
        return { name, plain, ref, icon }
      })
    }))
    return { ...section, teams }
  })
}
