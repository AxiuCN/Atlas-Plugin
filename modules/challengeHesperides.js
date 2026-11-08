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
import { buildHesperidesChallengeSections, pickHesperidesTitle } from '../components/hesperidesChallenge.js'
import { readRawByPath } from '../model/HesperidesRepository.js'
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
      await e.reply(`[Atlas] ${result.pageTitle} 本期未开放${tail}`)
      return true
    }
  }

  const period = resolved.period
  const record = readRawByPath(syntheticPath(gameId, hes.source, hes.page, period.id))
  if (!record) {
    await e.reply(`[Atlas] ${result.pageTitle} 第 ${period.no} 期的数据文件缺失，请执行 #图鉴更新`)
    return true
  }

  const data = {
    gameName: GAME_NAMES[gameId],
    pageTitle: result.pageTitle,
    recordName: pickHesperidesTitle(record) || period.name || `第 ${period.no} 期`,
    periodLine: formatPeriodLabel(gameId, period),
    sections: buildHesperidesChallengeSections(result.pageKey, record),
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
