import plugin from '../../../lib/plugins/plugin.js'
import { getIndex, getCategoryDetail } from '../model/AchievementService.js'
import { renderAtlas } from '../components/render.js'

export class achievement extends plugin {
  constructor () {
    super({
      name: 'Atlas成就浏览',
      dsc: '成就目录浏览：*成就 查看分类 / *成就<分类名> 查看详情',
      event: 'message',
      priority: 9990,
      rule: [
        // GI: #成就 → 不触发框架前缀转换
        { reg: /^#成就(.*)$/, fnc: 'achievementGI', permission: 'all', log: false },
        // HSR: *成就 → 框架转换为 #星铁成就，此正则匹配转换后形态
        { reg: /^#星铁成就(.*)$/, fnc: 'achievementHSR', permission: 'all', log: false },
        // ZZZ: %成就 → 框架转换为 #绝区零成就
        { reg: /^#绝区零成就(.*)$/, fnc: 'achievementZZZ', permission: 'all', log: false }
      ]
    })
  }

  /** GI: 参数从 e.msg 提取 "成就" 后的部分 */
  async achievementGI (e) {
    const categoryName = e.msg.replace(/^#成就/, '').trim()
    return this._handle(e, 'gi', categoryName)
  }

  /** HSR: 参数为捕获组 1（转换后 #星铁成就 之后的部分） */
  async achievementHSR (e) {
    const match = e.msg.match(/^#星铁成就(.*)$/)
    const categoryName = match ? match[1].trim() : ''
    return this._handle(e, 'hsr', categoryName)
  }

  /** ZZZ: 参数为捕获组 1（转换后 #绝区零成就 之后的部分） */
  async achievementZZZ (e) {
    const match = e.msg.match(/^#绝区零成就(.*)$/)
    const categoryName = match ? match[1].trim() : ''
    return this._handle(e, 'zzz', categoryName)
  }

  /**
   * 统一处理：无分类名 → 索引页 / 有分类名 → 详情页
   */
  async _handle (e, gameId, categoryName) {
    try {
      if (!categoryName) {
        return await this._renderIndex(e, gameId)
      }
      return await this._renderCategory(e, gameId, categoryName)
    } catch (err) {
      logger?.error(`[Atlas] 成就查询出错: ${err.message}`)
      await e.reply(`[Atlas] 成就查询出错: ${err.message}`)
      return true
    }
  }

  /**
   * 渲染分类索引页（卡片网格）
   */
  async _renderIndex (e, gameId) {
    const data = getIndex(gameId)

    if (data.totalCategories === 0) {
      await e.reply(`[Atlas] ${data.gameName}暂无成就数据`)
      return true
    }

    const prefix = { gi: '#', hsr: '*', zzz: '%' }[gameId]

    const img = await renderAtlas('achievement', {
      ...data,
      prefix,
      allOnDisk: data.missingFiles === 0,
      categories: data.categories.map(c => ({
        ...c,
        countDisplay: c.count != null ? `${c.count}项` : '?项',
        cardClass: c.onDisk ? '' : 'missing'
      }))
    })

    if (img) await e.reply(img)
    else await e.reply('[Atlas] 成就目录渲染失败')
    return true
  }

  /**
   * 渲染分类详情页（成就列表）
   */
  async _renderCategory (e, gameId, categoryName) {
    const data = getCategoryDetail(gameId, categoryName)

    if (data.error) {
      const msgs = {
        page_missing: `[Atlas] ${data.gameName || ''}成就数据不可用`,
        category_not_found: `[Atlas] 未在${GAME_NAMES[gameId]}中找到成就分类"${categoryName}"`,
        data_missing: `[Atlas] 成就分类"${categoryName}"的数据文件缺失，请执行 #图鉴更新`
      }
      await e.reply(msgs[data.error] || msgs.page_missing)
      return true
    }

    const img = await renderAtlas('achievement-category', data)

    if (img) await e.reply(img)
    else await e.reply('[Atlas] 成就分类渲染失败')
    return true
  }
}

/** 游戏 ID → 中文名（与 constants.js 保持同步） */
const GAME_NAMES = {
  gi: '原神',
  hsr: '星铁',
  zzz: '绝区零'
}
