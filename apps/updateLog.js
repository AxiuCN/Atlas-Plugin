/**
 * updateLog — 版本更新记录
 *
 * 读取后端 scrape-diff.mjs 落盘的 data/diffs/{gameId}.json，渲染 update-log.html。
 * 纯本地读取，无网络请求；不含版本参数（本地只保留一份：最新版 vs 前一版）。
 *
 * 例：#版本更新记录 / #变更项目 / #新版本改动（原神）
 *     #星铁版本更新记录 / #绝区零版本更新记录（前缀路由）
 */
import plugin from '../../../lib/plugins/plugin.js'
import { renderAtlas } from '../components/render.js'
import { loadVersionDiff } from '../model/VersionDiff.js'

export class AtlasUpdateLog extends plugin {
  constructor () {
    super({
      name: 'Atlas版本更新记录',
      dsc: '#版本更新记录 / #变更项目 / #新版本改动',
      event: 'message',
      priority: 9000, // 高于常规查询（10000），低于快捷入口（-99999）与别名管理（8000）
      rule: [
        { reg: /^#(版本更新记录|变更项目|新版本改动)$/, fnc: 'updateLogGI', permission: 'all' },
        { reg: /^#(?:星铁|星穹)(版本更新记录|变更项目|新版本改动)$/, fnc: 'updateLogHSR', permission: 'all' },
        { reg: /^#(?:绝区零)(版本更新记录|变更项目|新版本改动)$/, fnc: 'updateLogZZZ', permission: 'all' }
      ]
    })
  }

  /**
   * 渲染版本更新记录图
   * @param {object} e - Runtime 实例
   * @param {string} gameId - gi / hsr / zzz
   * @returns {Promise<boolean>}
   */
  async renderLog (e, gameId) {
    const data = loadVersionDiff(gameId)

    if (!data) {
      await e.reply(`[Atlas] 暂无${gameNameOf(gameId)}版本更新记录，执行 #图鉴更新 后自动生成`)
      return true
    }

    const img = await renderAtlas('update-log', data, { imgType: 'jpeg' })
    if (img) {
      await e.reply(img)
    } else {
      await e.reply('[Atlas] 版本更新记录渲染失败')
    }
    return true
  }

  async updateLogGI (e) {
    return this.renderLog(e, 'gi')
  }

  async updateLogHSR (e) {
    return this.renderLog(e, 'hsr')
  }

  async updateLogZZZ (e) {
    return this.renderLog(e, 'zzz')
  }
}

function gameNameOf (gameId) {
  return { gi: '原神', hsr: '星铁', zzz: '绝区零' }[gameId] || gameId
}