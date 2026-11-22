/**
 * 挑战页：优先用 Hesperides 数据出图
 *
 * 数据来源（Hesperides 产物）：
 *   - 玉璃：gi 深渊/剧诗/危战、hsr 混沌/虚构/末日/仲裁（期与条目都更完整）
 *   - nanoka：zzz 式舆/危局（玉璃没有绝区零）
 *
 * 期索引与渲染都走 Hesperides；没有期数据由调用方直接回「暂无可数据」，不回退旧的 map.json 路径。
 */
import { renderAtlas } from '../components/render.js'
import { pickHesperidesTitle } from '../components/hesperidesChallenge.js'
import { buildChallengeView } from '../components/challenge/index.js'
import { readRawByPath } from '../model/HesperidesRepository.js'
import { loadRecord } from '../model/AtlasRepository.js'
import { syntheticPath } from '../model/HesperidesRepository.js'
import { pickCurrent, resolvePeriodSpec, periodMissReply, formatPeriodLabel, formatPeriodDate } from '../model/ChallengePeriod.js'
import { GAME_NAMES } from '../components/constants.js'

/**
 * 用 Hesperides 的期与条目渲染挑战详情
 * @param {object} e - Runtime 实例
 * @param {string} gameId
 * @param {object} result - 特殊触发结果（含 pageKey / pageTitle）
 * @param {{source: string, page: string, periods: object[]}} hes - 期表
 * @param {object|null} periodSpec - 期修饰
 * @returns {Promise<boolean>}
 */
export async function handleHesperidesChallenge (e, gameId, result, hes, periodSpec = null) {
  const now = new Date()
  let resolved
  if (periodSpec) {
    resolved = resolvePeriodSpec(gameId, result.pageKey, periodSpec, now, hes.periods)
    if (resolved.state === 'closed') {
      await e.reply(`[Atlas] ${result.pageTitle} 本期未开放`)
      return true
    }
    const miss = periodMissReply(result.pageTitle, resolved)
    if (miss) {
      await e.reply(miss)
      return true
    }
  } else {
    resolved = pickCurrent(hes.periods, now)
    if (!resolved.period) {
      const latest = resolved.latest
      const tail = latest?.end ? `（数据截至 ${formatPeriodDate(latest.end)}）` : ''
      const next = resolved.next
      const hint = next
        ? `；下一期：${next.name || `第 ${next.no} 期`} ${formatPeriodDate(next.begin)} 起`
        : ''
      await e.reply(`[Atlas] ${result.pageTitle} 本期未开放${tail}${hint}`)
      return true
    }
  }

  const period = resolved.period
  // 前瞻期：期表来自玉璃，内容来自预览源（月亮网/强度研究院/nanoka），读取路径随之切换
  const isPreview = period.preview === true
  const recordPath = isPreview
    ? syntheticPath(gameId, period.previewSource, period.previewPage, period.previewRecordId)
    : syntheticPath(gameId, hes.source, hes.page, period.id)
  const raw = readRawByPath(recordPath)
  if (!raw) {
    await e.reply(isPreview
      ? `[Atlas] ${result.pageTitle} 第 ${period.no} 期是预告数据，对应的 ${period.previewSource} 记录还没抓到，请执行 #图鉴更新`
      : `[Atlas] ${result.pageTitle} 第 ${period.no} 期的数据文件缺失，请执行 #图鉴更新`)
    return true
  }
  // 视图层要的是插件记录（带 `meta.images`，图标按 fieldPath 取本地图）
  const record = loadRecord(recordPath)
  const view = buildChallengeView({
    gameId,
    pageKey: result.pageKey,
    record,
    raw,
    period,
    preview: isPreview ? { source: period.previewSource, page: period.previewPage } : null
  })

  const data = {
    gameName: GAME_NAMES[gameId],
    pageTitle: result.pageTitle,
    // 期名优先，但玉璃索引里的「期名」经常是关卡名（异相仲裁就是「隐藏关卡」），不能直接当标题；
    // 异相仲裁改用「版本 + 页名」；绝区零没有期名，记录标题（「剧变节点」）才是用户认得的叫法
    recordName: (gameId === 'hsr' && result.pageKey === 'maze_peak' && period.version
      ? `${period.version} ${result.pageTitle}`
      : period.name) || (gameId === 'zzz' ? pickHesperidesTitle(raw) : '') || `第 ${period.no} 期`,
    periodLine: [
      formatPeriodLabel(gameId, period),
      period.suspect === 'long-span' ? '期跨度异常，待确认' : ''
    ].filter(Boolean).join(' · '),
    summary: view?.summary || [],
    groups: view?.groups || [],
    rawFields: [],
    image: '',
    desc: '',
    rarity: '',
    metaFields: []
  }
  const img = await renderAtlas('challenge', data, { imgType: 'jpeg' })
  if (img) await e.reply(img)
  else await e.reply(`[Atlas] ${data.recordName} — 渲染失败`)
  return true
}
