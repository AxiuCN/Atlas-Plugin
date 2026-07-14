/** 图鉴常量定义 */

// 前缀 → 游戏映射
export const PREFIX_GAME = {
  '#': 'gi',
  '*': 'hsr',
  '%': 'zzz'
}

// 游戏 ID → 中文名
export const GAME_NAMES = {
  gi: '原神',
  hsr: '星铁',
  zzz: '绝区零'
}

// 游戏 ID → folder 名（对应 data/items/ 下的目录）
export const GAME_FOLDERS = {
  gi: '原神',
  hsr: '星铁',
  zzz: '绝区零'
}

// 页面 pageKey → 中文标签（三游戏通用回退）
export const PAGE_LABELS = {
  // 通用
  character: '角色',
  weapon: '武器',
  monster: '敌人',
  item: '物品',
  'achievement/achievement': '成就',
  // 原神特有
  artifact: '圣遗物',
  gcg: '七圣召唤',
  furniture: '摆设',
  suite: '摆设套装',
  tower: '深境螺旋',
  leyline: '地脉异常',
  rolecombat: '幻想真境剧诗',
  // 星铁特有
  lightcone: '光锥',
  relicset: '遗器套装',
  maze_boss: '末日幻影',
  maze: '混沌回忆',
  maze_peak: '异相仲裁',
  maze_extra: '虚构叙事',
  // 绝区零特有
  equipment: '驱动盘',
  bangboo: '邦布',
  boss: '危局强袭战',
  shiyu: '式舆防卫战',
  simul: '作战影像回顾'
}

// 页面优先级权重（用于搜索评分，数值越高排名越前）
export const PAGE_PRIORITY = Object.freeze({
  // 角色/武器 — 最高优先级
  '角色': 240,
  '武器': 220,
  '光锥': 220,
  // 挑战类
  '深境螺旋': 210,
  '地脉异常': 210,
  '幻想真境剧诗': 210,
  '混沌回忆': 210,
  '末日幻影': 210,
  '虚构叙事': 210,
  '异相仲裁': 210,
  '式舆防卫战': 210,
  '危局强袭战': 210,
  // 套装/圣遗物
  '圣遗物': 180,
  '遗器套装': 180,
  '驱动盘': 180,
  // 其他
  '邦布': 120,
  '敌人': 110,
  '物品': 20,
  '摆设': 10
  // 七圣召唤/摆设套装/作战影像回顾/成就 等不列 → 默认 0
})

// 特殊页面触发词（不受常规搜索覆盖，触发特殊逻辑）
export const SPECIAL_TRIGGERS = {
  gi: {
    '深渊': { pageKey: 'tower', type: 'page_detail' },
    '深境螺旋': { pageKey: 'tower', type: 'page_detail' },
    '剧诗': { pageKey: 'rolecombat', type: 'page_detail' },
    '幻想真境剧诗': { pageKey: 'rolecombat', type: 'page_detail' }
  },
  hsr: {
    '混沌': { pageKey: 'maze', type: 'page_detail' },
    '混沌回忆': { pageKey: 'maze', type: 'page_detail' },
    '末日': { pageKey: 'maze_boss', type: 'page_detail' },
    '末日幻影': { pageKey: 'maze_boss', type: 'page_detail' },
    '虚构': { pageKey: 'maze_extra', type: 'page_detail' },
    '虚构叙事': { pageKey: 'maze_extra', type: 'page_detail' }
  },
  zzz: {
    '防卫战': { pageKey: 'shiyu', type: 'page_detail' },
    '式舆': { pageKey: 'shiyu', type: 'page_detail' },
    '危局': { pageKey: 'boss', type: 'page_detail' },
    '强袭': { pageKey: 'boss', type: 'page_detail' },
    '危局强袭战': { pageKey: 'boss', type: 'page_detail' }
  }
}

// Data 目录路径（相对于 submodule）
export const DATA_DIR = 'tool/nanoka-atlas-backend/nanoka-atlas-backend/data'

// 搜索结果上限
export const MAX_RESULTS = 30
