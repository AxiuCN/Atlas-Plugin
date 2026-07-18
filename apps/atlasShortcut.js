/**
 * atlasShortcut — 图鉴快捷入口（priority -99999，先于 miao-plugin 执行）
 *
 * 用户显式加「图鉴」后缀时提前拦截，避免被 miao-plugin 的 accept 机制抢走。
 * 例：#胡桃图鉴 / *符玄图鉴 / %雅图鉴
 */
import plugin from '../../../lib/plugins/plugin.js'
import { handleQuery } from '../modules/atlasQuery.js'

export class atlasShortcut extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴快捷入口',
      dsc: '#角色图鉴 / *角色图鉴 / %角色图鉴',
      event: 'message',
      priority: -99999,
      rule: [
        { reg: /^#(.+)图鉴$/, fnc: 'shortcutGI', permission: 'all' },
        { reg: /^\*(.+)图鉴$/, fnc: 'shortcutHSR', permission: 'all' },
        { reg: /^%(.+)图鉴$/, fnc: 'shortcutZZZ', permission: 'all' }
      ]
    })
  }

  async shortcutGI (e) {
    let keyword = e.msg.replace(/^#/, '').replace(/图鉴$/, '').trim()
    let gameId = 'gi'

    // 框架会将 *xxx → #星铁xxx、%xxx → #绝区零xxx
    if (keyword.startsWith('星铁')) {
      gameId = 'hsr'
      keyword = keyword.replace(/^星铁/, '').trim()
    } else if (keyword.startsWith('绝区零')) {
      gameId = 'zzz'
      keyword = keyword.replace(/^绝区零/, '').trim()
    }

    return handleQuery(e, gameId, keyword)
  }

  async shortcutHSR (e) {
    return handleQuery(e, 'hsr', e.msg.replace(/^\*/, '').replace(/图鉴$/, '').trim())
  }

  async shortcutZZZ (e) {
    return handleQuery(e, 'zzz', e.msg.replace(/^%/, '').replace(/图鉴$/, '').trim())
  }
}
