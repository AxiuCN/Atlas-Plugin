/**
 * updateLog — 版本更新记录
 *
 * 读取后端 scrape-diff.mjs 落盘的 data/diffs/{gameId}.json，渲染 update-log.html。
 * 纯本地读取，无网络请求；不含版本参数（本地只保留一份：最新版 vs 前一版）。
 *
 * 另外提供「版本新增内容」：读 nanoka 根 manifest 的 `new` 字段（本版本新增条目 id），
 * 按实体分组并补出名称——数据来自抓取时落盘的 `data/nanoka-manifest.json`。
 *
 * 例：#版本更新记录 / #变更项目 / #新版本改动 / #版本新增内容（原神）
 *     #星铁版本更新记录 / #绝区零新增内容（前缀路由）
 */
import plugin from '../../../lib/plugins/plugin.js'
import common from '../../../lib/common/common.js'
import { renderAtlas } from '../components/render.js'
import { loadVersionDiff } from '../model/VersionDiff.js'
import { loadNewContent, formatNewContent } from '../model/NewContent.js'

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
        { reg: /^#(?:绝区零)(版本更新记录|变更项目|新版本改动)$/, fnc: 'updateLogZZZ', permission: 'all' },
        { reg: /^#(?:版本新增内容|新增内容|新版本内容)$/, fnc: 'newContentGI', permission: 'all' },
        { reg: /^#(?:星铁|星穹)(?:版本新增内容|新增内容|新版本内容)$/, fnc: 'newContentHSR', permission: 'all' },
        { reg: /^#(?:绝区零)(?:版本新增内容|新增内容|新版本内容)$/, fnc: 'newContentZZZ', permission: 'all' }
      ]
    })
  }

  /** 原神版本新增内容 */
  async newContentGI (e) {
    return this.sendNewContent(e, 'gi')
  }

  /** 星铁版本新增内容 */
  async newContentHSR (e) {
    return this.sendNewContent(e, 'hsr')
  }

  /** 绝区零版本新增内容 */
  async newContentZZZ (e) {
    return this.sendNewContent(e, 'zzz')
  }

  /**
   * 回复某游戏的「版本新增内容」
   * @param {object} e - Runtime 实例
   * @param {string} gameId - gi / hsr / zzz
   * @returns {Promise<boolean>}
   */
  async sendNewContent (e, gameId) {
    const data = loadNewContent(gameId)
    if (!data) {
      await e.reply('[Atlas] 暂无版本新增内容（执行 #图鉴更新 后生成）')
      return true
    }
    await e.reply(formatNewContent(data, { gameName: gameNameOf(gameId) }))
    return true
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

    const images = await renderAtlas('update-log', data, {
      imgType: 'jpeg',
      multiPage: true,
      multiPageHeight: 4000
    })
    if (images?.length === 1) {
      await e.reply(images[0])
    } else if (images?.length > 1) {
      const pages = images.map((img, index) => [
        `${gameNameOf(gameId)}版本更新记录 · ${index + 1}/${images.length}`,
        img
      ])
      await e.reply(await common.makeForwardMsg(e, pages))
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
