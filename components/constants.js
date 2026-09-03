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

// 快捷入口/子视图后缀集合（atlasShortcut 正则与 atlasQuery 子视图解析共用）
// 注意顺序：长后缀在前（"养成素材"需在"养成"/"素材"前匹配）
export const SHORTCUT_SUFFIXES = [
  '图鉴', '养成素材', '升级素材', '升级材料',
  '天赋', '技能', '命座', '资料', '故事', '语音',
  '养成', '素材', '材料', '升级'
]

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
  '深境螺旋': 200,
  '地脉异常': 200,
  '幻想真境剧诗': 200,
  '混沌回忆': 200,
  '末日幻影': 200,
  '虚构叙事': 200,
  '异相仲裁': 200,
  '式舆防卫战': 200,
  '危局强袭战': 200,
  // 套装/圣遗物
  '圣遗物': 210,
  '遗器套装': 210,
  '驱动盘': 210,
  // 其他
  '邦布': 120,
  '敌人': 110,
  '物品详情': 30,
  '物品': 20,
  '摆设': 10
  // 七圣召唤/摆设套装/作战影像回顾/成就 等不列 → 默认 0
})

// 特殊页面触发词（不受常规搜索覆盖，触发特殊逻辑）
export const SPECIAL_TRIGGERS = {
  gi: {
    '成就': { pageKey: 'achievement/achievement', type: 'page_list' },
    '深渊': { pageKey: 'tower', type: 'page_detail' },
    '深境螺旋': { pageKey: 'tower', type: 'page_detail' },
    '剧诗': { pageKey: 'rolecombat', type: 'page_detail' },
    '幻想真境剧诗': { pageKey: 'rolecombat', type: 'page_detail' }
  },
  hsr: {
    '成就': { pageKey: 'achievement/achievement', type: 'page_list' },
    '混沌': { pageKey: 'maze', type: 'page_detail' },
    '混沌回忆': { pageKey: 'maze', type: 'page_detail' },
    '末日': { pageKey: 'maze_boss', type: 'page_detail' },
    '末日幻影': { pageKey: 'maze_boss', type: 'page_detail' },
    '虚构': { pageKey: 'maze_extra', type: 'page_detail' },
    '虚构叙事': { pageKey: 'maze_extra', type: 'page_detail' }
  },
  zzz: {
    '成就': { pageKey: 'achievement/achievement', type: 'page_list' },
    '防卫战': { pageKey: 'shiyu', type: 'page_detail' },
    '式舆': { pageKey: 'shiyu', type: 'page_detail' },
    '危局': { pageKey: 'boss', type: 'page_detail' },
    '强袭': { pageKey: 'boss', type: 'page_detail' },
    '危局强袭战': { pageKey: 'boss', type: 'page_detail' }
  }
}

// 挑战类 pageKey 集合（对应挑战详情模板 challenge.html）
export const CHALLENGE_PAGE_KEYS = new Set([
  // 原神
  'tower',              // 深境螺旋
  'leyline',            // 地脉异常
  'rolecombat',         // 幻想真境剧诗
  // 星铁
  'maze',               // 混沌回忆
  'maze_boss',          // 末日幻影
  'maze_extra',         // 虚构叙事
  'maze_peak',          // 异相仲裁
  // 绝区零
  'shiyu',              // 式舆防卫战
  'boss'                // 危局强袭战
])

// 模板名常量
export const TEMPLATE = {
  DETAIL: 'detail',
  CHALLENGE: 'challenge',
  LIST: 'list',
  ACHIEVEMENT: 'achievement',
  ACHIEVEMENT_CATEGORY: 'achievement-category'
}

// Data 目录路径（相对于 submodule）
export const DATA_DIR = 'tool/nanoka-atlas-backend/nanoka-atlas-backend/data'

// 搜索结果上限
export const MAX_RESULTS = 30
