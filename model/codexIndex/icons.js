/**
 * 角色攻略页图标解析（数据源：nanoka-atlas-backend）
 *
 * 攻略数据本身只存文字，攻略页顶部需要的图标在渲染时按名称到图鉴里现取：
 * - 武器：攻略里第一个推荐的武器名 → weapon 页条目 → meta.images 的 icon
 * - 圣遗物：第一个推荐的套装名 → artifact 页部件条目的 content.list.set[].name.zh → 该部件条目的 icon
 *   （套装没有独立图标资源，用套装部件图标代替；套装名↔图标索引进程内缓存，只读一次）
 * - 天赋：天赋加点里的优先级字母（A/E/Q）→ 角色条目 detail.skills[].promote[0].icon
 * - 命座：命座推荐里第一个命座（二命 → 第 2 个）→ 角色条目 detail.constellations[].icon
 *
 * 名称/字母都从「已归一化的攻略数据」里取（parse.js 产出的 rows），取不到或图鉴缺图一律返回空串，
 * 由模板决定不渲染，不影响文案。
 */
import { loadMap, loadRecord, search } from '../AtlasService.js'
import { imgUrl } from '../../components/sections/util.js'

/** 套装名 → 图标 URL（按游戏缓存；只构建一次） */
const setIconCache = new Map()

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
