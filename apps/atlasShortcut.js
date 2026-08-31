/**
 * atlasShortcut — 图鉴快捷入口（priority -99999，先于 miao-plugin 执行）
 *
 * 用户显式加「图鉴」或子视图后缀时提前拦截，避免被 miao-plugin 的 accept 机制抢走。
 * 例：#胡桃图鉴 / #胡桃天赋 / #胡桃命座 / #胡桃养成素材 / #胡桃升级材料
 */
import plugin from '../../../lib/plugins/plugin.js'
import { handleQuery } from '../modules/atlasQuery.js'
import { SHORTCUT_SUFFIXES } from '../components/constants.js'
import { isBlacklisted, isSlashMsg } from '../components/blacklist.js'

const SUFFIX_REG = SHORTCUT_SUFFIXES.join('|')

export class atlasShortcut extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴快捷入口',
      dsc: '#角色图鉴 / 天赋 / 技能 / 命座 / 资料 / 故事 / 语音 / 养成 / 素材 / 材料 / 升级',
      event: 'message',
      priority: -99999,
      rule: [
        { reg: new RegExp(`^#(.+)(?:${SUFFIX_REG})$`), fnc: 'shortcutGI', permission: 'all' },
        { reg: new RegExp(`^\\*(.+)(?:${SUFFIX_REG})$`), fnc: 'shortcutHSR', permission: 'all' },
        { reg: new RegExp(`^%(.+)(?:${SUFFIX_REG})$`), fnc: 'shortcutZZZ', permission: 'all' }
      ]
    })
  }

  /**
   * 剥离「图鉴」后，其余子视图后缀（天赋/命座/养成素材等）保留，
   * 交由 handleQuery 的 parseSubView 解析出 subView（默认视图=图鉴）。
   */
  stripSuffix (raw) {
    return raw.replace(/图鉴$/, '').trim()
  }

  async shortcutGI (e) {
    // 黑名单命中：跳过不处理（返回 false 继续传递，不消费消息）
    if (isBlacklisted(e.msg)) return false
    // /→# 转换消息不作为图鉴查询：跳过（返回 false 继续传递）
    if (isSlashMsg(e)) return false

    let keyword = this.stripSuffix(e.msg.replace(/^#/, '').trim())
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
    // 黑名单命中：跳过不处理（返回 false 继续传递，不消费消息）
    if (isBlacklisted(e.msg)) return false
    // /→# 转换消息不作为图鉴查询：跳过（返回 false 继续传递）
    if (isSlashMsg(e)) return false

    return handleQuery(e, 'hsr', this.stripSuffix(e.msg.replace(/^\*/, '').trim()))
  }

  async shortcutZZZ (e) {
    // 黑名单命中：跳过不处理（返回 false 继续传递，不消费消息）
    if (isBlacklisted(e.msg)) return false
    // /→# 转换消息不作为图鉴查询：跳过（返回 false 继续传递）
    if (isSlashMsg(e)) return false

    return handleQuery(e, 'zzz', this.stripSuffix(e.msg.replace(/^%/, '').trim()))
  }
}
