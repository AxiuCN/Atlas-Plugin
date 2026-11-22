/**
 * 终局视图入口：按「游戏 + 玩法」选适配器，未知结构回退通用启发式
 *
 * 两种输入：
 *   - `record`：插件记录（`{ meta, content: { list, detail } }`），适配器用它取字段与图片；
 *   - `raw`：Hesperides 原始记录（预览源与通用回退是按原始字段写的）。
 * 返回 `{ summary, groups }`；两边都取不到内容时返回 null，调用方按「无数据」处理。
 */
import { groupsFromSections } from './view.js'
import { giAbyssView, giTheaterView, giStygianView, gensriStygianView, lunarisAbyssView, lunarisTheaterView } from './gi.js'
import { hsrChaosView, hsrFictionView, hsrAsView, hsrArbitrationView } from './hsr.js'
import { zzzShiyuView, zzzBossView } from './zzz.js'
import { buildHesperidesChallengeSections } from '../hesperidesChallenge.js'
import { buildPreviewSections } from '../../model/HesperidesPreview.js'
import { getHesperidesPeriodPage } from '../../model/Hesperides.js'
import { readRawByPath, syntheticPath } from '../../model/HesperidesRepository.js'
import { loadRecord } from '../../model/AtlasRepository.js'

/** 游戏 → 玩法 → 适配器 */
const ADAPTERS = {
  gi: {
    tower: giAbyssView,
    rolecombat: giTheaterView,
    leyline: giStygianView
  },
  hsr: {
    maze: hsrChaosView,
    maze_extra: hsrFictionView,
    maze_boss: hsrAsView,
    maze_peak: hsrArbitrationView
  },
  zzz: {
    shiyu: zzzShiyuView,
    boss: zzzBossView
  }
}

/**
 * 构建终局视图
 * @param {object} params
 * @param {string} params.gameId
 * @param {string} params.pageKey
 * @param {object} params.record - 插件记录（`{ meta, content: { list, detail } }`）
 * @param {object} [params.raw] - Hesperides 原始记录（缺省退化成 `record.content.list`）
 * @param {{source?: string, page?: string}|null} [params.preview] - 预览期来源（有则走预览适配器）
 * @returns {{summary: object[], groups: object[]}|null}
 */
export function buildChallengeView ({ gameId, pageKey, record, raw = null, period = null, preview = null }) {
  const rawRecord = raw || record?.content?.list || record
  let groups = null
  if (preview?.source && preview?.page) {
    // 危战的预览期只有强度研究院一侧的数据（玉璃还没出），用它的结构出同一套版式
    if (preview.source === 'gensri' && preview.page === 'stygian') groups = gensriStygianView(record, rawRecord)
    if (preview.source === 'lunaris' && preview.page === 'rolecombat') groups = lunarisTheaterView(record, rawRecord, { loadRecord: (game, source, page, id) => loadRecord(syntheticPath(game, source, page, String(id))) })
    if (preview.source === 'lunaris' && preview.page === 'tower') groups = lunarisAbyssView(record, rawRecord, { loadRecord: (game, source, page, id) => loadRecord(syntheticPath(game, source, page, String(id))) })
    if (!groups?.length) groups = groupsFromSections(buildPreviewSections(preview.source, preview.page, rawRecord))
  } else {
    const adapter = ADAPTERS[gameId]?.[pageKey]
    if (adapter) {
      try {
        groups = adapter(record, {
          period,
          rawPeriods: getHesperidesPeriodPage,
          readRecord: (game, source, page, id) => readRawByPath(syntheticPath(game, source, page, String(id))),
          loadRecord: (game, source, page, id) => loadRecord(syntheticPath(game, source, page, String(id)))
        })
      } catch {
        groups = null
      }
    }
    if (!groups?.length) groups = groupsFromSections(buildHesperidesChallengeSections(pageKey, rawRecord))
  }
  if (!groups?.length) return null
  return { summary: [], groups }
}