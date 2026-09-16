/**
 * 图鉴查询业务编排（搜索→加载→构建数据→选模板→渲染→回复）
 *
 * 未来若更换搜索方式，只需替换此模块，不影响 components/queryUtils.js 的数据构建器。
 */
import { search, getPageRecords, loadRecord } from '../model/AtlasService.js'
import { renderAtlas, selectTemplate } from '../components/render.js'
import { buildDetailData, buildListData } from '../components/queryUtils.js'
import { GAME_NAMES, SHORTCUT_SUFFIXES, SUFFIX_TO_SUBVIEW, PAGE_TYPE_SUFFIXES, SET_SUFFIX, SET_PAGE_TYPE_BY_GAME, CODEX_PAGE_KEY } from '../components/constants.js'
import { isCodexEnabled } from '../components/config.js'
import { handleCodexQuery } from './codexQuery.js'

// 子视图后缀映射见 components/constants.js 的 SUFFIX_TO_SUBVIEW（与 atlasShortcut 后缀集合同处维护）
/** 子视图后缀列表（长→短，图鉴、页面类型与泛用套装后缀除外；顺序匹配，先命中先剥离，避免"养成素材"被拆成"养成"+"素材"） */
const SUB_VIEW_SUFFIXES = SHORTCUT_SUFFIXES
  .filter(s => s !== '图鉴' && s !== SET_SUFFIX && !PAGE_TYPE_SUFFIXES[s])
  .sort((a, b) => b.length - a.length)
  .map(s => ({ suffix: s, subView: SUFFIX_TO_SUBVIEW[s] || 'materials' }))

/** 页面类型后缀列表（长→短，只剥离并限定结果页面类型） */
const PAGE_TYPE_ENTRIES = Object.entries(PAGE_TYPE_SUFFIXES)
  .sort(([a], [b]) => b.length - a.length)

/**
 * 解析子视图/页面类型后缀
 * 页面类型后缀（圣遗物/遗器/驱动盘）优先：仅剥离关键词并把结果限定到对应页面类型
 * 泛用套装后缀「套」紧随其后，按当前游戏映射到该游戏的套装页面类型
 * @param {string} keyword
 * @param {string} gameId - gi/hsr/zzz（「套」后缀需要）
 * @returns {{ searchKeyword: string, subView: string|null, pageType: string|null }}
 */
function parseSubView (keyword, gameId) {
  for (const [suffix, pageType] of PAGE_TYPE_ENTRIES) {
    if (keyword.endsWith(suffix)) {
      const searchKeyword = keyword.slice(0, -suffix.length).trim()
      if (searchKeyword) return { searchKeyword, subView: null, pageType }
    }
  }
  // 「套」：原神 圣遗物、星铁 遗器套装、绝区零 驱动盘（如 #如雷套 / *铁卫套 / %啄木鸟套）
  const setPageType = SET_PAGE_TYPE_BY_GAME[gameId]
  if (setPageType && keyword.endsWith(SET_SUFFIX)) {
    const searchKeyword = keyword.slice(0, -SET_SUFFIX.length).trim()
    if (searchKeyword) return { searchKeyword, subView: null, pageType: setPageType }
  }
  for (const { suffix, subView } of SUB_VIEW_SUFFIXES) {
    if (keyword.endsWith(suffix)) {
      const searchKeyword = keyword.slice(0, -suffix.length).trim()
      if (searchKeyword) {
        return { searchKeyword, subView, pageType: null }
      }
    }
  }
  return { searchKeyword: keyword, subView: null, pageType: null }
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
    // ── 阶段 0：子视图 / 页面类型后缀检测 ──
    const { searchKeyword, subView, pageType } = parseSubView(keyword, gameId)

    // 攻略功能关闭（config.yaml → codex.enabled）：不搜索、不接管，直接放行给其他插件
    if (pageType === CODEX_PAGE_KEY && !isCodexEnabled()) return false

    let result
    if (subView) {
      // 带后缀 → 先按剥离后的关键词搜索
      result = search(gameId, searchKeyword)
      // 子视图只对角色生效；怪物页不做过滤（这些后缀仅用于把「#怪名掉落」这类查询导向怪物页），
      // 故首条命中角色或怪物都直接使用，不回退。否则首条为其他类型时回退：
      //  - 倍率视图（rates）：回退剥离后缀的关键词普通查询（#xxx倍率 → #xxx 图鉴视图）
      //  - 其他子视图：回退原始关键词搜索
      const topPageKey = result.results?.[0]?.pageKey
      const usable = result.type !== 'empty' && (topPageKey === 'character' || topPageKey === 'monster')
      if (!usable) {
        result = subView === 'rates'
          ? search(gameId, searchKeyword)
          : search(gameId, keyword)
      }
    } else if (pageType) {
      // 页面类型后缀（圣遗物/遗器/驱动盘）：按剥离后的关键词搜索，结果限定到该类型
      result = search(gameId, searchKeyword)
    } else {
      result = search(gameId, keyword)
    }

    // 角色攻略（独立页面类型）：不做结果收敛，交给 codexQuery 以专用模板渲染
    if (pageType === CODEX_PAGE_KEY) {
      return await handleCodexQuery(e, gameId, result, searchKeyword)
    }

    // 结果按页面类型收敛：限定类型无任何命中 → 放行给其他插件
    // （例：#胡桃圣遗物 是 miao-plugin 的角色圣遗物评分查询，图鉴里没有对应页面类型，
    //   不能被本插件消费，否则消息永远到不了 miao）
    if (pageType && result.results?.length) {
      const hit = result.results.filter(r => r.pageKey === pageType)
      if (hit.length === 0) return false
      result = { ...result, results: hit, total: hit.length }
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
        let tpl = selectTemplate(result)
        let data
        if (tpl !== 'list') {
          const record = loadRecord(result.results[0].filePath)
          // 子视图仅对角色有效
          const effectiveSubView = (result.results[0]?.pageKey === 'character') ? subView : null
          if (record) {
            data = buildDetailData(gameId, { ...result.results[0], record, subView: effectiveSubView })
          } else {
            data = buildListData(gameId, result)
            tpl = 'list'
          }
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
