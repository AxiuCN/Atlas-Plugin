/**
 * 角色攻略查询编排（独立页面类型 codex）
 *
 * 触发：#胡桃攻略 / *符玄攻略 / %雅攻略（后缀登记见 components/constants.js 的 PAGE_TYPE_SUFFIXES）
 * 数据：tool/Character-Codex-Data/Character-Codex-Data（经 model/codexIndex/index.js 读取）
 * 模板：resources/atlas/codex.html
 *
 * 当前为骨架实现：只负责定位图鉴条目 + 给出明确提示，攻略正文的解析与排版由适配者补全。
 * 适配说明见《角色攻略接入指南》（维护者提供，不随仓库分发）。
 */
import { renderAtlas } from '../components/render.js'
import { GAME_NAMES, CODEX_PAGE_KEY } from '../components/constants.js'
import { isCodexReady, getCharacterGuide } from '../model/codexIndex/index.js'

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

  const data = {
    pageKey: CODEX_PAGE_KEY,
    gameName: GAME_NAMES[gameId],
    keyword,
    name: entry.name,
    recordName: entry.name,
    guide
  }
  const img = await renderAtlas(CODEX_PAGE_KEY, data, { imgType: 'jpeg' })
  if (img) await e.reply(img)
  else await e.reply(`[Atlas] ${entry.name} — 攻略渲染失败`)
  return true
}
