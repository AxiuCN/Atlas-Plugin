/**
 * 角色攻略查询编排（独立页面类型 codex）
 *
 * 触发：#胡桃攻略 / *符玄攻略 / %雅攻略（后缀登记见 components/constants.js 的 PAGE_TYPE_SUFFIXES）
 * 数据：tool/Character-Codex-Data/Character-Codex-Data（经 model/codexIndex/index.js 读取）
 * 模板：resources/atlas/codex.html
 *
 * 职责：定位图鉴条目 → 取攻略数据 → 用图鉴条目补齐 hero 展示字段（立绘 / 稀有度 / 元素等）
 * → 交模板渲染。攻略正文的解析全部在 model/codexIndex，本层不读攻略仓库文件。
 */
import { renderAtlas } from '../components/render.js'
import { GAME_NAMES, CODEX_PAGE_KEY } from '../components/constants.js'
import { buildDetailData } from '../components/queryUtils.js'
import { loadRecord } from '../model/AtlasService.js'
import { isCodexReady, getCharacterGuide } from '../model/codexIndex/index.js'

/**
 * 用图鉴条目补齐攻略页 hero 字段（立绘 / 稀有度 / 元素等 chips）
 * 读原条目而非重新搜索；条目缺失或构建失败时退回只有攻略侧字段
 * @param {string} gameId
 * @param {object} entry - search() 结果中的图鉴条目
 * @returns {{rarity: string, image: string, chips: string[]}}
 */
function buildAtlasExtra (gameId, entry) {
  const extra = { rarity: entry?.rarity || '', image: '', chips: [] }
  if (entry?.pageKey !== 'character') return extra
  try {
    const record = loadRecord(entry.filePath)
    if (!record) return extra
    const atlas = buildDetailData(gameId, { ...entry, record })
    const hero = atlas?.hero || null
    extra.rarity = atlas?.rarity || extra.rarity
    extra.image = atlas?.image || hero?.portrait || ''
    extra.chips = [...(hero?.chips || []), hero?.element, hero?.weapon].filter(Boolean)
  } catch (err) {
    logger?.warn(`[Atlas] 攻略页图鉴字段构建失败（${entry?.name || ''}）: ${err.message}`)
  }
  return extra
}

/**
 * 处理角色攻略查询
 * @param {object} e - Runtime 实例
 * @param {string} gameId - gi / hsr / zzz
 * @param {object} result - search() 的搜索结果（已按剥离后缀的关键词搜过）
 * @param {string} keyword - 剥离后缀后的关键词（角色名）
 * @returns {Promise<boolean>} true=消息已处理
 */
export async function handleCodexQuery (e, gameId, result, keyword) {
  const entry = result?.results?.[0]
  if (!entry) {
    await e.reply(`[Atlas] 未找到「${keyword}」对应的图鉴条目，无法定位攻略`)
    return true
  }

  if (!isCodexReady()) {
    await e.reply('[Atlas] 角色攻略数据尚未拉取，请先执行 #图鉴初始化 或 #图鉴更新')
    return true
  }

  const guide = getCharacterGuide(gameId, entry.name)
  if (!guide) {
    await e.reply(`[Atlas] ${entry.name} 暂无攻略数据`)
    return true
  }

  // 图鉴侧字段：攻略仓库只存正文，立绘/稀有度/元素取原条目
  const extra = buildAtlasExtra(gameId, entry)
  const chips = [...guide.chips]
  for (const chip of extra.chips) {
    if (chip && !chips.includes(chip)) chips.push(chip)
  }

  const data = {
    pageKey: CODEX_PAGE_KEY,
    pageTitle: '角色攻略',
    gameName: GAME_NAMES[gameId],
    keyword,
    name: entry.name,
    recordName: entry.name,
    rarity: extra.rarity,
    image: guide.image || extra.image,
    chips,
    guide
  }
  const img = await renderAtlas(CODEX_PAGE_KEY, data, { imgType: 'jpeg' })
  if (img) await e.reply(img)
  else await e.reply(`[Atlas] ${entry.name} — 攻略渲染失败`)
  return true
}
