/**
 * 图鉴查询业务编排（搜索→加载→构建数据→选模板→渲染→回复）
 *
 * 未来若更换搜索方式，只需替换此模块，不影响 components/queryUtils.js 的数据构建器。
 */
import { search, getPageRecords, loadRecord } from '../model/AtlasService.js'
import { renderAtlas, selectTemplate } from '../components/render.js'
import { buildDetailData, buildListData } from '../components/queryUtils.js'
import { GAME_NAMES, SHORTCUT_SUFFIXES, SUFFIX_TO_SUBVIEW, PAGE_TYPE_SUFFIXES, SET_SUFFIX, SET_PAGE_TYPE_BY_GAME, SIGNATURE_SUFFIX, SIGNATURE_SHORT_SUFFIX } from '../components/constants.js'
import { loadAliasMap, normalizeForMatch, isSignatureKeyword, signatureLabelMarker, resolveSignatureWeapons, expandSignatureKeyword } from '../model/AliasLoader.js'

// 子视图后缀映射见 components/constants.js 的 SUFFIX_TO_SUBVIEW（与 atlasShortcut 后缀集合同处维护）
/** 子视图后缀列表（长→短，图鉴、页面类型、泛用套装与专武（含简写）后缀除外；顺序匹配，先命中先剥离，避免"养成素材"被拆成"养成"+"素材"） */
const SUB_VIEW_SUFFIXES = SHORTCUT_SUFFIXES
  .filter(s => s !== '图鉴' && s !== SET_SUFFIX && s !== SIGNATURE_SUFFIX && s !== SIGNATURE_SHORT_SUFFIX && !PAGE_TYPE_SUFFIXES[s])
  .sort((a, b) => b.length - a.length)
  .map(s => ({ suffix: s, subView: SUFFIX_TO_SUBVIEW[s] || 'materials' }))

/** 页面类型后缀列表（长→短，只剥离并限定结果页面类型） */
const PAGE_TYPE_ENTRIES = Object.entries(PAGE_TYPE_SUFFIXES)
  .sort(([a], [b]) => b.length - a.length)

/**
 * 查询异常的对外文案
 *
 * 异常信息里带服务器绝对路径、模块名等实现细节，只写日志；群里只给可操作的提示。
 */
const QUERY_ERROR_REPLY = '[Atlas] 查询出错了，请稍后再试；若一直失败请让主人查看日志'

/**
 * 解析子视图/页面类型后缀
 * 页面类型后缀（圣遗物/遗器/驱动盘）优先：仅剥离关键词并把结果限定到对应页面类型
 * 泛用套装后缀「套」紧随其后，按当前游戏映射到该游戏的套装页面类型
 *
 * **原词是别名时不剥离**：别名层里存在「本身带后缀」的名字——`风套`（翠绿之影）、
 * `奶套`、`水套`、`虹的行迹`（原神武器，而「行迹」是星铁的角色子视图后缀）等。
 * 无条件剥离会把它们打散：`#风套` → 搜 `风` → 落到旅行者·风，收敛后要么擦边命中
 * 别的圣遗物（渲染出错图）、要么直接放行；`#奶套` 则是放行。故剥前先查别名表
 * （按游戏过滤，含用户自定义层）：命中即按原词检索，后缀语义照旧保留。
 * @param {string} keyword
 * @param {string} gameId - gi/hsr/zzz（「套」后缀需要）
 * @returns {{ searchKeyword: string, subView: string|null, pageType: string|null }}
 */
