/**
 * 角色攻略页图标解析（数据源：nanoka-atlas-backend）
 *
 * 攻略数据本身只存文字，攻略页用到的图标在渲染时按名称到图鉴里现取：
 * - 武器：攻略里第一个推荐的武器名 → weapon 页条目 → meta.images 的 icon
 * - 圣遗物：第一个推荐的套装名 → artifact 页部件条目的 content.list.set[].name.zh → 该部件条目的 icon
 *   （套装没有独立图标资源，用套装部件图标代替；套装名↔图标索引进程内缓存，只读一次）
 * - 天赋：天赋加点里的优先级字母（A/E/Q）→ 角色条目 detail.skills[].promote[0].icon
 * - 命座：命座推荐里第一个命座（二命 → 第 2 个）→ 角色条目 detail.constellations[].icon
 * - 配队：队内每个角色名 → character 页条目 → meta.images 的 icon（头像，页面只出头像不出名字）
 *
 * 名称都从「已归一的攻略数据」里取（parse.js 产出的 rows / teams），取不到或图鉴缺图一律返回空串，
 * 由模板决定不渲染或退回文字，不影响文案。
 */
import { loadMap, loadRecord, search } from '../AtlasService.js'
import { normalizeForMatch } from '../AliasLoader.js'
import { imgUrl } from '../../components/sections/util.js'

/** 套装名 → 图标 URL（按游戏缓存；只构建一次） */
const setIconCache = new Map()

/** 角色名 → 条目 path（只读 map.json 索引，不读条目文件） */
const charPathCache = new Map()

/** 角色名 → 头像图标 URL（按需读条目，读到就缓存） */
const charIconCache = new Map()

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

/** 武器名 → 图标（走搜索 + 条目 icon） */
function weaponIcon (gameId, name) {
  if (!name) return ''
  let top
  try {
    const res = search(gameId, name)
    top = res?.results?.find(r => ['weapon', 'lightcone', 'equipment'].includes(r.pageKey)) || res?.results?.[0]
  } catch {
    return ''
  }
  if (!top) return ''
  const record = loadRecord(top.filePath)
  return imgUrl(record?.meta?.images, 'icon') || imgUrl(record?.meta?.images, 'detail.icon')
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
 * @returns {string} file:// URL；取不到返回空串
 */
export function characterIcon (gameId, name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  const key = `${gameId}|${raw}`
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
      url = fromRecord(top?.filePath)
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

/** 命座中文序号 → 下标 */
const CONSTELLATION_INDEX = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

function constellationIcon (record, label) {
  const m = plainText(label).match(/([一二三四五六])命/)
  const idx = m ? CONSTELLATION_INDEX[m[1]] : null
  const cons = record?.content?.detail?.constellations
  if (!idx || !Array.isArray(cons) || !cons[idx - 1]) return ''
  return imgUrl(record.meta.images, `detail.constellations.${idx - 1}.icon`)
}

/** 取段落第一行内容的纯文本（跳过标签；去掉「（二命）」这类后缀限定） */
function firstValue (section) {
  const row = section?.rows?.[0]
  if (!row) return ''
  const first = row.items?.[0]
  return plainText(first?.text || '').replace(/[（(][^）)]*[）)]?/g, '').trim()
}

/**
 * 解析攻略页各段落标题图标
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
  const talentSection = find(/天赋/)

  return {
    weapon: weaponIcon(gameId, firstValue(find(/武器/))),
    artifact: artifactIcon(gameId, firstValue(find(/圣遗物/))),
    talent: talentIcon(record, firstValue(talentSection)),
    constellation: constellationIcon(record, find(/命座/)?.rows?.[0]?.label)
  }
}

/**
 * 给配队段落挂成员头像
 * 成员由「纯名字字符串」变成 { name, plain, icon }：模板只画头像，取不到图标时才退回显示名字
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
        const plain = plainText(member)
        return { name: member, plain, icon: characterIcon(gameId, plain) }
      })
    }))
    return { ...section, teams }
  })
}
