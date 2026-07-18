/**
 * 图鉴查询业务编排（搜索→加载→构建数据→选模板→渲染→回复）
 *
 * 未来若更换搜索方式，只需替换此模块，不影响 components/queryUtils.js 的数据构建器。
 */
import { search, getPageRecords, loadRecord } from '../model/AtlasService.js'
import { renderAtlas, selectTemplate } from '../components/render.js'
import { buildDetailData, buildListData } from '../components/queryUtils.js'
import { GAME_NAMES } from '../components/constants.js'

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
 * @param {string} keyword - 搜索词
 * @returns {Promise<boolean>} true=消息已处理，false=继续传递
 */
export async function handleQuery (e, gameId, keyword) {
  if (!keyword) return false

  try {
    const result = search(gameId, keyword)

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
        const data = buildDetailData(gameId, { ...entry, record })
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
          data = record
            ? buildDetailData(gameId, { ...result.results[0], record })
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
