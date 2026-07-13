import plugin from '../../../lib/plugins/plugin.js'
import { getPluginConfig } from '../components/config.js'
import { renderAtlas } from '../components/render.js'

const config = getPluginConfig()

export class AtlasHelp extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴帮助',
      dsc: '#图鉴帮助',
      event: 'message',
      priority: config.priority ? config.priority - 10 : 9990,
      rule: [
        { reg: /^#图鉴帮助$/, fnc: 'handleHelp', permission: 'all' }
      ]
    })
  }

  /**
   * #图鉴帮助 — 渲染帮助图
   * 参考 ProfileImg-Plugin 模式：动态 import help-cfg.js 实现热重载
   */
  async handleHelp (e) {
    try {
      // 动态导入帮助配置（带时间戳绕过 ESM 缓存，无需重启即可更新）
      const helpPath = `${process.cwd()}/plugins/Atlas-Plugin/resources/help/help-cfg.js`
      const { helpCfg, helpList } = await import(`file://${helpPath}?t=${Date.now()}`)

      // 按权限过滤分组
      const helpGroup = []
      for (const group of helpList) {
        if (group.auth === 'master' && !e.isMaster) continue
        helpGroup.push({
          group: group.group,
          list: group.list.map(item => ({
            title: item.title,
            desc: item.desc
          }))
        })
      }

      const data = { helpCfg, helpGroup }
      const img = await renderAtlas('help', data, { imgType: 'jpeg' })
      if (img) {
        await e.reply(img)
      } else {
        await this._fallbackText(e, helpGroup)
      }
    } catch (err) {
      logger?.error('[Atlas][帮助] 渲染失败:', err)
      await e.reply(
        '[Atlas] 图鉴帮助\n\n' +
        '查询：#<关键词> / *<关键词> / %<关键词>\n' +
        '成就：#成就 / *成就 / %成就\n' +
        '挑战：#深渊 / *混沌 / %危局\n' +
        '管理：#图鉴状态 / #图鉴帮助 / #图鉴初始化 / #图鉴更新',
        true
      )
    }

    return true
  }

  /**
   * 渲染失败时的文字版回退
   */
  async _fallbackText (e, helpGroup) {
    const lines = ['[Atlas] 图鉴帮助']
    for (const group of helpGroup) {
      lines.push(`\n—— ${group.group} ——`)
      for (const item of group.list) {
        lines.push(`${item.title}：${item.desc}`)
      }
    }
    await e.reply(lines.join('\n'), true)
  }
}
