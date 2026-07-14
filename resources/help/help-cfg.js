/**
 * Atlas-Plugin 帮助配置
 * 修改此文件后无需重启 bot（help.js 使用动态 import 热重载）
 */

export const helpCfg = {
  title: '#Atlas图鉴帮助',
  subTitle: 'Atlas-Plugin 多游戏图鉴查询'
}

export const helpList = [
  {
    group: '图鉴查询',
    list: [
      { title: '#<关键词>', desc: '原神图鉴查询（精确匹配→详情页，模糊→结果列表）' },
      { title: '*<关键词>', desc: '星穹铁道图鉴查询' },
      { title: '%<关键词>', desc: '绝区零图鉴查询' }
    ]
  },
  {
    group: '特殊页面',
    list: [
      { title: '#成就 / *成就 / %成就', desc: '查看成就分类目录，追加分类名可查看具体成就列表' },
      { title: '#深渊 / *混沌 / %危局', desc: '查看对应游戏最新一期挑战详情' }
    ]
  },
  {
    group: '图鉴管理（仅主人）',
    auth: 'master',
    list: [
      { title: '#图鉴初始化', desc: '检查拉取子模块、安装依赖、首次抓取数据及图片（后台异步）' },
      { title: '#图鉴强制初始化', desc: '跳过完整性检查，强制重新全量抓取' },
      { title: '#图鉴更新', desc: '增量更新图鉴数据（异步后台执行）' }
    ]
  },
  {
    group: '图鉴信息',
    list: [
      { title: '#图鉴状态', desc: '查看各游戏数据版本、条目数、图片下载统计' },
      { title: '#图鉴帮助', desc: '显示本帮助页' }
    ]
  }
]