function parseSubView (keyword, gameId) {
  // 惰性求值：只有真的命中某个后缀时才查别名表，普通关键词零开销
  let rawIsAlias = null
  const isRawAlias = () => {
    if (rawIsAlias === null) {
      const aliases = loadAliasMap(gameId)
      rawIsAlias = (aliases.get(normalizeForMatch(keyword)) || [])
        .some(item => !item.game || item.game === GAME_NAMES[gameId])
    }
    return rawIsAlias
  }
  /** 剥离后缀得到检索词；原词本身已是别名时保留原词 */
  const cut = (suffix) => (isRawAlias() ? keyword : keyword.slice(0, -suffix.length).trim())

  /**
   * 疑似 miao 面板变换语法（`#胡桃换护摩专武` / `#胡桃补武器 xx`）
   * 只作「解析失败后的兜底判据」，不做前置闸门——名字本身含「换/补」的角色仍能正常查
   */
  const looksLikePanelChange = (text) => /[换补]/.test(text || '')

  // 「<角色>专武」/ 简写「<角色>专」：数据源没有专武字段，只认别名表登记；这里归一成「角色 → 武器」。
  // 先直查整串（保住 `万叶专武`、`温迪新专武` 这类逐条写法），再按角色名闭包拼「候选+(修饰)专武」兜底。
  // 单条优先：同一角色有多把时（温迪：专武=终末 / 新专武=黎明），`#X专武` 取不带修饰的那把，
  // 要新的必须显式写 `#X新专武`——不把多把合成列表（用户实测列表页不符合预期）。
  if (isSignatureKeyword(keyword)) {
    // 简写「专」统一补成「专武」：`丝柯克专` → `丝柯克专武`、`温迪新专` → `温迪新专武`
    const full = expandSignatureKeyword(keyword)
    // 裸后缀（`#专` / `#专武`）不当专武查询，交回普通搜索
    if (full.length > SIGNATURE_SUFFIX.length) {
      const gameMap = loadAliasMap(GAME_NAMES[gameId] ? gameId : undefined)
      const direct = gameMap.get(normalizeForMatch(full)) || []
      const marker = signatureLabelMarker(full)
      const suffixLen = SIGNATURE_SUFFIX.length
      if (marker) {
        // 显式写了修饰词（如「新专武」/「新专」）：直查整串，未命中再按角色闭包找该修饰的专武
        // （例：`#风神新专武` → 风神 → 温迪 → 温迪新专武 → 黎明破晓之史）
        const base = full.slice(0, -(marker.length + suffixLen))
        const directWeapons = direct.map(item => ({ weapon: item.value, label: marker + SIGNATURE_SUFFIX }))
        const weapons = directWeapons.length ? directWeapons : resolveSignatureWeapons(base, gameId, marker)
        if (!weapons.length) {
          // 面板变换形状（`#胡桃换护摩新专武`）：解析失败就不该由图鉴回答，放行给 miao
          if (looksLikePanelChange(base)) {
            return { searchKeyword: keyword, subView: null, pageType: null, signature: { state: 'pass', base } }
          }
          // 区分「没有这个修饰的专武」与「根本没有专武数据」——前者要给出现有专武，不能笼统说未收录
          const available = resolveSignatureWeapons(base, gameId)
          return {
            searchKeyword: keyword,
            subView: null,
            pageType: null,
            signature: { state: 'miss', weapons: [], base, marker, available, reason: available.length ? 'no-marker' : 'none' }
          }
        }
        return {
          searchKeyword: weapons[0].weapon,
          subView: null,
          pageType: null,
          signature: { state: 'single', weapons, base }
        }
      }
      const base = full.slice(0, -suffixLen)
      const merged = direct.map(item => ({ weapon: item.value, label: SIGNATURE_SUFFIX }))
      for (const hit of resolveSignatureWeapons(base, gameId)) {
        if (!merged.some(item => item.weapon === hit.weapon && item.label === hit.label)) merged.push(hit)
      }
      if (merged.length === 0) {
        // 面板变换形状（`#胡桃换护摩专武`）：解析失败就放行，不回复「暂未收录」也不吞 miao 的指令
        if (looksLikePanelChange(base)) {
          return { searchKeyword: keyword, subView: null, pageType: null, signature: { state: 'pass', base } }
        }
        return { searchKeyword: keyword, subView: null, pageType: null, signature: { state: 'miss', weapons: [], base } }
      }
      // 多条时优先「专武」那条（无修饰），其余作为「另有」信息丢弃渲染、不影响落点
      const preferred = merged.find(item => item.label === SIGNATURE_SUFFIX) || merged[0]
      return { searchKeyword: preferred.weapon, subView: null, pageType: null, signature: { state: 'single', weapons: [preferred], others: merged.filter(item => item !== preferred), base } }
    }
  }

  for (const [suffix, pageType] of PAGE_TYPE_ENTRIES) {
    if (keyword.endsWith(suffix)) {
      const searchKeyword = cut(suffix)
      if (searchKeyword) return { searchKeyword, subView: null, pageType }
    }
  }
  // 「套」：原神 圣遗物、星铁 遗器套装、绝区零 驱动盘（如 #如雷套 / *铁卫套 / %啄木鸟套）
  const setPageType = SET_PAGE_TYPE_BY_GAME[gameId]
  if (setPageType && keyword.endsWith(SET_SUFFIX)) {
    const searchKeyword = cut(SET_SUFFIX)
    if (searchKeyword) return { searchKeyword, subView: null, pageType: setPageType }
  }
  for (const { suffix, subView } of SUB_VIEW_SUFFIXES) {
    if (keyword.endsWith(suffix)) {
      const searchKeyword = cut(suffix)
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
    // ── 阶段 0：子视图 / 页面类型 / 专武后缀检测 ──
    const { searchKeyword, subView, pageType, signature } = parseSubView(keyword, gameId)

    // 面板变换形状（含「换/补」）解析失败：不回答，交回 miao
    if (signature?.state === 'pass') return false

    // 「<角色>专武」没登记过：能认出是角色就明说，否则放行给其它插件
    if (signature?.state === 'miss') {
      const top = search(gameId, signature.base || keyword)?.results?.[0]
      if (top?.pageKey === 'character') {
        if (signature.reason === 'no-marker' && signature.available?.length) {
          // 只是没有这个修饰的专武（如钟离没有新专武），但角色本身有专武 —— 必须给出现有专武
          const list = signature.available
            .map(item => item.label === SIGNATURE_SUFFIX ? `「${item.weapon}」` : `「${item.weapon}」（${item.label}）`)
            .join('、')
          await e.reply(`[Atlas]「${top.name}」没有${signature.marker}专武；目前收录的专武是${list}`)
        } else {
          await e.reply(`[Atlas] 暂未收录「${top.name}」的专武数据`)
        }
        return true
      }
      return false
    }

    let result
    if (signature?.state === 'single') {
      result = search(gameId, signature.weapons[0].weapon)
    } else if (subView) {
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
    logger?.error('[Atlas] 查询出错:', err)
    await e.reply(QUERY_ERROR_REPLY)
    return true
  }
}
