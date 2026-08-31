import plugin from '../../../lib/plugins/plugin.js'
import { handleQuery } from '../modules/atlasQuery.js'
import { getPluginConfig } from '../components/config.js'
import { isBlacklisted } from '../components/blacklist.js'

const config = getPluginConfig()

export class atlas extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴',
      dsc: '多游戏图鉴查询：#原神 *星铁 %绝区零',
      event: 'message',
      priority: config.priority || 10000,
      rule: [
        { reg: /^#(.+)$/, fnc: 'atlasGI', permission: 'all' },
        { reg: /^\*(.+)$/, fnc: 'atlasHSR', permission: 'all' },
        { reg: /^%(.+)$/, fnc: 'atlasZZZ', permission: 'all' }
      ]
    })
  }

  /** 原神 # 前缀 — 同时检测框架转换的星铁/绝区零前缀并路由 */
  async atlasGI (e) {
    // 黑名单命中：跳过不处理（返回 false 继续传递，不消费消息）
    if (isBlacklisted(e.msg)) return false

    let keyword = e.msg.replace(/^#/, '').trim()
    let gameId = 'gi'

    if (keyword.startsWith('星铁')) {
      gameId = 'hsr'
      keyword = keyword.replace(/^星铁/, '').trim()
    } else if (keyword.startsWith('绝区零')) {
      gameId = 'zzz'
      keyword = keyword.replace(/^绝区零/, '').trim()
    }

    return handleQuery(e, gameId, keyword)
  }

  /** 星铁 * 前缀 */
  async atlasHSR (e) {
    // 黑名单命中：跳过不处理（返回 false 继续传递，不消费消息）
    if (isBlacklisted(e.msg)) return false

    return handleQuery(e, 'hsr', e.msg.replace(/^\*/, '').trim())
  }

  /** 绝区零 % 前缀 */
  async atlasZZZ (e) {
    // 黑名单命中：跳过不处理（返回 false 继续传递，不消费消息）
    if (isBlacklisted(e.msg)) return false

    return handleQuery(e, 'zzz', e.msg.replace(/^%/, '').trim())
  }
}
