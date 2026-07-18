/**
 * 图鉴查询业务编排（搜索→加载→构建数据→选模板→渲染→回复）
 *
 * 未来若更换搜索方式，只需替换此模块，不影响 components/queryUtils.js 的数据构建器。
 */
import { search, getPageRecords, loadRecord } from '../model/AtlasService.js'
import { renderAtlas, selectTemplate } from '../components/render.js'
import { buildDetailData, buildListData } from '../components/queryUtils.js'
import { GAME_NAMES } from '../components/constants.js'

// 子视图后缀映射（{ suffix → subView }，故事和语音共享 stories，养成和素材共享 materials）
const SUB_VIEW_SUFFIXES = [
  { suffix: '天赋', subView: 'skills' },
  { suffix: '命座', subView: 'constellations' },
  { suffix: '资料', subView: 'profile' },
  { suffix: '故事', subView: 'stories' },
  { suffix: '语音', subView: 'stories' },
  { suffix: '养成', subView: 'materials' },
  { suffix: '素材', subView: 'materials' }
]

/**
 * 解析子视图后缀
 * @param {string} keyword
 * @returns {{ searchKeyword: string, subView: string|null }}
 */
function parseSubView (keyword) {
  for (const { suffix, subView } of SUB_VIEW_SUFFIXES) {
    if (keyword.endsWith(suffix)) {
      const searchKeyword = keyword.slice(0, -suffix.length).trim()
      if (searchKeyword) {
        return { searchKeyword, subView }
      }
    }
  }
  return { searchKeyword: keyword, subView: null }
}

/**
 * 处理特殊页面触发词（成就、挑战等）
 * @param {object} e - Runtime 实例
 * @param {string} gameId
 * @param {object} result - 搜索结果
 * @returns {Promise<boolean>}
 */
export async function handleSpecialQuery (e, gameId, result) {
  if (result.specialType === 'page_list') {
    const records = getPageRecords(gameId, result.pageKey)
    if (records.length === 0) {
      await e.reply(`[Atlas] ${result.pageTitle}数据为空`)
      return true
    }

    const groups = [{
      title: result.pageTitle,
      items: records.map(r => ({ name: r.name, rarity: r.rarity }))
    }]

    const data = {
      gameName: GAME_NAMES[gameId],
      keyword: result.pageTitle,
      groups,
      results: records,
      total: records.length
    }
    const tpl = selectTemplate(result)
    const img = await renderAtlas(tpl, data, { imgType: 'jpeg' })
    if (img) await e.reply(img)
    return true
  }

  if (result.specialType === 'page_detail') {
    const records = getPageRecords(gameId, result.pageKey)
    if (records.length === 0) {
      await e.reply(`[Atlas] ${result.pageTitle}数据为空`)
      return true
    }

    const latest = records[records.length - 1] || records[0]
    const record = loadRecord(latest.filePath)
    if (!record) {
      await e.reply(`[Atlas] ${latest.name} 的数据文件缺失，请执行数据抓取`)
      return true
    }
    const data = buildDetailData(gameId, { ...latest, record })
    const tpl = selectTemplate(result)
    const img = await renderAtlas(tpl, data, { imgType: 'jpeg' })
    if (img) await e.reply(img)
    else await e.reply(`[Atlas] ${data.recordName} — 渲染失败`)
    return true
  }

  return false
}

/**
 * 统一查询入口（供 apps 层调用）
 * @param {object} e - Runtime 实例
 * @param {string} gameId - gi / hsr / zzz
 * @param {string} keyword - 搜索词（可能含子视图后缀）
 * @returns {Promise<boolean>} true=消息已处理，false=继续传递
 */
export async function handleQuery (e, gameId, keyword) {
  if (!keyword) return false

  try {
    // ── 阶段 0：子视图后缀检测 ──
    const { searchKeyword, subView } = parseSubView(keyword)

    let result
    if (subView) {
      // 带后缀 → 先按剥离后的关键词搜索
      result = search(gameId, searchKeyword)
      // 首条结果为角色时保留（即使 type 为 list），否则回退到原始关键词搜索
      const topPageKey = result.results?.[0]?.pageKey
      if (result.type === 'empty' || topPageKey !== 'character') {
        result = search(gameId, keyword)
      }
    } else {
      result = search(gameId, keyword)
    }

    switch (result.type) {
      case 'empty':
        return false

      case 'exact': {
        const entry = result.results[0]
        const record = loadRecord(entry.filePath)
        if (!record) {
          await e.reply(`[Atlas] ${entry.name} 的数据文件缺失，请执行数据抓取`)
          return true
        }
        // 子视图仅对角色有效
        const effectiveSubView = (entry.pageKey === 'character') ? subView : null
        const data = buildDetailData(gameId, { ...entry, record, subView: effectiveSubView })
        const tpl = selectTemplate(result)
        const img = await renderAtlas(tpl, data, { imgType: 'jpeg' })
        if (img) await e.reply(img)
        else await e.reply(`[Atlas] ${data.recordName} — 渲染失败`)
        return true
      }

      case 'list': {
        const tpl = selectTemplate(result)
        let data
        if (tpl !== 'list') {
          const record = loadRecord(result.results[0].filePath)
          // 子视图仅对角色有效
          const effectiveSubView = (result.results[0]?.pageKey === 'character') ? subView : null
          data = record
            ? buildDetailData(gameId, { ...result.results[0], record, subView: effectiveSubView })
            : buildListData(gameId, result)
        } else {
          data = buildListData(gameId, result)
        }
        const img = await renderAtlas(tpl, data, { imgType: 'jpeg' })
        if (img) await e.reply(img)
        else await e.reply(`[Atlas] ${data.recordName || '列表'} — 渲染失败`)
        return true
      }

      case 'special':
        return handleSpecialQuery(e, gameId, result)

      default:
        return false
    }
  } catch (err) {
    logger?.error(`[Atlas] 查询出错: ${err.message}`)
    await e.reply(`[Atlas] 查询出错: ${err.message}`)
    return true
  }
}
